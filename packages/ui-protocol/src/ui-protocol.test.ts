import { describe, it, expect } from "vitest";
import { parseBlueprint, collectIds, hasUniqueIds, findById, findParent } from "./index";
import type { UIComponent } from "@dm/contracts";

const tree: UIComponent = {
  id: "root",
  type: "Stack",
  children: [
    { id: "a", type: "Text", props: { text: "a" } },
    { id: "b", type: "Panel", children: [{ id: "c", type: "Text", props: { text: "c" } }] },
  ],
};

describe("ui-protocol", () => {
  it("collects ids depth-first", () => {
    expect(collectIds(tree)).toEqual(["root", "a", "b", "c"]);
  });

  it("detects unique vs duplicate ids", () => {
    expect(hasUniqueIds(tree)).toBe(true);
    const dup: UIComponent = { id: "x", type: "Stack", children: [{ id: "x", type: "Text" }] };
    expect(hasUniqueIds(dup)).toBe(false);
  });

  it("finds nodes and parents by id", () => {
    expect(findById(tree, "c")?.type).toBe("Text");
    expect(findParent(tree, "c")?.id).toBe("b");
    expect(findById(tree, "missing")).toBeUndefined();
  });

  it("parseBlueprint returns a typed error for bad input", () => {
    const r = parseBlueprint({ nope: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
  });
});
