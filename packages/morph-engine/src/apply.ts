import type {
  UIBlueprint,
  UIComponent,
  UIPatch,
  UIPatchOperation,
} from "@dm/contracts";

/** Reserved props the morph engine uses for non-structural, reversible UI signals. */
export const RESERVED = {
  collapsed: "__collapsed",
  highlighted: "__highlighted",
  focused: "__focused",
} as const;

function clone<T>(v: T): T {
  return structuredClone(v);
}

function findNode(root: UIComponent, id: string): UIComponent | undefined {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const f = findNode(c, id);
    if (f) return f;
  }
  return undefined;
}

function findParentAndIndex(
  root: UIComponent,
  id: string,
): { parent: UIComponent; index: number } | undefined {
  const kids = root.children ?? [];
  for (let i = 0; i < kids.length; i++) {
    if (kids[i]!.id === id) return { parent: root, index: i };
    const deeper = findParentAndIndex(kids[i]!, id);
    if (deeper) return deeper;
  }
  return undefined;
}

function setProp(node: UIComponent, key: string, value: unknown): unknown {
  const props = (node.props ??= {});
  const prev = props[key];
  props[key] = value;
  return prev;
}

/** Inverse for a prop-ish op: snapshot the node and restore it wholesale via `replace`. */
function replaceInverse(node: UIComponent): UIPatchOperation {
  return { op: "replace", targetId: node.id, component: clone(node) };
}

export class MorphApplyError extends Error {}

export type ApplyResult = {
  next: UIBlueprint;
  /** patch that undoes `next` back to the input blueprint */
  inverse: UIPatch;
};

/**
 * Apply a validated patch to a blueprint, purely (input is not mutated), returning the
 * next blueprint and an inverse patch for undo. Throws MorphApplyError on structural
 * impossibility (missing target/parent) — callers validate against the tree beforehand.
 */
export function applyPatch(
  blueprint: UIBlueprint,
  patch: UIPatch,
  now: string,
): ApplyResult {
  const next = clone(blueprint);
  const root = next.root;
  const inverseOps: UIPatchOperation[] = [];

  for (const op of patch.operations) {
    switch (op.op) {
      case "add": {
        const parent = findNode(root, op.parentId);
        if (!parent) throw new MorphApplyError(`add: parent ${op.parentId} not found`);
        parent.children ??= [];
        const index = op.index ?? parent.children.length;
        parent.children.splice(index, 0, clone(op.component));
        inverseOps.push({ op: "remove", targetId: op.component.id });
        break;
      }
      case "remove": {
        const loc = findParentAndIndex(root, op.targetId);
        if (!loc) throw new MorphApplyError(`remove: ${op.targetId} not found`);
        const [removed] = loc.parent.children!.splice(loc.index, 1);
        inverseOps.push({
          op: "add",
          parentId: loc.parent.id,
          index: loc.index,
          component: clone(removed!),
        });
        break;
      }
      case "replace": {
        const loc = findParentAndIndex(root, op.targetId);
        if (!loc) throw new MorphApplyError(`replace: ${op.targetId} not found`);
        const old = loc.parent.children![loc.index]!;
        loc.parent.children![loc.index] = clone(op.component);
        inverseOps.push({
          op: "replace",
          targetId: op.component.id,
          component: clone(old),
        });
        break;
      }
      case "move": {
        const from = findParentAndIndex(root, op.targetId);
        if (!from) throw new MorphApplyError(`move: ${op.targetId} not found`);
        const target = findNode(root, op.newParentId);
        if (!target) throw new MorphApplyError(`move: parent ${op.newParentId} not found`);
        const [moved] = from.parent.children!.splice(from.index, 1);
        target.children ??= [];
        const index = op.index ?? target.children.length;
        target.children.splice(index, 0, moved!);
        inverseOps.push({
          op: "move",
          targetId: op.targetId,
          newParentId: from.parent.id,
          index: from.index,
        });
        break;
      }
      case "updateProps": {
        const node = findNode(root, op.targetId);
        if (!node) throw new MorphApplyError(`updateProps: ${op.targetId} not found`);
        inverseOps.push(replaceInverse(node));
        node.props = { ...(node.props ?? {}), ...op.props };
        break;
      }
      case "updateBinding": {
        const node = findNode(root, op.targetId);
        if (!node) throw new MorphApplyError(`updateBinding: ${op.targetId} not found`);
        inverseOps.push(replaceInverse(node));
        node.bindings = clone(op.bindings);
        break;
      }
      case "collapse":
      case "expand": {
        const node = findNode(root, op.targetId);
        if (!node) throw new MorphApplyError(`${op.op}: ${op.targetId} not found`);
        inverseOps.push(replaceInverse(node));
        setProp(node, RESERVED.collapsed, op.op === "collapse");
        break;
      }
      case "highlight": {
        const node = findNode(root, op.targetId);
        if (!node) throw new MorphApplyError(`highlight: ${op.targetId} not found`);
        inverseOps.push(replaceInverse(node));
        setProp(node, RESERVED.highlighted, true);
        break;
      }
      case "focus": {
        const node = findNode(root, op.targetId);
        if (!node) throw new MorphApplyError(`focus: ${op.targetId} not found`);
        inverseOps.push(replaceInverse(node));
        setProp(node, RESERVED.focused, true);
        break;
      }
    }
  }

  next.metadata = { ...next.metadata, generatedAt: now };

  const inverse: UIPatch = {
    patchId: `${patch.patchId}::inverse`,
    fromWorkspaceId: next.workspaceId,
    operations: inverseOps.reverse(),
  };

  return { next, inverse };
}
