import { describe, it, expect } from "vitest";
import { UI_SCHEMA_VERSION, type UIComponent } from "@particle/contracts";
import { parseBlueprint, parsePatch, parseComponent, collectIds, hasUniqueIds, findById, findParent } from "./index";

/**
 * This is the gate in front of the renderer: model output arrives here as data and either passes
 * or is refused with something a developer can read in the inspector. A refusal has to say what
 * was wrong and where, because that message is all anyone gets when a morph does not happen.
 */
const T = "2026-09-03T00:00:00Z";
const card = (id: string): UIComponent => ({ id, type: "Card" });
const stack = (id: string, children: UIComponent[]): UIComponent => ({ id, type: "Stack", children });

const bp = (root: UIComponent, over: Record<string, unknown> = {}) => ({
  schemaVersion: UI_SCHEMA_VERSION,
  workspaceId: "ws",
  mode: "development",
  root,
  metadata: { generatedAt: T, decisionId: "d1", confidence: 1 },
  ...over,
});

const tree = () => stack("root", [card("a"), stack("b", [card("b1"), card("b2")]), card("c")]);

describe("parseBlueprint", () => {
  it("accepts a blueprint and hands back the parsed value", () => {
    const r = parseBlueprint(bp(tree()));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.root.id).toBe("root");
  });

  it("refuses a blueprint from another build, since the renderer only speaks this one", () => {
    const r = parseBlueprint(bp(tree(), { schemaVersion: "9.9.9" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("schemaVersion");
  });

  it("refuses duplicate ids anywhere in the tree, and names the id", () => {
    const r = parseBlueprint(bp(stack("root", [card("a"), stack("b", [card("a")])])));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("duplicate component id: a");
  });

  it("points at the path of the component it could not read", () => {
    const r = parseBlueprint(bp(stack("root", [stack("b", [{ id: "deep", type: "NotAComponent" } as unknown as UIComponent])])));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("root.children.0.children.0.type");
      expect(r.issues.length).toBeGreaterThan(0);
      expect(r.issues[0]?.path).toContain("children");
    }
  });

  it("refuses nothing at all, and things that are not objects", () => {
    for (const bad of [undefined, null, "a blueprint", 42, [], {}]) {
      expect(parseBlueprint(bad).ok, JSON.stringify(bad) ?? "undefined").toBe(false);
    }
  });

  it("carries every issue, not just the first, so one pass shows all of them", () => {
    const r = parseBlueprint({ schemaVersion: "9.9.9", workspaceId: "", mode: "nonsense", root: tree(), metadata: { generatedAt: "yesterday", decisionId: "d", confidence: 5 } });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.length).toBeGreaterThan(2);
      expect(r.error.split("; ").length).toBe(r.issues.length);
    }
  });
});

describe("parsePatch", () => {
  const patch = (operations: unknown[]) => ({ patchId: "p1", fromWorkspaceId: "ws", operations });

  it("accepts a patch of known operations", () => {
    const r = parsePatch(patch([{ op: "add", parentId: "root", index: 0, component: card("z") }, { op: "focus", targetId: "a" }]));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.operations).toHaveLength(2);
  });

  it("takes an empty patch — nothing to do is a legitimate answer", () => {
    expect(parsePatch(patch([])).ok).toBe(true);
  });

  it("refuses an operation the morph engine does not implement", () => {
    expect(parsePatch(patch([{ op: "explode", targetId: "a" }])).ok).toBe(false);
  });

  it("refuses a negative or fractional index, and says which", () => {
    const negative = parsePatch(patch([{ op: "add", parentId: "root", index: -1, component: card("z") }]));
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.error).toContain("operations.0.index");
    expect(parsePatch(patch([{ op: "add", parentId: "root", index: 1.5, component: card("z") }])).ok).toBe(false);
  });

  it("refuses an empty target or parent id", () => {
    expect(parsePatch(patch([{ op: "remove", targetId: "" }])).ok).toBe(false);
    expect(parsePatch(patch([{ op: "add", parentId: "", component: card("z") }])).ok).toBe(false);
    expect(parsePatch({ patchId: "", fromWorkspaceId: "ws", operations: [] }).ok).toBe(false);
  });

  it("checks the component a patch carries as strictly as a blueprint does", () => {
    expect(parsePatch(patch([{ op: "add", parentId: "root", component: { id: "z", type: "Fictional" } }])).ok).toBe(false);
    expect(parsePatch(patch([{ op: "add", parentId: "root", component: { type: "Card" } }])).ok).toBe(false);
  });
});

describe("parseComponent", () => {
  it("accepts a registry type and refuses an invented one", () => {
    expect(parseComponent(card("a")).ok).toBe(true);
    expect(parseComponent({ id: "a", type: "Invented" }).ok).toBe(false);
  });

  it("checks children all the way down", () => {
    expect(parseComponent(stack("root", [stack("b", [card("b1")])])).ok).toBe(true);
    expect(parseComponent(stack("root", [stack("b", [{ id: "x", type: "Nope" } as unknown as UIComponent])])).ok).toBe(false);
  });
});

describe("walking a tree", () => {
  it("collects ids depth-first", () => {
    expect(collectIds(tree())).toEqual(["root", "a", "b", "b1", "b2", "c"]);
    expect(collectIds(card("only"))).toEqual(["only"]);
  });

  it("appends to a list it is given, so subtrees can be gathered together", () => {
    const acc = ["existing"];
    expect(collectIds(card("a"), acc)).toBe(acc);
    expect(acc).toEqual(["existing", "a"]);
  });

  it("reports whether the ids are unique, at any depth", () => {
    expect(hasUniqueIds(tree())).toBe(true);
    expect(hasUniqueIds(stack("root", [card("a"), card("a")]))).toBe(false);
    expect(hasUniqueIds(stack("root", [card("a"), stack("b", [card("a")])]))).toBe(false);
    expect(hasUniqueIds(stack("root", [stack("root", [])]))).toBe(false);
  });

  it("finds a node anywhere, including the root, and nothing for an unknown id", () => {
    expect(findById(tree(), "root")?.type).toBe("Stack");
    expect(findById(tree(), "b2")?.id).toBe("b2");
    expect(findById(tree(), "ghost")).toBeUndefined();
    expect(findById(tree(), "")).toBeUndefined();
  });

  it("finds a node's parent, and says nothing for the root — it has none", () => {
    expect(findParent(tree(), "b2")?.id).toBe("b");
    expect(findParent(tree(), "a")?.id).toBe("root");
    expect(findParent(tree(), "root")).toBeUndefined();
    expect(findParent(tree(), "ghost")).toBeUndefined();
  });

  it("handles a childless node without pretending it has children", () => {
    expect(collectIds(card("lonely"))).toEqual(["lonely"]);
    expect(findParent(card("lonely"), "anything")).toBeUndefined();
    expect(hasUniqueIds(card("lonely"))).toBe(true);
  });
});
