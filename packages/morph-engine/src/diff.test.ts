import { describe, it, expect } from "vitest";
import type { UIBlueprint, UIComponent } from "@particle/contracts";
import { UI_SCHEMA_VERSION } from "@particle/contracts";
import { parseBlueprint } from "@particle/ui-protocol";
import { applyPatch, computeDiff } from "./index";

/**
 * computeDiff answers "what would turn this tree into that one?", and the only way to judge the
 * answer is to apply it: whatever it returns has to land on the tree it was asked about, and be
 * something the renderer's own gate accepts. Every case here is checked that way rather than by
 * counting operations.
 */
const T = "2026-09-04T00:00:00Z";
const card = (id: string, props?: Record<string, unknown>): UIComponent => ({ id, type: "Card", ...(props ? { props } : {}) });
const stack = (id: string, children: UIComponent[]): UIComponent => ({ id, type: "Stack", children });
const bp = (root: UIComponent): UIBlueprint => ({
  schemaVersion: UI_SCHEMA_VERSION,
  workspaceId: "ws",
  mode: "development",
  root,
  metadata: { generatedAt: T, decisionId: "d", confidence: 1 },
});

const shape = (n: UIComponent): string => `${n.id}${n.children?.length ? `(${n.children.map(shape).join(",")})` : ""}`;
const base = () => bp(stack("root", [card("a"), stack("b", [card("b1"), card("b2")]), card("c")]));

/** Apply the diff and report where it landed. */
function morph(from: UIBlueprint, to: UIBlueprint) {
  const patch = computeDiff(from, to, "p1");
  const next = applyPatch(from, patch, T).next;
  return { patch, next, arrived: shape(next.root) === shape(to.root), renderable: parseBlueprint(next).ok };
}

describe("it lands on the tree it was asked about", () => {
  const cases: [string, () => UIBlueprint][] = [
    ["nothing changed", () => base()],
    ["a child added", () => bp(stack("root", [card("a"), stack("b", [card("b1"), card("b2")]), card("c"), card("d")]))],
    ["a child removed", () => bp(stack("root", [card("a"), card("c")]))],
    ["a whole subtree removed", () => bp(stack("root", [card("a"), card("c")]))],
    ["siblings reordered", () => bp(stack("root", [card("c"), card("a"), stack("b", [card("b1"), card("b2")])]))],
    ["a node reparented", () => bp(stack("root", [card("a"), stack("b", [card("b2")]), card("c"), card("b1")]))],
    ["a node moved into a new parent", () => bp(stack("root", [card("a"), stack("b", [card("b2")]), card("c"), stack("new", [card("b1")])]))],
    ["props changed", () => bp(stack("root", [card("a", { title: "x" }), stack("b", [card("b1"), card("b2")]), card("c")]))],
    ["a type changed", () => bp(stack("root", [{ id: "a", type: "Badge" }, stack("b", [card("b1"), card("b2")]), card("c")]))],
    ["two subtrees swapped", () => bp(stack("root", [stack("b", [card("b1"), card("b2")]), card("a"), card("c")]))],
    ["everything replaced under the same root", () => bp(stack("root", [card("x"), card("y")]))],
    ["emptied entirely", () => bp(stack("root", []))],
  ];

  for (const [label, to] of cases) {
    it(label, () => {
      const r = morph(base(), to());
      expect(r.arrived, `${label}: ${shape(r.next.root)}`).toBe(true);
      expect(r.renderable, label).toBe(true);
    });
  }

  it("says there is nothing to do when the trees already match", () => {
    expect(computeDiff(base(), base(), "p1").operations).toEqual([]);
  });
});

describe("a different root is not a set of edits to the old one", () => {
  it("replaces the tree rather than reporting no difference", () => {
    // nothing in the walk can express a changed root, and an empty patch would tell the caller
    // the two trees already match
    const r = morph(base(), bp(stack("root2", [card("x")])));
    expect(r.patch.operations).toHaveLength(1);
    expect(r.patch.operations[0]?.op).toBe("replace");
    expect(r.arrived).toBe(true);
    expect(shape(r.next.root)).toBe("root2(x)");
  });

  it("carries the whole new tree, however deep", () => {
    const deep = bp(stack("other", [stack("x", [stack("y", [card("z")])])]));
    const r = morph(base(), deep);
    expect(r.arrived).toBe(true);
    expect(r.renderable).toBe(true);
  });

  it("goes back the other way just as well", () => {
    const r = morph(bp(stack("root2", [card("x")])), base());
    expect(r.arrived).toBe(true);
  });
});

describe("what it hands back", () => {
  it("names the patch and the workspace it came from", () => {
    const patch = computeDiff(base(), bp(stack("root", [card("a")])), "morph-7");
    expect(patch.patchId).toBe("morph-7");
    expect(patch.fromWorkspaceId).toBe("ws");
  });

  it("never touches either tree it was given", () => {
    const from = base();
    const to = bp(stack("root", [card("a")]));
    const before = [JSON.stringify(from), JSON.stringify(to)];
    computeDiff(from, to, "p1");
    expect([JSON.stringify(from), JSON.stringify(to)]).toEqual(before);
  });

  it("gives the same answer for the same pair of trees", () => {
    const to = bp(stack("root", [card("c"), card("a")]));
    expect(JSON.stringify(computeDiff(base(), to, "p1"))).toBe(JSON.stringify(computeDiff(base(), to, "p1")));
  });

  it("only ever asks for operations the morph engine implements", () => {
    const implemented = new Set(["add", "remove", "replace", "move", "updateProps", "updateBinding", "focus", "collapse", "expand", "highlight"]);
    const to = bp(stack("root", [card("c", { title: "x" }), stack("new", [card("b1")]), { id: "a", type: "Badge" }]));
    for (const op of computeDiff(base(), to, "p1").operations) {
      expect(implemented.has(op.op), op.op).toBe(true);
    }
  });
});
