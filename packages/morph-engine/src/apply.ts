import type {
  UIBlueprint,
  UIComponent,
  UIPatch,
  UIPatchOperation,
} from "@particle/contracts";

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

function subtreeIds(node: UIComponent, acc = new Set<string>()): Set<string> {
  acc.add(node.id);
  for (const c of node.children ?? []) subtreeIds(c, acc);
  return acc;
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

/**
 * The first id in `incoming` that the tree already uses, ignoring anything inside `excluded`
 * (the subtree being replaced, whose ids are about to disappear).
 *
 * Duplicate ids are forbidden by the blueprint schema for a reason: every lookup here is by id
 * and takes the first match, so a second node answering to the same id makes the tree
 * ambiguous. It cost the user real work — an `add` reusing an id produced a blueprint the
 * renderer's own gate rejects, and its inverse `remove` then deleted whichever copy came first,
 * which is the original with its children while the newcomer stayed.
 */
function firstCollision(root: UIComponent, incoming: UIComponent, excluded?: UIComponent): string | undefined {
  const taken = subtreeIds(root);
  if (excluded) for (const id of subtreeIds(excluded)) taken.delete(id);
  for (const id of subtreeIds(incoming)) if (taken.has(id)) return id;
  return undefined;
}

/**
 * Drop a `children` array this patch just emptied, so "no children" has one spelling.
 * Without it a move-out or a remove leaves `children: []` behind, and undo comes back to a
 * tree that renders identically but no longer equals the one it started from — which is the
 * comparison replay and snapshot checks rely on.
 */
function pruneIfEmptied(parent: UIComponent): void {
  if (parent.children && parent.children.length === 0) delete parent.children;
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
  let root = next.root;
  const inverseOps: UIPatchOperation[] = [];

  for (const op of patch.operations) {
    switch (op.op) {
      case "add": {
        const parent = findNode(root, op.parentId);
        if (!parent) throw new MorphApplyError(`add: parent ${op.parentId} not found`);
        const clash = firstCollision(root, op.component);
        if (clash) throw new MorphApplyError(`add: id ${clash} is already in the tree`);
        parent.children ??= [];
        const index = op.index ?? parent.children.length;
        parent.children.splice(index, 0, clone(op.component));
        inverseOps.push({ op: "remove", targetId: op.component.id });
        break;
      }
      case "remove": {
        if (op.targetId === root.id) throw new MorphApplyError("remove: cannot remove the root");
        const loc = findParentAndIndex(root, op.targetId);
        if (!loc) throw new MorphApplyError(`remove: ${op.targetId} not found`);
        const [removed] = loc.parent.children!.splice(loc.index, 1);
        pruneIfEmptied(loc.parent);
        inverseOps.push({
          op: "add",
          parentId: loc.parent.id,
          index: loc.index,
          component: clone(removed!),
        });
        break;
      }
      case "replace": {
        // Replacing the root swaps the whole tree (keeps root ops / their inverses valid).
        if (op.targetId === root.id) {
          const old = next.root;
          next.root = clone(op.component);
          root = next.root;
          inverseOps.push({ op: "replace", targetId: op.component.id, component: clone(old) });
          break;
        }
        const loc = findParentAndIndex(root, op.targetId);
        if (!loc) throw new MorphApplyError(`replace: ${op.targetId} not found`);
        const old = loc.parent.children![loc.index]!;
        // Reusing ids from the subtree being replaced is fine — they are leaving with it.
        const clash = firstCollision(root, op.component, old);
        if (clash) throw new MorphApplyError(`replace: id ${clash} is already in the tree`);
        loc.parent.children![loc.index] = clone(op.component);
        inverseOps.push({
          op: "replace",
          targetId: op.component.id,
          component: clone(old),
        });
        break;
      }
      case "move": {
        if (op.targetId === root.id) throw new MorphApplyError("move: cannot move the root");
        const from = findParentAndIndex(root, op.targetId);
        if (!from) throw new MorphApplyError(`move: ${op.targetId} not found`);
        const target = findNode(root, op.newParentId);
        if (!target) throw new MorphApplyError(`move: parent ${op.newParentId} not found`);
        // Reject moving a node into its own subtree (would create a cycle).
        const movedNode = from.parent.children![from.index]!;
        if (subtreeIds(movedNode).has(op.newParentId)) {
          throw new MorphApplyError(`move: ${op.newParentId} is inside the moved subtree (cycle)`);
        }
        const [moved] = from.parent.children!.splice(from.index, 1);
        pruneIfEmptied(from.parent);
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
