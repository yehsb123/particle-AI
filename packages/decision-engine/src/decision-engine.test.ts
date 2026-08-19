import { describe, it, expect } from "vitest";
import { DecisionEngine } from "./index";
import { IntelligenceRouter, MockProvider } from "@dm/intelligence";
import type { IntelligenceProvider } from "@dm/intelligence";
import { emptyWorldState, type MatterEvent, type ModelCapability, type WorldState } from "@dm/contracts";

const T = "2026-08-19T00:00:00Z";
const sig = { score: 0.9, reasonCodes: [], shouldDeliberate: true };
function ev(type: string, severity: MatterEvent["severity"] = "critical"): MatterEvent {
  return { id: `e-${type}`, sessionId: "s", timestamp: T, source: "development", type, severity, payload: {} };
}
function worldWithProblem(): WorldState {
  return {
    ...emptyWorldState("s", T),
    activeContext: { activity: "development" },
    activeProblems: [{ id: "p", kind: "runtime_error", summary: "x", severity: "critical", openedByEventId: "e", openedAt: T }],
  };
}

class JunkProvider implements IntelligenceProvider {
  readonly id = "anthropic";
  readonly capabilities: ModelCapability[] = ["reason.deep"];
  async evaluate() {
    return { providerId: this.id, data: { not: "a valid decision" } };
  }
  async health() {
    return { id: this.id, healthy: true };
  }
}

describe("DecisionEngine", () => {
  it("produces a validated decision via the mock provider", async () => {
    const engine = new DecisionEngine(new IntelligenceRouter([new MockProvider()]));
    const out = await engine.evaluate({ event: ev("development.server_error"), worldState: worldWithProblem(), significance: sig });
    expect(out.decision.uiPlan?.intent).toBe("surface_incident");
    expect(out.usedFallback).toBe(false);
    expect(out.providerId).toBe("mock");
  });

  it("discards invalid provider output and falls back to the deterministic decision", async () => {
    const engine = new DecisionEngine(new IntelligenceRouter([new JunkProvider()]));
    const out = await engine.evaluate({ event: ev("development.server_error"), worldState: worldWithProblem(), significance: sig });
    expect(out.usedFallback).toBe(true);
    expect(out.decision.uiPlan?.intent).toBe("surface_incident"); // deterministic still correct
    expect(out.route.reasonCodes.some((r) => r.startsWith("fell_back_to_deterministic"))).toBe(true);
  });
});
