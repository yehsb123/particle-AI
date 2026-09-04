import { describe, it, expect } from "vitest";
import type { UIBlueprint, UIPatch, UIPatchOperation } from "@particle/contracts";
import { UI_SCHEMA_VERSION, MORPH_HOLD_REASONS } from "@particle/contracts";
import { guardPatch } from "./guard";
import { DEFAULT_MORPH_POLICY } from "./policy";

/**
 * The guard is what keeps the body from jumping around and from eating unsaved work. The main
 * suite covers the common paths; this one pins the edges: which rejections a critical event may
 * bypass and which it may never, partial patches (some ops dropped, the rest applied), dwell for
 * major transformations, and every op kind that can clobber unsaved state.
 */
const NOW = "2026-09-03T00:00:00Z";

function ui(): UIBlueprint {
  return {
    schemaVersion: UI_SCHEMA_VERSION,
    workspaceId: "ws",
    mode: "development",
    root: {
      id: "root",
      type: "Stack",
      children: [
        { id: "files", type: "FileExplorer", props: { title: "Files" } },
        {
          id: "work",
          type: "Stack",
          children: [{ id: "editor", type: "CodeEditor", volatile: true, props: { value: "unsaved" } }],
        },
        { id: "status", type: "Card", props: { title: "Status" } },
      ],
    },
    metadata: { generatedAt: NOW, decisionId: "d", confidence: 1 },
  };
}
const patch = (...operations: UIPatchOperation[]): UIPatch => ({ patchId: "p", fromWorkspaceId: "ws", operations });
const guard = (p: UIPatch, over: Partial<Parameters<typeof guardPatch>[0]> = {}) =>
  guardPatch({ currentUI: ui(), desiredPatch: p, attention: { typing: false }, confidence: 1, severity: "warning", now: 1_000_000, ...over });

describe("guard — confidence thresholds", () => {
  it("rejects the whole patch below the plain minimum, and says so once", () => {
    const r = guard(patch({ op: "highlight", targetId: "status" }), { confidence: DEFAULT_MORPH_POLICY.minConfidence - 0.01 });
    expect(r.allowed).toBe(false);
    expect(r.reasonCodes).toEqual(["confidence_below_min"]);
    expect(r.patch.operations).toEqual([]);
  });

  it("drops only the structural ops between the two thresholds — the cosmetic ones still apply", () => {
    const conf = (DEFAULT_MORPH_POLICY.minConfidence + DEFAULT_MORPH_POLICY.minConfidenceStructural) / 2;
    const r = guard(
      patch(
        { op: "add", parentId: "root", index: 3, component: { id: "new", type: "Card", props: {} } },
        { op: "highlight", targetId: "status" },
      ),
      { confidence: conf },
    );
    expect(r.allowed).toBe(true); // a partial patch is better than nothing
    expect(r.patch.operations.map((o) => o.op)).toEqual(["highlight"]);
    expect(r.dropped.map((d) => d.reason)).toEqual(["structural_confidence_below_min"]);
  });

  it("a critical event may bypass both confidence gates", () => {
    const r = guard(patch({ op: "add", parentId: "root", index: 3, component: { id: "n", type: "Card", props: {} } }), { confidence: 0.1, severity: "critical" });
    expect(r.allowed).toBe(true);
    expect(r.reasonCodes).toEqual([]);
  });
});

describe("guard — timing", () => {
  it("holds inside the cooldown and allows the same patch once it expires", () => {
    const op = patch({ op: "highlight", targetId: "status" });
    const inside = guard(op, { now: 1_000_000, lastMorphAt: 1_000_000 - (DEFAULT_MORPH_POLICY.cooldownMs - 1) });
    expect(inside.allowed).toBe(false);
    expect(inside.reasonCodes).toContain("cooldown_active");
    const after = guard(op, { now: 1_000_000, lastMorphAt: 1_000_000 - DEFAULT_MORPH_POLICY.cooldownMs });
    expect(after.allowed).toBe(true);
  });

  it("holds a MAJOR transformation for the dwell time, but not a small one", () => {
    // three structural ops against a four-node tree crosses majorChangeRatio
    const major = patch(
      { op: "remove", targetId: "files" },
      { op: "remove", targetId: "status" },
      { op: "add", parentId: "root", index: 0, component: { id: "big", type: "Panel", props: {} } },
    );
    const held = guard(major, { lastMajorMorphAt: 1_000_000 - (DEFAULT_MORPH_POLICY.majorDwellMs - 1) });
    expect(held.allowed).toBe(false);
    expect(held.reasonCodes).toContain("major_dwell_active");

    const small = patch({ op: "add", parentId: "root", index: 3, component: { id: "one", type: "Card", props: {} } });
    expect(guard(small, { lastMajorMorphAt: 1_000_000 - 1 }).allowed).toBe(true);
  });

  it("a critical event bypasses cooldown and dwell — but never the unsaved-work rule", () => {
    const r = guard(
      patch({ op: "remove", targetId: "files" }, { op: "remove", targetId: "work" }),
      { severity: "critical", lastMorphAt: 1_000_000, lastMajorMorphAt: 1_000_000 },
    );
    expect(r.patch.operations.map((o) => ("targetId" in o ? o.targetId : ""))).toEqual(["files"]);
    expect(r.dropped.map((d) => d.reason)).toEqual(["protects_unsaved_state"]); // `work` holds the unsaved editor
  });
});

describe("guard — unsaved work and focus", () => {
  it("refuses every op kind that could clobber an unsaved subtree, from any ancestor", () => {
    const kinds: UIPatchOperation[] = [
      { op: "remove", targetId: "work" },
      { op: "replace", targetId: "work", component: { id: "work", type: "Card", props: {} } },
      { op: "move", targetId: "work", newParentId: "root", index: 0 },
      { op: "updateProps", targetId: "editor", props: { value: "clobbered" } },
      { op: "updateBinding", targetId: "editor", bindings: [{ prop: "value", source: "capability:x:y" }] },
    ];
    for (const op of kinds) {
      const r = guard(patch(op), { severity: "critical", confidence: 1 });
      expect(r.allowed, op.op).toBe(false);
      expect(r.reasonCodes, op.op).toContain("protects_unsaved_state");
    }
  });

  it("still allows harmless ops on the unsaved subtree (highlight, collapse)", () => {
    const r = guard(patch({ op: "highlight", targetId: "editor" }, { op: "collapse", targetId: "work" }));
    expect(r.allowed).toBe(true);
    expect(r.dropped).toEqual([]);
  });

  it("protects the focused subtree only while typing, and only along its own path", () => {
    const typing = { typing: true, focusedComponentId: "editor" } as const;
    // an ancestor of the focused node may not be replaced while typing
    const ancestor = guard(patch({ op: "replace", targetId: "work", component: { id: "work", type: "Card", props: {} } }), { attention: typing });
    expect(ancestor.reasonCodes).toContain("protects_unsaved_state"); // unsaved rule fires first here
    // a sibling is fair game even while typing
    const sibling = guard(patch({ op: "remove", targetId: "files" }), { attention: typing });
    expect(sibling.allowed).toBe(true);
    // props of the focused node itself are held
    const focusedProps = guard(patch({ op: "updateProps", targetId: "status", props: { title: "x" } }), {
      attention: { typing: true, focusedComponentId: "status" },
    });
    expect(focusedProps.allowed).toBe(false);
    expect(focusedProps.reasonCodes).toContain("protects_focus");
    // not typing → the same op goes through
    expect(guard(patch({ op: "updateProps", targetId: "status", props: { title: "x" } })).allowed).toBe(true);
  });
});

describe("guard — pure and predictable", () => {
  it("never mutates its input and reports each reason once", () => {
    const before = ui();
    const snapshot = JSON.stringify(before);
    const p = patch({ op: "remove", targetId: "work" }, { op: "updateProps", targetId: "editor", props: { value: "y" } });
    const r = guardPatch({ currentUI: before, desiredPatch: p, attention: { typing: false }, confidence: 1, severity: "warning", now: 1 });
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(JSON.stringify(p.operations)).toContain("remove"); // the desired patch is untouched
    expect(r.reasonCodes).toEqual(["protects_unsaved_state"]); // deduplicated
    expect(r.dropped).toHaveLength(2);
  });

  it("an empty patch is not allowed (nothing to apply)", () => {
    expect(guard(patch()).allowed).toBe(false);
  });
});

describe("every reason the guard gives is one the body has words for", () => {
  it("only ever answers with a canonical hold reason", () => {
    // the body turns these into a sentence in the reader's language, so a code outside the
    // canonical list would reach the screen as a bare identifier
    const seen = new Set<string>();
    const collect = (r: { reasonCodes: string[]; dropped: { reason: string }[] }) => {
      r.reasonCodes.forEach((c) => seen.add(c));
      r.dropped.forEach((d) => seen.add(d.reason));
    };

    collect(guard(patch({ op: "highlight", targetId: "status" }), { confidence: 0.1 }));
    collect(guard(patch({ op: "highlight", targetId: "status" }), { now: 1_000, lastMorphAt: 900 }));
    collect(guard(patch({ op: "add", parentId: "root", index: 3, component: { id: "new", type: "Card", props: {} } }), { now: 1_000, lastMajorMorphAt: 900 }));
    collect(guard(patch({ op: "remove", targetId: "editor" })));
    collect(guard(patch({ op: "replace", targetId: "status", component: { id: "status", type: "Badge" } }), { attention: { typing: true, focusedComponentId: "status" } }));

    expect(seen.size).toBeGreaterThan(2);
    for (const code of seen) expect(MORPH_HOLD_REASONS as readonly string[], code).toContain(code);
  });
});
