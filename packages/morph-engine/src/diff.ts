import type {
  UIBlueprint,
  UIComponent,
  UIPatch,
  UIPatchOperation,
} from "@particle/contracts";

type Loc = { node: UIComponent; parentId: string | null; index: number };

function index(root: UIComponent): Map<string, Loc> {
  const map = new Map<string, Loc>();
  const walk = (n: UIComponent, parentId: string | null, idx: number) => {
    map.set(n.id, { node: n, parentId, index: idx });
    (n.children ?? []).forEach((c, i) => walk(c, n.id, i));
  };
  walk(root, null, 0);
  return map;
}

function shallowPropsEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

/**
 * Compute a patch that morphs `current` into `desired`. Pragmatic (not minimal): emits
 * top-most add/remove for structural set differences, `move` when a surviving node changes
 * parent, `replace` when a node's type changes, and `updateProps`/`updateBinding` when a
 * surviving node's props/bindings change. Every op is expressed against stable ids.
 */
export function computeDiff(
  current: UIBlueprint,
  desired: UIBlueprint,
  patchId: string,
): UIPatch {
  const cur = index(current.root);
  const des = index(desired.root);
  const ops: UIPatchOperation[] = [];

  // Removals: in current, absent from desired, whose parent is not also removed.
  for (const [id, loc] of cur) {
    if (des.has(id)) continue;
    const parentRemoved = loc.parentId !== null && !des.has(loc.parentId);
    if (!parentRemoved && id !== current.root.id) {
      ops.push({ op: "remove", targetId: id });
    }
  }

  // Additions: in desired, absent from current, whose parent already exists (top-most).
  for (const [id, loc] of des) {
    if (cur.has(id)) continue;
    const parentAdded = loc.parentId !== null && !cur.has(loc.parentId);
    if (!parentAdded && loc.parentId !== null) {
      ops.push({
        op: "add",
        parentId: loc.parentId,
        index: loc.index,
        component: loc.node,
      });
    }
  }

  // Survivors: present in both.
  for (const [id, dloc] of des) {
    const cloc = cur.get(id);
    if (!cloc) continue;

    if (cloc.node.type !== dloc.node.type) {
      ops.push({ op: "replace", targetId: id, component: dloc.node });
      continue;
    }
    // Moved to a different parent.
    if (cloc.parentId !== dloc.parentId && dloc.parentId !== null) {
      ops.push({
        op: "move",
        targetId: id,
        newParentId: dloc.parentId,
        index: dloc.index,
      });
    }
    if (!shallowPropsEqual(cloc.node.props, dloc.node.props)) {
      ops.push({ op: "updateProps", targetId: id, props: dloc.node.props ?? {} });
    }
    if (JSON.stringify(cloc.node.bindings ?? []) !== JSON.stringify(dloc.node.bindings ?? [])) {
      ops.push({ op: "updateBinding", targetId: id, bindings: dloc.node.bindings ?? [] });
    }
  }

  return { patchId, fromWorkspaceId: current.workspaceId, operations: ops };
}
