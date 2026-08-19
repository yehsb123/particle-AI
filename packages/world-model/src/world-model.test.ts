import { describe, it, expect } from "vitest";
import { reduce } from "./index";
import { emptyWorldState, type MatterEvent } from "@dm/contracts";

const T = "2026-08-19T00:00:00Z";
function ev(type: string, extra: Partial<MatterEvent> = {}): MatterEvent {
  return {
    id: `e-${type}-${Math.random().toString(36).slice(2)}`,
    sessionId: "s", timestamp: T, source: "development", type,
    severity: "info", payload: {}, ...extra,
  };
}

describe("world-model reduce", () => {
  it("opens a runtime problem on server_error and marks API failed", () => {
    const s = reduce(emptyWorldState("s", T), ev("development.server_error", { severity: "critical" }));
    expect(s.activeProblems).toHaveLength(1);
    expect(s.activeProblems[0]!.kind).toBe("runtime_error");
    expect(s.environment.processes).toContainEqual({ name: "API", state: "failed" });
    expect(s.activeContext.activity).toBe("development");
  });

  it("does not duplicate a problem of the same kind", () => {
    let s = reduce(emptyWorldState("s", T), ev("development.server_error"));
    s = reduce(s, ev("development.server_error"));
    expect(s.activeProblems).toHaveLength(1);
  });

  it("closes the problem on recovery and restores API health", () => {
    let s = reduce(emptyWorldState("s", T), ev("development.server_error"));
    s = reduce(s, ev("development.server_recovered"));
    expect(s.activeProblems).toHaveLength(0);
    expect(s.environment.processes).toContainEqual({ name: "API", state: "healthy" });
  });

  it("tracks opened files and focus", () => {
    let s = reduce(emptyWorldState("s", T), ev("user.opened_file", { source: "user", payload: { path: "src/db.ts" } }));
    expect(s.environment.files).toContain("src/db.ts");
    expect(s.activeContext.focusedEntity).toBe("src/db.ts");
    s = reduce(s, ev("user.focus_changed", { source: "user", payload: { componentId: "editor", typing: true } }));
    expect(s.attention.focusedComponentId).toBe("editor");
    expect(s.attention.typing).toBe(true);
  });

  it("bounds recentEvents and never mutates the previous state", () => {
    const prev = emptyWorldState("s", T);
    const frozen = JSON.stringify(prev);
    const next = reduce(prev, ev("development.build_started"));
    expect(JSON.stringify(prev)).toBe(frozen);
    expect(next.recentEvents).toHaveLength(1);
  });
});
