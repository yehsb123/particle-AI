import { describe, it, expect } from "vitest";
import { reduce } from "./index";
import { emptyWorldState, type MatterEvent } from "@particle/contracts";

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

describe("world-model network shape (Concept v2, L2)", () => {
  const net = (payload: Record<string, unknown>, id: string) =>
    ev("network.request", { source: "sensor", payload, id, severity: "info" });

  it("counts requests/slow and opens a network_failure problem on 5xx (host only)", () => {
    let s = reduce(emptyWorldState("s", T), net({ host: "api.example.com", status: 200, ms: 120 }, "n1"));
    s = reduce(s, net({ host: "api.example.com", status: 200, ms: 2500 }, "n2"));
    expect(s.behavior.network.requests).toBe(2);
    expect(s.behavior.network.slow).toBe(1);
    s = reduce(s, net({ host: "api.example.com", status: 503 }, "n3"));
    expect(s.behavior.network.failures).toBe(1);
    expect(s.behavior.network.failingHosts).toEqual(["api.example.com"]);
    expect(s.activeProblems.some((p) => p.kind === "network_failure")).toBe(true);
    expect(s.activeProblems[0]!.summary).not.toMatch(/\?|\/api/); // no path/query leaks
  });

  it("clears the network problem once the failing host succeeds again", () => {
    let s = reduce(emptyWorldState("s", T), net({ host: "api.example.com", status: 502 }, "n1"));
    expect(s.activeProblems).toHaveLength(1);
    s = reduce(s, net({ host: "api.example.com", status: 200, ms: 90 }, "n2"));
    expect(s.activeProblems).toHaveLength(0);
    expect(s.behavior.network.failingHosts).toEqual([]);
  });
});

describe("world-model sensing indicator (Concept v2 privacy rule #3)", () => {
  const layers = (sensor: string, ls: unknown, id: string) => ({
    id, sessionId: "s", timestamp: "2026-08-31T00:00:00Z", source: "sensor" as const,
    type: "sensor.layers_changed", severity: "debug" as const, payload: { sensor, layers: ls },
  });
  it("records what each sensor says it observes, and forgets a sensor that reports nothing", () => {
    let s = reduce(emptyWorldState("s", "2026-08-31T00:00:00Z"), layers("extension", ["interactions", "tabs"], "l1"));
    s = reduce(s, layers("agent", ["files"], "l2"));
    expect(s.sensing).toEqual({ extension: ["interactions", "tabs"], agent: ["files"] });
    s = reduce(s, layers("extension", ["interactions", "tabs", "network"], "l3"));
    expect(s.sensing.extension).toEqual(["interactions", "tabs", "network"]);
    s = reduce(s, layers("agent", [], "l4"));
    expect(s.sensing).toEqual({ extension: ["interactions", "tabs", "network"] });
    // garbage is ignored, never trusted
    s = reduce(s, layers("x", [1, null, "ok"], "l5"));
    expect(s.sensing.x).toEqual(["ok"]);
  });
});

describe("world-model recent keys (switching input)", () => {
  it("keeps the last 8 action/entity keys in order", () => {
    let s = emptyWorldState("s", "2026-08-31T00:00:00Z");
    const ev = (type: string, payload: Record<string, unknown>, id: string) => ({
      id, sessionId: "s", timestamp: "2026-08-31T00:00:00Z", source: "user" as const, type, severity: "debug" as const, payload,
    });
    for (let i = 0; i < 10; i++) s = reduce(s, ev(i % 2 ? "user.action" : "user.opened_file", i % 2 ? { key: `k${i}` } : { path: `p${i}` }, `e${i}`));
    expect(s.behavior.recentKeys).toHaveLength(8);
    expect(s.behavior.recentKeys.at(-1)).toBe("k9");
    expect(s.behavior.recentKeys[0]).toBe("p2");
  });
});

describe("world-model novelty window", () => {
  it("reconcile ticks stay out of recentEvents; real events stay in", () => {
    let s = emptyWorldState("s", "2026-08-31T00:00:00Z");
    const ev = (type: string, source: "system" | "user", id: string) => ({
      id, sessionId: "s", timestamp: "2026-08-31T00:00:00Z", source, type, severity: "debug" as const, payload: {},
    });
    s = reduce(s, ev("user.interaction", "user", "e1"));
    s = reduce(s, ev("runtime.reconcile", "system", "r1"));
    s = reduce(s, ev("user.interaction", "user", "e2"));
    expect(s.recentEvents.map((e) => e.type)).toEqual(["user.interaction", "user.interaction"]);
    expect(s.updatedAt).toBe("2026-08-31T00:00:00Z");
  });
});
