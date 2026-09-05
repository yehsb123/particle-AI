import { describe, it, expect } from "vitest";
import {
  UIBlueprint,
  UIPatch,
  UIComponent,
  UI_SCHEMA_VERSION,
  MAX_IDENTIFIER,
  MAX_TREE_DEPTH,
  MAX_TREE_NODES,
  withinTreeLimits,
} from "./index";

/**
 * The blueprint schema is the gate in front of the renderer, and it is recursive: validating a
 * tree walks it with the call stack. A tree deep enough overflowed that stack inside the
 * validator, so the gate threw instead of refusing — and the gate dying is worse than the gate
 * saying no, because whatever called it goes down too, which in the body is the whole interface.
 *
 * A tree is measured first now, without recursing, so one that would take the validator down is
 * turned away by it instead.
 */
const T = "2026-09-06T00:00:00Z";
const wrap = (root: unknown) => ({
  schemaVersion: UI_SCHEMA_VERSION,
  workspaceId: "w",
  mode: "development",
  root,
  metadata: { generatedAt: T, decisionId: "d", confidence: 0.9 },
});

const deep = (n: number) => {
  let node: Record<string, unknown> = { id: "leaf", type: "Text", props: { text: "x" } };
  for (let i = 0; i < n; i += 1) node = { id: `n${i}`, type: "Stack", props: {}, children: [node] };
  return node;
};
const wide = (n: number) => ({
  id: "root",
  type: "Stack",
  props: {},
  children: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, type: "Text", props: { text: `${i}` } })),
});

describe("a tree too deep to walk", () => {
  it("is refused, not thrown over", () => {
    // A result at all is the point: this used to be "Maximum call stack size exceeded" raised
    // out of safeParse itself, which takes the caller down instead of telling it no.
    const tree = deep(5_000);
    expect(UIComponent.safeParse(tree).success).toBe(false);
    expect(UIBlueprint.safeParse(wrap(tree)).success).toBe(false);
  });

  it("is refused well before the stack is the thing that stops it", () => {
    expect(UIBlueprint.safeParse(wrap(deep(MAX_TREE_DEPTH + 5))).success).toBe(false);
    expect(UIBlueprint.safeParse(wrap(deep(500))).success).toBe(false);
  });

  it("leaves room for anything the registry actually builds", () => {
    expect(UIBlueprint.safeParse(wrap(deep(10))).success).toBe(true);
    expect(UIBlueprint.safeParse(wrap(deep(60))).success).toBe(true);
    expect(MAX_TREE_DEPTH).toBeGreaterThan(60);
  });
});

describe("a tree too large to draw", () => {
  it("is refused rather than walked", () => {
    expect(UIBlueprint.safeParse(wrap(wide(50_000))).success).toBe(false);
    expect(UIBlueprint.safeParse(wrap(wide(MAX_TREE_NODES + 10))).success).toBe(false);
  });

  it("leaves room for a real workspace", () => {
    expect(UIBlueprint.safeParse(wrap(wide(50))).success).toBe(true);
  });

  it("is refused quickly, rather than after walking all of it", () => {
    const started = Date.now();
    UIBlueprint.safeParse(wrap(wide(50_000)));
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("measuring a tree", () => {
  it("counts what is there without recursing into it", () => {
    expect(withinTreeLimits(deep(10))).toBe(true);
    expect(withinTreeLimits(deep(MAX_TREE_DEPTH + 1))).toBe(false);
    expect(withinTreeLimits(wide(MAX_TREE_NODES + 1))).toBe(false);
  });

  it("lets anything that is not a tree through to the schema, which says why", () => {
    // measuring is not validating: the schema is what explains a component that is not one
    for (const notATree of [null, undefined, 7, "root", true]) {
      expect(withinTreeLimits(notATree), String(notATree)).toBe(true);
      expect(UIComponent.safeParse(notATree).success, String(notATree)).toBe(false);
    }
  });

  it("is not confused by children that are not components", () => {
    expect(withinTreeLimits({ id: "n", type: "Stack", children: [null, 7, "x"] })).toBe(true);
    expect(withinTreeLimits({ id: "n", type: "Stack", children: "not a list" })).toBe(true);
  });
});

describe("a patch carrying a tree", () => {
  const patch = (component: unknown) => ({
    patchId: "p1",
    decisionId: "d1",
    fromWorkspaceId: "w",
    operations: [{ op: "add", parentId: "root", component }],
  });

  it("is measured the same way", () => {
    expect(UIPatch.safeParse(patch(deep(5_000))).success).toBe(false);
    expect(UIPatch.safeParse(patch(wide(50_000))).success).toBe(false);
  });

  it("still takes the patches the registry builds", () => {
    expect(UIPatch.safeParse(patch({ id: "incident", type: "Panel", props: { title: "Runtime incident" } })).success).toBe(true);
  });
});

describe("the id a morph addresses a component by", () => {
  it("is held to the length every other identifier is", () => {
    expect(UIComponent.safeParse({ id: "a".repeat(MAX_IDENTIFIER), type: "Text", props: {} }).success).toBe(true);
    expect(UIComponent.safeParse({ id: "a".repeat(MAX_IDENTIFIER + 1), type: "Text", props: {} }).success).toBe(false);
    expect(UIComponent.safeParse({ id: "a".repeat(50_000), type: "Text", props: {} }).success).toBe(false);
  });

  it("is refused rather than trimmed", () => {
    // two long ids cut to the same length would be the same component as far as every later
    // patch could tell, and a morph addresses components by id
    const first = UIComponent.safeParse({ id: `${"a".repeat(MAX_IDENTIFIER)}-one`, type: "Text", props: {} });
    const second = UIComponent.safeParse({ id: `${"a".repeat(MAX_IDENTIFIER)}-two`, type: "Text", props: {} });
    expect(first.success).toBe(false);
    expect(second.success).toBe(false);
  });

  it("still takes the ids the registry uses", () => {
    for (const id of ["root", "editor", "incident", "context-dismiss", "files"]) {
      expect(UIComponent.safeParse({ id, type: "Panel", props: {} }).success, id).toBe(true);
    }
  });
});
