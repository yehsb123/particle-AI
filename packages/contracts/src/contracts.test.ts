import { describe, it, expect } from "vitest";
import { UIBlueprint, UIPatch, MatterEvent, UI_SCHEMA_VERSION } from "./index";

const goodBlueprint = {
  schemaVersion: UI_SCHEMA_VERSION,
  workspaceId: "ws1",
  mode: "development",
  root: { id: "root", type: "Stack", children: [{ id: "t", type: "Text", props: { text: "hi" } }] },
  metadata: { generatedAt: "2026-01-01T00:00:00Z", decisionId: "d1", confidence: 0.9 },
};

describe("contracts", () => {
  it("accepts a valid blueprint", () => {
    expect(UIBlueprint.safeParse(goodBlueprint).success).toBe(true);
  });

  it("rejects a component with an unknown type", () => {
    const bad = structuredClone(goodBlueprint);
    (bad.root.children[0] as { type: string }).type = "NotAComponent";
    expect(UIBlueprint.safeParse(bad).success).toBe(false);
  });

  it("rejects confidence outside 0..1", () => {
    const bad = structuredClone(goodBlueprint);
    bad.metadata.confidence = 1.5;
    expect(UIBlueprint.safeParse(bad).success).toBe(false);
  });

  it("validates a discriminated patch and rejects an unknown op", () => {
    const good = {
      patchId: "p1",
      fromWorkspaceId: "ws1",
      operations: [{ op: "remove", targetId: "t" }],
    };
    expect(UIPatch.safeParse(good).success).toBe(true);
    const bad = { patchId: "p1", fromWorkspaceId: "ws1", operations: [{ op: "teleport", targetId: "t" }] };
    expect(UIPatch.safeParse(bad).success).toBe(false);
  });

  it("validates a MatterEvent", () => {
    const ev = {
      id: "e1", sessionId: "s1", timestamp: "2026-01-01T00:00:00Z",
      source: "development", type: "development.server_error", severity: "critical", payload: {},
    };
    expect(MatterEvent.safeParse(ev).success).toBe(true);
  });
});
