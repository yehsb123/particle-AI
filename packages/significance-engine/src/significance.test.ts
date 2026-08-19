import { describe, it, expect } from "vitest";
import { evaluateSignificance, DEFAULT_SIGNIFICANCE_CONFIG } from "./significance";
import { suggestMode } from "./reflex";
import { emptyWorldState, type MatterEvent, type WorldState } from "@dm/contracts";

const T = "2026-08-19T00:00:00Z";
function ev(type: string, severity: MatterEvent["severity"] = "info", source: MatterEvent["source"] = "development"): MatterEvent {
  return { id: `e-${type}-${severity}`, sessionId: "s", timestamp: T, source, type, severity, payload: {} };
}

describe("evaluateSignificance", () => {
  const dev: WorldState = { ...emptyWorldState("s", T), activeContext: { activity: "development", domain: "software" } };

  it("deliberates on a critical runtime error", () => {
    const r = evaluateSignificance(ev("development.server_error", "critical"), dev);
    expect(r.shouldDeliberate).toBe(true);
    expect(r.score).toBeGreaterThan(0.6);
    expect(r.reasonCodes).toContain("opens_problem");
  });

  it("stays reflex-only for a low-severity, irrelevant, repeated event", () => {
    const world: WorldState = {
      ...dev,
      recentEvents: Array.from({ length: 5 }, () => ev("development.build_started", "debug")),
    };
    const r = evaluateSignificance(ev("development.build_started", "debug"), world);
    expect(r.shouldDeliberate).toBe(false);
    expect(r.reasonCodes).toContain("repetitive_event");
  });

  it("treats recovery as significant only when a problem is open", () => {
    const withProblem: WorldState = {
      ...dev,
      activeProblems: [{ id: "p", kind: "runtime_error", summary: "x", severity: "critical", openedByEventId: "e", openedAt: T }],
    };
    expect(evaluateSignificance(ev("development.server_recovered"), withProblem).shouldDeliberate).toBe(true);
    expect(evaluateSignificance(ev("development.server_recovered"), dev).shouldDeliberate).toBe(false);
  });

  it("respects a raised threshold via config", () => {
    const strict = { ...DEFAULT_SIGNIFICANCE_CONFIG, threshold: 0.99 };
    const r = evaluateSignificance(ev("user.opened_file", "info", "user"), dev, strict);
    expect(r.shouldDeliberate).toBe(false);
  });
});

describe("suggestMode", () => {
  it("switches to incident when a problem is open", () => {
    const base = emptyWorldState("s", T);
    expect(suggestMode(base)).toBe("development");
    const withProblem = { ...base, activeProblems: [{ id: "p", kind: "runtime_error", summary: "x", severity: "critical" as const, openedByEventId: "e", openedAt: T }] };
    expect(suggestMode(withProblem)).toBe("incident");
  });
});
