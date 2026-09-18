import { describe, it, expect } from "vitest";
import {
  UIBlueprint,
  UIPatch,
  MAX_TREE_DEPTH,
  MAX_TREE_NODES,
  MAX_PATCH_OPERATIONS,
} from "@particle/contracts";
import { applyPatch, MorphApplyError } from "./apply";

/**
 * The tree limits are checked when a blueprint is PARSED. A patch is applied to the tree already
 * in memory, so nothing checked what came out of applying one.
 *
 * Measured: one patch adding two and a half thousand children made 2,501 nodes where the schema
 * allows 2,000, and a hundred and forty patches each adding one child under the last made a tree
 * 141 deep where it allows 100. Neither parses as a blueprint afterwards — so the runtime would
 * broadcast a body that the body's own gate refuses, write it into a snapshot, and fail to restore
 * it on resume, while believing all three had worked. The walks in apply.ts recurse on that tree,
 * and the stack they recurse on is smaller on CI than it is here.
 *
 * A patch also carried as many operations as a model cared to write: fifty thousand parsed, and
 * every one of them was walked.
 */
const AT = "2026-09-18T00:00:00.000Z";
const leaf = (id: string) => ({ id, type: "Text", props: { text: "x" } });
const blueprint = (root: unknown) =>
  UIBlueprint.parse({
    schemaVersion: "1.0.0",
    workspaceId: "ws",
    goal: "g",
    mode: "development",
    root,
    metadata: { generatedAt: AT, decisionId: "d", confidence: 1, reasonSummary: "r" },
  });
const empty = () => blueprint({ id: "root", type: "Stack", props: {}, children: [] });
const patchOf = (operations: unknown[]) => UIPatch.parse({ patchId: "p", fromWorkspaceId: "ws", operations });

const depthOf = (node: unknown): number => {
  let max = 0;
  const pending: { n: { children?: unknown[] }; d: number }[] = [{ n: node as { children?: unknown[] }, d: 1 }];
  while (pending.length) {
    const step = pending.pop()!;
    if (step.d > max) max = step.d;
    for (const c of step.n.children ?? []) pending.push({ n: c as { children?: unknown[] }, d: step.d + 1 });
  }
  return max;
};
const countOf = (node: unknown): number => {
  let seen = 0;
  const pending: { children?: unknown[] }[] = [node as { children?: unknown[] }];
  while (pending.length) {
    const n = pending.pop()!;
    seen += 1;
    for (const c of n.children ?? []) pending.push(c as { children?: unknown[] });
  }
  return seen;
};

describe("how large a patch may be", () => {
  it("is as large as a full diff between two trees, and no larger", () => {
    const ops = Array.from({ length: MAX_PATCH_OPERATIONS + 1 }, (_, i) => ({ op: "add", parentId: "root", component: leaf("n" + i) }));
    expect(UIPatch.safeParse({ patchId: "p", fromWorkspaceId: "ws", operations: ops }).success).toBe(false);
    expect(UIPatch.safeParse({ patchId: "p", fromWorkspaceId: "ws", operations: ops.slice(0, MAX_PATCH_OPERATIONS) }).success).toBe(true);
  });

  it("is a size a real patch never reaches", () => {
    // a full rebuild is a single replace of the root; a diff is adds, moves, updates and removes
    // across at most MAX_TREE_NODES nodes each side
    expect(MAX_PATCH_OPERATIONS).toBeGreaterThanOrEqual(2 * MAX_TREE_NODES);
  });
});

describe("what applying a patch is allowed to produce", () => {
  it("is the patched body, when it is still a body", () => {
    const { next } = applyPatch(empty(), patchOf([{ op: "add", parentId: "root", component: leaf("a") }]), AT);
    expect(countOf(next.root)).toBe(2);
    expect(UIBlueprint.safeParse(next).success).toBe(true);
  });

  it("is not a tree wider than a tree may be", () => {
    const ops = Array.from({ length: MAX_TREE_NODES + 100 }, (_, i) => ({ op: "add", parentId: "root", component: leaf("w" + i) }));
    expect(() => applyPatch(empty(), patchOf(ops), AT)).toThrow(MorphApplyError);
  });

  it("is not a tree deeper than a tree may be, however many patches it took", () => {
    // each patch on its own is unremarkable; it is the tree they build together that is not one
    let bp = empty();
    let deepest = "root";
    let applied = 0;
    let refused: unknown;
    try {
      for (let i = 0; i < MAX_TREE_DEPTH + 40; i++) {
        const id = "d" + i;
        bp = applyPatch(bp, patchOf([{ op: "add", parentId: deepest, component: leaf(id) }]), AT).next;
        deepest = id;
        applied += 1;
      }
    } catch (err) {
      refused = err;
    }
    expect(refused).toBeInstanceOf(MorphApplyError);
    expect(depthOf(bp.root)).toBeLessThanOrEqual(MAX_TREE_DEPTH);
    expect(applied).toBeGreaterThan(MAX_TREE_DEPTH - 5); // it stops at the limit, not well before it
  });

  it("leaves the blueprint it was given alone when it refuses", () => {
    const before = empty();
    const snapshot = JSON.stringify(before);
    const ops = Array.from({ length: MAX_TREE_NODES + 100 }, (_, i) => ({ op: "add", parentId: "root", component: leaf("w" + i) }));
    expect(() => applyPatch(before, patchOf(ops), AT)).toThrow(MorphApplyError);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("hands back something the body's own gate accepts", () => {
    // this is the whole point: what the runtime broadcasts, snapshots and restores is one thing
    let bp = empty();
    for (let i = 0; i < 50; i++) {
      bp = applyPatch(bp, patchOf([{ op: "add", parentId: "root", component: leaf("n" + i) }]), AT).next;
    }
    expect(UIBlueprint.safeParse(bp).success).toBe(true);
  });

  it("still undoes what it applied", () => {
    // an inverse returns the tree to a state that was already within the limits, so the new
    // check cannot make an undo impossible
    const start = empty();
    const { next, inverse } = applyPatch(start, patchOf([{ op: "add", parentId: "root", component: leaf("a") }]), AT);
    expect(countOf(next.root)).toBe(2);
    const back = applyPatch(next, inverse, AT).next;
    // structurally back, not byte-identical: emptying a parent drops its children key, which is
    // what pruneIfEmptied has always done and is nothing to do with the new limit
    expect(countOf(back.root)).toBe(1);
    expect(back.root.id).toBe(start.root.id);
    expect(UIBlueprint.safeParse(back).success).toBe(true);
  });
});
