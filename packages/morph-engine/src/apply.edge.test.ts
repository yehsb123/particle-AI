import { describe, it, expect } from "vitest";
import type { UIBlueprint, UIComponent, UIPatch, UIPatchOperation } from "@particle/contracts";
import { UI_SCHEMA_VERSION } from "@particle/contracts";
import { parseBlueprint } from "@particle/ui-protocol";
import { applyPatch, MorphApplyError, RESERVED } from "./apply";

/**
 * applyPatch is where a decision becomes the body the person is looking at, and its inverse is
 * the undo they can always reach for. Two properties matter more than any single case: whatever
 * it produces must still pass the gate in front of the renderer, and applying the inverse must
 * put the tree back exactly. Everything here is checked against both.
 */
const T = "2026-09-03T00:00:00Z";
const LATER = "2026-09-03T00:05:00Z";

const card = (id: string, props?: Record<string, unknown>): UIComponent => ({ id, type: "Card", ...(props ? { props } : {}) });
const stack = (id: string, children: UIComponent[]): UIComponent => ({ id, type: "Stack", children });

const bp = (root: UIComponent): UIBlueprint => ({
  schemaVersion: UI_SCHEMA_VERSION,
  workspaceId: "ws",
  mode: "development",
  root,
  metadata: { generatedAt: T, decisionId: "d1", confidence: 1 },
});

const tree = () => bp(stack("root", [card("a"), stack("b", [card("b1"), card("b2")]), card("c")]));
const patch = (operations: UIPatchOperation[], patchId = "p1"): UIPatch => ({ patchId, fromWorkspaceId: "ws", operations });
const shape = (n: UIComponent): string => `${n.id}${n.children?.length ? `(${n.children.map(shape).join(",")})` : ""}`;

/** Apply, then undo, and report the shape at each end plus whether the result is renderable. */
function roundTrip(base: UIBlueprint, ops: UIPatchOperation[]) {
  const { next, inverse } = applyPatch(base, patch(ops), LATER);
  const back = applyPatch(next, inverse, LATER).next;
  return { next, inverse, back, renderable: parseBlueprint(next).ok, restored: shape(back.root) === shape(base.root) };
}

describe("an id the tree already uses is refused", () => {
  it("refuses an add that reuses a live id", () => {
    // it used to go through: the tree then had two nodes answering to one id, which the
    // blueprint schema forbids, and the inverse remove deleted whichever came first
    expect(() => applyPatch(tree(), patch([{ op: "add", parentId: "root", component: card("a") }]), LATER)).toThrow(MorphApplyError);
    expect(() => applyPatch(tree(), patch([{ op: "add", parentId: "root", component: card("a") }]), LATER)).toThrow(/id a is already in the tree/);
  });

  it("refuses an add whose subtree carries a live id further down", () => {
    expect(() => applyPatch(tree(), patch([{ op: "add", parentId: "root", component: stack("fresh", [card("b1")]) }]), LATER)).toThrow(/id b1 is already/);
  });

  it("refuses the second of two adds sharing an id inside one patch", () => {
    expect(() =>
      applyPatch(tree(), patch([
        { op: "add", parentId: "root", component: card("dup") },
        { op: "add", parentId: "b", component: card("dup") },
      ]), LATER),
    ).toThrow(/id dup is already/);
  });

  it("refuses a replace that steals an id from elsewhere in the tree", () => {
    expect(() => applyPatch(tree(), patch([{ op: "replace", targetId: "b", component: stack("B", [card("a")]) }]), LATER)).toThrow(/id a is already/);
  });

  it("still allows a replace that reuses ids from the subtree it is replacing", () => {
    // those ids are leaving with the old subtree, so there is no ambiguity
    const r = roundTrip(tree(), [{ op: "replace", targetId: "b", component: stack("b", [card("b1")]) }]);
    expect(shape(r.next.root)).toBe("root(a,b(b1),c)");
    expect(r.renderable).toBe(true);
    expect(r.restored).toBe(true);
  });

  it("still allows replacing the root with a tree that reuses its ids", () => {
    const r = roundTrip(tree(), [{ op: "replace", targetId: "root", component: stack("root", [card("a")]) }]);
    expect(shape(r.next.root)).toBe("root(a)");
    expect(r.renderable).toBe(true);
    expect(r.restored).toBe(true);
  });

  it("leaves the input blueprint untouched when it refuses", () => {
    const base = tree();
    const before = JSON.stringify(base);
    expect(() => applyPatch(base, patch([{ op: "add", parentId: "root", component: card("a") }]), LATER)).toThrow();
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("structural operations and their inverses", () => {
  it("adds at an index, and at the end when none is given", () => {
    expect(shape(roundTrip(tree(), [{ op: "add", parentId: "root", index: 0, component: card("z") }]).next.root)).toBe("root(z,a,b(b1,b2),c)");
    expect(shape(roundTrip(tree(), [{ op: "add", parentId: "root", component: card("z") }]).next.root)).toBe("root(a,b(b1,b2),c,z)");
    expect(shape(roundTrip(tree(), [{ op: "add", parentId: "b", index: 1, component: card("z") }]).next.root)).toBe("root(a,b(b1,z,b2),c)");
  });

  it("appends when the index is past the end rather than leaving a hole", () => {
    const r = roundTrip(tree(), [{ op: "add", parentId: "root", index: 99, component: card("z") }]);
    expect(shape(r.next.root)).toBe("root(a,b(b1,b2),c,z)");
    expect(r.next.root.children?.every(Boolean)).toBe(true);
    expect(r.restored).toBe(true);
  });

  it("gives a childless parent its first child", () => {
    const r = roundTrip(bp(stack("root", [card("leaf")])), [{ op: "add", parentId: "leaf", component: card("first") }]);
    expect(shape(r.next.root)).toBe("root(leaf(first))");
    expect(r.restored).toBe(true);
  });

  it("removes a node with its whole subtree, and puts it back where it was", () => {
    const r = roundTrip(tree(), [{ op: "remove", targetId: "b" }]);
    expect(shape(r.next.root)).toBe("root(a,c)");
    expect(shape(r.back.root)).toBe("root(a,b(b1,b2),c)");
    expect(r.inverse.operations[0]).toMatchObject({ op: "add", parentId: "root", index: 1 });
  });

  it("never removes the root", () => {
    expect(() => applyPatch(tree(), patch([{ op: "remove", targetId: "root" }]), LATER)).toThrow(/cannot remove the root/);
  });

  it("moves a node within its parent, forwards and backwards, and back again", () => {
    const later = roundTrip(tree(), [{ op: "move", targetId: "a", newParentId: "root", index: 2 }]);
    expect(shape(later.next.root)).toBe("root(b(b1,b2),c,a)");
    expect(later.restored).toBe(true);
    const earlier = roundTrip(tree(), [{ op: "move", targetId: "c", newParentId: "root", index: 0 }]);
    expect(shape(earlier.next.root)).toBe("root(c,a,b(b1,b2))");
    expect(earlier.restored).toBe(true);
  });

  it("moves a node to another parent and back", () => {
    const r = roundTrip(tree(), [{ op: "move", targetId: "b1", newParentId: "root", index: 1 }]);
    expect(shape(r.next.root)).toBe("root(a,b1,b(b2),c)");
    expect(r.restored).toBe(true);
    expect(r.renderable).toBe(true);
  });

  it("never moves a node into its own subtree, and never moves the root", () => {
    expect(() => applyPatch(tree(), patch([{ op: "move", targetId: "b", newParentId: "b1" }]), LATER)).toThrow(/cycle/);
    expect(() => applyPatch(tree(), patch([{ op: "move", targetId: "b", newParentId: "b" }]), LATER)).toThrow(/cycle/);
    expect(() => applyPatch(tree(), patch([{ op: "move", targetId: "root", newParentId: "b" }]), LATER)).toThrow(/cannot move the root/);
  });

  it("replaces a node with one carrying a different id, and the inverse targets the new id", () => {
    const r = roundTrip(tree(), [{ op: "replace", targetId: "b", component: stack("B-new", [card("x")]) }]);
    expect(shape(r.next.root)).toBe("root(a,B-new(x),c)");
    expect(r.inverse.operations[0]).toMatchObject({ op: "replace", targetId: "B-new" });
    expect(r.restored).toBe(true);
  });

  it("swaps the whole tree when the root is replaced", () => {
    const r = roundTrip(tree(), [{ op: "replace", targetId: "root", component: stack("root2", [card("only")]) }]);
    expect(shape(r.next.root)).toBe("root2(only)");
    expect(r.restored).toBe(true);
    expect(r.renderable).toBe(true);
  });

  it("says which target it could not find", () => {
    for (const [op, message] of [
      [{ op: "remove", targetId: "ghost" }, /remove: ghost not found/],
      [{ op: "replace", targetId: "ghost", component: card("x") }, /replace: ghost not found/],
      [{ op: "move", targetId: "ghost", newParentId: "root" }, /move: ghost not found/],
      [{ op: "move", targetId: "a", newParentId: "ghost" }, /move: parent ghost not found/],
      [{ op: "add", parentId: "ghost", component: card("x") }, /add: parent ghost not found/],
      [{ op: "updateProps", targetId: "ghost", props: {} }, /updateProps: ghost not found/],
      [{ op: "focus", targetId: "ghost" }, /focus: ghost not found/],
      [{ op: "collapse", targetId: "ghost" }, /collapse: ghost not found/],
      [{ op: "highlight", targetId: "ghost" }, /highlight: ghost not found/],
      [{ op: "updateBinding", targetId: "ghost", bindings: [] }, /updateBinding: ghost not found/],
    ] as [UIPatchOperation, RegExp][]) {
      expect(() => applyPatch(tree(), patch([op]), LATER), JSON.stringify(op.op)).toThrow(message);
    }
  });

  it("refuses an operation on a node an earlier operation in the same patch removed", () => {
    // the patch describes one coherent step; a self-contradicting one is refused whole
    expect(() =>
      applyPatch(tree(), patch([
        { op: "remove", targetId: "b" },
        { op: "updateProps", targetId: "b1", props: { title: "orphan" } },
      ]), LATER),
    ).toThrow(/b1 not found/);
  });
});

describe("prop operations restore the node they touched", () => {
  it("collapses and expands through a reserved prop", () => {
    const collapsed = applyPatch(tree(), patch([{ op: "collapse", targetId: "b" }]), LATER).next;
    const node = collapsed.root.children?.[1];
    expect(node?.props?.[RESERVED.collapsed]).toBe(true);
    const expanded = applyPatch(collapsed, patch([{ op: "expand", targetId: "b" }]), LATER).next;
    expect(expanded.root.children?.[1]?.props?.[RESERVED.collapsed]).toBe(false);
  });

  it("marks highlight and focus, and undo takes the whole node back", () => {
    const r = roundTrip(tree(), [{ op: "highlight", targetId: "a" }, { op: "focus", targetId: "c" }]);
    expect(r.next.root.children?.[0]?.props?.[RESERVED.highlighted]).toBe(true);
    expect(r.next.root.children?.[2]?.props?.[RESERVED.focused]).toBe(true);
    expect(r.back.root.children?.[0]?.props?.[RESERVED.highlighted]).toBeUndefined();
    expect(r.back.root.children?.[2]?.props?.[RESERVED.focused]).toBeUndefined();
  });

  it("merges updateProps over what is already there, and undo restores the earlier props exactly", () => {
    const base = bp(stack("root", [card("a", { title: "before", tone: "muted" })]));
    const { next, inverse } = applyPatch(base, patch([{ op: "updateProps", targetId: "a", props: { title: "after" } }]), LATER);
    expect(next.root.children?.[0]?.props).toEqual({ title: "after", tone: "muted" });
    const back = applyPatch(next, inverse, LATER).next;
    expect(back.root.children?.[0]?.props).toEqual({ title: "before", tone: "muted" });
  });

  it("replaces bindings wholesale, and undo brings the old ones back", () => {
    const base = bp(stack("root", [{ id: "a", type: "Table", bindings: [{ prop: "rows", source: "capability:old:out" }] }]));
    const { next, inverse } = applyPatch(base, patch([{ op: "updateBinding", targetId: "a", bindings: [{ prop: "rows", source: "capability:new:out" }] }]), LATER);
    expect(next.root.children?.[0]?.bindings).toEqual([{ prop: "rows", source: "capability:new:out" }]);
    const back = applyPatch(next, inverse, LATER).next;
    expect(back.root.children?.[0]?.bindings).toEqual([{ prop: "rows", source: "capability:old:out" }]);
  });

  it("works on the root itself", () => {
    const r = roundTrip(tree(), [{ op: "updateProps", targetId: "root", props: { title: "renamed" } }]);
    expect(r.next.root.props).toEqual({ title: "renamed" });
    expect(r.back.root.props).toBeUndefined();
  });
});

describe("the result as a whole", () => {
  it("does not touch the blueprint it was given", () => {
    const base = tree();
    const before = JSON.stringify(base);
    applyPatch(base, patch([
      { op: "updateProps", targetId: "a", props: { x: 1 } },
      { op: "remove", targetId: "c" },
      { op: "add", parentId: "b", component: card("b3") },
    ]), LATER);
    expect(JSON.stringify(base)).toBe(before);
  });

  it("stamps the time it was generated and keeps the rest of the metadata", () => {
    const { next } = applyPatch(tree(), patch([{ op: "focus", targetId: "a" }]), LATER);
    expect(next.metadata.generatedAt).toBe(LATER);
    expect(next.metadata.decisionId).toBe("d1");
    expect(next.workspaceId).toBe("ws");
    expect(next.schemaVersion).toBe(UI_SCHEMA_VERSION);
  });

  it("names the inverse after the patch it undoes, and puts its operations in reverse order", () => {
    const { inverse } = applyPatch(tree(), patch([
      { op: "remove", targetId: "a" },
      { op: "remove", targetId: "c" },
    ], "morph-7"), LATER);
    expect(inverse.patchId).toBe("morph-7::inverse");
    expect(inverse.fromWorkspaceId).toBe("ws");
    expect(inverse.operations.map((o) => (o.op === "add" ? o.component.id : o.op))).toEqual(["c", "a"]);
  });

  it("undoes a patch of many operations in one step", () => {
    const r = roundTrip(tree(), [
      { op: "add", parentId: "root", component: card("d") },
      { op: "move", targetId: "b1", newParentId: "c" },
      { op: "updateProps", targetId: "a", props: { title: "changed" } },
      { op: "collapse", targetId: "b" },
      { op: "remove", targetId: "b2" },
    ]);
    expect(r.renderable).toBe(true);
    expect(r.restored).toBe(true);
    expect(JSON.stringify(r.back.root)).toBe(JSON.stringify(tree().root));
  });

  it("leaves one spelling for a container with nothing left in it", () => {
    // a remove or a move-out used to leave `children: []` behind, so undo came back to a tree
    // that rendered the same but no longer equalled the one it started from
    const base = bp(stack("root", [stack("holder", [card("only")]), card("elsewhere")]));
    const removed = applyPatch(base, patch([{ op: "remove", targetId: "only" }]), LATER).next;
    expect(removed.root.children?.[0]).toEqual({ id: "holder", type: "Stack" });
    const moved = applyPatch(base, patch([{ op: "move", targetId: "only", newParentId: "root" }]), LATER).next;
    expect(moved.root.children?.[0]).toEqual({ id: "holder", type: "Stack" });
    expect(applyPatch(removed, applyPatch(base, patch([{ op: "remove", targetId: "only" }]), LATER).inverse, LATER).next.root).toEqual(base.root);
  });

  it("leaves an array that was already empty exactly as it found it", () => {
    const base = bp(stack("root", [{ id: "empty", type: "Stack", children: [] }, card("a")]));
    const { next } = applyPatch(base, patch([{ op: "remove", targetId: "a" }]), LATER);
    expect(next.root.children?.[0]).toEqual({ id: "empty", type: "Stack", children: [] });
  });

  it("takes an empty patch as a no-op with an empty inverse", () => {
    const { next, inverse } = applyPatch(tree(), patch([]), LATER);
    expect(shape(next.root)).toBe(shape(tree().root));
    expect(inverse.operations).toEqual([]);
  });

  it("produces something the renderer's own gate accepts, for every operation kind", () => {
    const ops: UIPatchOperation[][] = [
      [{ op: "add", parentId: "root", component: card("z") }],
      [{ op: "remove", targetId: "a" }],
      [{ op: "replace", targetId: "a", component: card("a2") }],
      [{ op: "move", targetId: "b1", newParentId: "root" }],
      [{ op: "updateProps", targetId: "a", props: { title: "t" } }],
      [{ op: "updateBinding", targetId: "a", bindings: [{ prop: "rows", source: "capability:x:y" }] }],
      [{ op: "focus", targetId: "a" }],
      [{ op: "collapse", targetId: "b" }],
      [{ op: "expand", targetId: "b" }],
      [{ op: "highlight", targetId: "a" }],
    ];
    for (const o of ops) {
      const r = roundTrip(tree(), o);
      expect(r.renderable, JSON.stringify(o[0]?.op)).toBe(true);
      expect(r.restored, JSON.stringify(o[0]?.op)).toBe(true);
      expect(parseBlueprint(r.back).ok).toBe(true);
    }
  });
});
