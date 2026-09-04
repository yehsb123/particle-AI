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

/** Clone a subtree, dropping any descendant whose id already exists (it arrives via `move`). */
function pruneExisting(node: UIComponent, exists: (id: string) => boolean): UIComponent {
  const copy: UIComponent = structuredClone(node);
  copy.children = (copy.children ?? []).filter((c) => !exists(c.id)).map((c) => pruneExisting(c, exists));
  if (copy.children.length === 0) delete copy.children;
  return copy;
}

/**
 * Compute a patch that morphs `current` into `desired`. Ops are ordered add → move → remove so
 * that reparenting into newly-added nodes and out of soon-removed nodes both apply cleanly;
 * added subtrees exclude descendants that already exist (they are moved in) to avoid duplicate
 * ids. Not guaranteed minimal for simultaneous sibling reorders, but always applies to `desired`
 * for add/remove/reparent/prop changes. (Runtime morphs use `planMorph`; this is a utility.)
 */
export function computeDiff(
  current: UIBlueprint,
  desired: UIBlueprint,
  patchId: string,
): UIPatch {
  // A different root is not a set of edits to the old one — nothing in the walk below can
  // express it, and returning an empty patch would tell the caller the two trees already match.
  if (current.root.id !== desired.root.id) {
    return {
      patchId,
      fromWorkspaceId: current.workspaceId,
      operations: [{ op: "replace", targetId: current.root.id, component: structuredClone(desired.root) }],
    };
  }

  const cur = index(current.root);
  const des = index(desired.root);
  const adds: UIPatchOperation[] = [];
  const moves: UIPatchOperation[] = [];
  const updates: UIPatchOperation[] = [];
  const removes: UIPatchOperation[] = [];

  // Additions: in desired, absent from current, whose parent already exists (top-most).
  for (const [id, loc] of des) {
    if (cur.has(id)) continue;
    const parentAdded = loc.parentId !== null && !cur.has(loc.parentId);
    if (!parentAdded && loc.parentId !== null) {
      adds.push({
        op: "add",
        parentId: loc.parentId,
        index: loc.index,
        component: pruneExisting(loc.node, (cid) => cur.has(cid)),
      });
    }
  }

  // Survivors: present in both — type change, reparent/reorder, prop/binding changes.
  for (const [id, dloc] of des) {
    const cloc = cur.get(id);
    if (!cloc) continue;

    if (cloc.node.type !== dloc.node.type) {
      updates.push({ op: "replace", targetId: id, component: structuredClone(dloc.node) });
      continue;
    }
    const reparented = cloc.parentId !== dloc.parentId && dloc.parentId !== null;
    const reordered = cloc.parentId === dloc.parentId && cloc.index !== dloc.index && dloc.parentId !== null;
    if (reparented || reordered) {
      moves.push({ op: "move", targetId: id, newParentId: dloc.parentId!, index: dloc.index });
    }
    if (!shallowPropsEqual(cloc.node.props, dloc.node.props)) {
      updates.push({ op: "updateProps", targetId: id, props: dloc.node.props ?? {} });
    }
    if (JSON.stringify(cloc.node.bindings ?? []) !== JSON.stringify(dloc.node.bindings ?? [])) {
      updates.push({ op: "updateBinding", targetId: id, bindings: dloc.node.bindings ?? [] });
    }
  }

  // Removals: in current, absent from desired, whose parent is not also removed.
  for (const [id, loc] of cur) {
    if (des.has(id)) continue;
    const parentRemoved = loc.parentId !== null && !des.has(loc.parentId);
    if (!parentRemoved && id !== current.root.id) {
      removes.push({ op: "remove", targetId: id });
    }
  }

  return { patchId, fromWorkspaceId: current.workspaceId, operations: [...adds, ...moves, ...updates, ...removes] };
}
