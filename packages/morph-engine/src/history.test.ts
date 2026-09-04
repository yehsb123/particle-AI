import { describe, it, expect } from "vitest";
import type { UIPatch } from "@particle/contracts";
import { MorphHistory } from "./history";

/**
 * Undo is the promise that nothing the runtime does to the interface is permanent, and this
 * stack is what backs it. It is bounded, because a session can run all day; what matters is
 * that the bound never costs the most recent steps, and that running out is reported honestly
 * rather than by handing back nothing and pretending.
 */
const patch = (id: string): UIPatch => ({ patchId: id, fromWorkspaceId: "ws", operations: [] });

describe("the stack", () => {
  it("says nothing to undo before anything happened", () => {
    const h = new MorphHistory();
    expect(h.canUndo).toBe(false);
    expect(h.depth).toBe(0);
    expect(h.peek()).toBeUndefined();
    expect(h.pop()).toBeUndefined();
  });

  it("hands back the newest step first", () => {
    const h = new MorphHistory();
    for (const id of ["a", "b", "c"]) h.push(patch(id));
    expect(h.depth).toBe(3);
    expect(h.peek()?.patchId).toBe("c");
    expect([h.pop()?.patchId, h.pop()?.patchId, h.pop()?.patchId]).toEqual(["c", "b", "a"]);
    expect(h.canUndo).toBe(false);
  });

  it("looking does not take", () => {
    const h = new MorphHistory();
    h.push(patch("a"));
    expect(h.peek()?.patchId).toBe("a");
    expect(h.peek()?.patchId).toBe("a");
    expect(h.depth).toBe(1);
  });

  it("keeps the most recent steps when it runs out of room, never the oldest", () => {
    const h = new MorphHistory(3);
    for (const id of ["a", "b", "c", "d", "e"]) h.push(patch(id));
    expect(h.depth).toBe(3);
    expect([h.pop()?.patchId, h.pop()?.patchId, h.pop()?.patchId]).toEqual(["e", "d", "c"]);
  });

  it("holds fifty steps unless told otherwise", () => {
    const h = new MorphHistory();
    for (let i = 0; i < 60; i += 1) h.push(patch(`p${i}`));
    expect(h.depth).toBe(50);
    expect(h.peek()?.patchId).toBe("p59");
  });

  it("works with room for a single step", () => {
    const h = new MorphHistory(1);
    h.push(patch("a"));
    h.push(patch("b"));
    expect(h.depth).toBe(1);
    expect(h.pop()?.patchId).toBe("b");
  });

  it("empties on clear, and can be used again after", () => {
    const h = new MorphHistory();
    h.push(patch("a"));
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.depth).toBe(0);
    expect(h.peek()).toBeUndefined();
    h.push(patch("b"));
    expect(h.peek()?.patchId).toBe("b");
  });

  it("makes room again once steps are taken off", () => {
    const h = new MorphHistory(2);
    h.push(patch("a"));
    h.push(patch("b"));
    h.pop();
    h.push(patch("c"));
    expect(h.depth).toBe(2);
    expect([h.pop()?.patchId, h.pop()?.patchId]).toEqual(["c", "a"]);
  });

  it("agrees with itself about whether there is anything to undo", () => {
    const h = new MorphHistory(3);
    for (let i = 0; i < 5; i += 1) {
      h.push(patch(`p${i}`));
      expect(h.canUndo).toBe(h.depth > 0);
      expect(h.canUndo).toBe(h.peek() !== undefined);
    }
    while (h.canUndo) h.pop();
    expect(h.depth).toBe(0);
    expect(h.peek()).toBeUndefined();
  });
});
