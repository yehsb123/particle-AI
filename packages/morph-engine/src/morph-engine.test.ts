import { describe, it, expect } from "vitest";
import type { UIBlueprint, UIPatch } from "@particle/contracts";
import { UI_SCHEMA_VERSION } from "@particle/contracts";
import { applyPatch } from "./apply";
import { guardPatch } from "./guard";
import { computeDiff } from "./diff";
import { MorphHistory } from "./history";
import { DEFAULT_MORPH_POLICY } from "./policy";

const NOW = "2026-01-01T00:00:00Z";

function base(): UIBlueprint {
  return {
    schemaVersion: UI_SCHEMA_VERSION,
    workspaceId: "ws",
    mode: "development",
    root: {
      id: "root",
      type: "Stack",
      children: [
        { id: "files", type: "FileExplorer", props: { title: "Files" } },
        { id: "editor", type: "CodeEditor", volatile: true, props: { value: "x" } },
      ],
    },
    metadata: { generatedAt: NOW, decisionId: "d0", confidence: 1 },
  };
}

const addPanel: UIPatch = {
  patchId: "p-add",
  fromWorkspaceId: "ws",
  operations: [
    { op: "add", parentId: "root", index: 1, component: { id: "incident", type: "Panel", props: { title: "Incident" } } },
    { op: "collapse", targetId: "files" },
    { op: "highlight", targetId: "incident" },
  ],
};

describe("applyPatch", () => {
  it("adds, collapses and highlights", () => {
    const { next } = applyPatch(base(), addPanel, NOW);
    const ids = next.root.children!.map((c) => c.id);
    expect(ids).toContain("incident");
    const files = next.root.children!.find((c) => c.id === "files")!;
    expect(files.props!.__collapsed).toBe(true);
    const incident = next.root.children!.find((c) => c.id === "incident")!;
    expect(incident.props!.__highlighted).toBe(true);
  });

  it("does not mutate the input blueprint", () => {
    const input = base();
    const snapshot = JSON.stringify(input);
    applyPatch(input, addPanel, NOW);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it("inverse patch restores the original (round-trip)", () => {
    const input = base();
    const { next, inverse } = applyPatch(input, addPanel, NOW);
    const { next: restored } = applyPatch(next, inverse, NOW);
    expect(JSON.stringify(restored.root)).toBe(JSON.stringify(input.root));
  });

  it("round-trips remove of a subtree", () => {
    const input = base();
    const rm: UIPatch = { patchId: "rm", fromWorkspaceId: "ws", operations: [{ op: "remove", targetId: "files" }] };
    const { next, inverse } = applyPatch(input, rm, NOW);
    expect(next.root.children!.find((c) => c.id === "files")).toBeUndefined();
    const { next: restored } = applyPatch(next, inverse, NOW);
    expect(JSON.stringify(restored.root)).toBe(JSON.stringify(input.root));
  });
});

describe("guardPatch", () => {
  const removeEditor: UIPatch = {
    patchId: "p-rm-editor",
    fromWorkspaceId: "ws",
    operations: [{ op: "remove", targetId: "editor" }],
  };

  it("blocks removing a component with unsaved (volatile) state — even on critical", () => {
    const r = guardPatch({
      currentUI: base(), desiredPatch: removeEditor,
      attention: { typing: false }, confidence: 1, severity: "critical", now: 100_000,
    });
    expect(r.allowed).toBe(false);
    expect(r.reasonCodes).toContain("protects_unsaved_state");
  });

  it("enforces cooldown for non-critical events", () => {
    const r = guardPatch({
      currentUI: base(), desiredPatch: addPanel,
      attention: { typing: false }, confidence: 1, severity: "warning",
      now: 1_000, lastMorphAt: 0, policy: DEFAULT_MORPH_POLICY,
    });
    expect(r.allowed).toBe(false);
    expect(r.reasonCodes).toContain("cooldown_active");
  });

  it("lets critical events bypass cooldown", () => {
    const r = guardPatch({
      currentUI: base(), desiredPatch: { ...addPanel, operations: [{ op: "highlight", targetId: "files" }] },
      attention: { typing: false }, confidence: 1, severity: "critical",
      now: 1_000, lastMorphAt: 0,
    });
    expect(r.allowed).toBe(true);
  });

  it("drops low-confidence structural ops", () => {
    const r = guardPatch({
      currentUI: base(), desiredPatch: addPanel,
      attention: { typing: false }, confidence: 0.8, severity: "warning", now: 100_000,
    });
    // add is structural (needs 0.85); collapse/highlight are not
    expect(r.patch.operations.some((o) => o.op === "add")).toBe(false);
    expect(r.patch.operations.some((o) => o.op === "highlight")).toBe(true);
    expect(r.reasonCodes).toContain("structural_confidence_below_min");
  });

  it("protects the focused subtree while the user is typing", () => {
    const patch: UIPatch = {
      patchId: "p", fromWorkspaceId: "ws",
      operations: [{ op: "updateProps", targetId: "editor", props: { value: "clobbered" } }],
    };
    const r = guardPatch({
      currentUI: base(), desiredPatch: patch,
      attention: { typing: true, focusedComponentId: "editor" },
      confidence: 1, severity: "warning", now: 100_000,
    });
    expect(r.allowed).toBe(false);
    expect(r.reasonCodes).toContain("protects_focus");
  });
});

describe("computeDiff", () => {
  it("produces a patch that morphs current into desired", () => {
    const cur = base();
    const { next: desired } = applyPatch(cur, addPanel, NOW);
    const patch = computeDiff(cur, desired, "diff1");
    const { next: reproduced } = applyPatch(cur, patch, NOW);
    const idsA = reproduced.root.children!.map((c) => c.id).sort();
    const idsB = desired.root.children!.map((c) => c.id).sort();
    expect(idsA).toEqual(idsB);
  });
});

describe("MorphHistory", () => {
  it("supports undo via stored inverse patches", () => {
    const history = new MorphHistory();
    const input = base();
    const { next, inverse } = applyPatch(input, addPanel, NOW);
    history.push(inverse);
    expect(history.canUndo).toBe(true);
    const undo = history.pop()!;
    const { next: restored } = applyPatch(next, undo, NOW);
    expect(JSON.stringify(restored.root)).toBe(JSON.stringify(input.root));
    expect(history.canUndo).toBe(false);
  });
});
