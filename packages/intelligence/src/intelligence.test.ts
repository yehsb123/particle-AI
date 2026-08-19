import { describe, it, expect } from "vitest";
import { MockProvider } from "./mock";
import { deterministicDecision, type DecisionContext } from "./deterministic";
import { IntelligenceRouter, buildDefaultProviders } from "./router";
import type { IntelligenceProvider } from "./provider";
import { emptyWorldState, RuntimeDecision, type MatterEvent, type ModelCapability, type WorldState } from "@dm/contracts";

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

class FakeProvider implements IntelligenceProvider {
  constructor(
    public readonly id: string,
    public readonly capabilities: ModelCapability[],
    private readonly healthy = true,
    private readonly data?: unknown,
  ) {}
  async evaluate() {
    return { providerId: this.id, data: this.data };
  }
  async health() {
    return { id: this.id, healthy: this.healthy };
  }
}

describe("deterministicDecision", () => {
  it("surfaces an incident when a problem is active", () => {
    const ctx: DecisionContext = { event: ev("development.server_error"), worldState: worldWithProblem(), significance: sig };
    const d = deterministicDecision(ctx);
    expect(RuntimeDecision.safeParse(d).success).toBe(true);
    expect(d.uiPlan?.intent).toBe("surface_incident");
    expect(d.recommendedMode).toBe("incident");
  });

  it("restores normal on a closer with no remaining problems", () => {
    const ctx: DecisionContext = { event: ev("development.server_recovered", "info"), worldState: emptyWorldState("s", T), significance: sig };
    expect(deterministicDecision(ctx).uiPlan?.intent).toBe("restore_normal");
  });

  it("plans no morph for an unremarkable event", () => {
    const ctx: DecisionContext = { event: ev("development.build_started", "info"), worldState: emptyWorldState("s", T), significance: { ...sig, score: 0.1 } };
    expect(deterministicDecision(ctx).uiPlan?.intent).toBe("none");
  });
});

describe("MockProvider", () => {
  it("returns a valid RuntimeDecision as structured data", async () => {
    const r = await new MockProvider().evaluate({
      purpose: "decide", capability: "reason.deep", structured: true,
      context: { event: ev("development.server_error"), worldState: worldWithProblem(), significance: sig },
    });
    expect(RuntimeDecision.safeParse(r.data).success).toBe(true);
    expect(r.tier).toBe("free");
  });
});

describe("IntelligenceRouter", () => {
  const deep: ModelCapability = "reason.deep";
  const fast: ModelCapability = "fast.classification";

  it("routes deliberation to the most capable healthy provider", async () => {
    const router = new IntelligenceRouter([new FakeProvider("anthropic", [deep]), new MockProvider()]);
    const { route } = await router.route({ purpose: "x", capability: deep });
    expect(route.providerId).toBe("anthropic");
    expect(route.estimatedTier).toBe("premium");
  });

  it("routes reflex work to the cheapest provider", async () => {
    const router = new IntelligenceRouter([new FakeProvider("anthropic", [fast]), new MockProvider()]);
    const { route } = await router.route({ purpose: "x", capability: fast });
    expect(route.providerId).toBe("mock");
  });

  it("prefers a local provider when privacy is requested", async () => {
    const router = new IntelligenceRouter([
      new FakeProvider("anthropic", [deep]),
      new FakeProvider("local", [deep]),
      new MockProvider(),
    ]);
    const { route } = await router.route({ purpose: "x", capability: deep, privacy: true });
    expect(route.providerId).toBe("local");
  });

  it("falls back to mock when the only real provider is unhealthy", async () => {
    const router = new IntelligenceRouter([new FakeProvider("anthropic", [deep], false)]);
    const { route } = await router.route({ purpose: "x", capability: deep });
    expect(route.providerId).toBe("mock");
    expect(route.reasonCodes).toContain("chose:mock");
  });

  it("buildDefaultProviders yields only mock with an empty env", () => {
    const providers = buildDefaultProviders({} as NodeJS.ProcessEnv);
    expect(providers.map((p) => p.id)).toEqual(["mock"]);
  });
});
