import { describe, it, expect } from "vitest";
import { RuntimeDecision, emptyWorldState, type MatterEvent, type WorldState } from "@particle/contracts";
import { MockProvider, deterministicDecision } from "./index";

/**
 * This is the brain the runtime uses when there is no key configured, and the one it falls back
 * to whenever a real provider disappoints. So it has to answer every time, with a decision the
 * schema accepts, asking for no more autonomy than it needs — and always the same answer for the
 * same situation, since replay compares one run against another.
 */
const T = "2026-09-04T00:00:00Z";
const event = (type: string, severity: MatterEvent["severity"] = "critical"): MatterEvent => ({
  id: "e1",
  sessionId: "s",
  timestamp: T,
  source: "development",
  type,
  severity,
  payload: {},
});

const problem = (over: Partial<WorldState["activeProblems"][number]> = {}) => ({
  id: "p",
  kind: "runtime_error",
  summary: "Service returned a runtime error",
  severity: "critical" as const,
  openedByEventId: "e1",
  openedAt: T,
  ...over,
});

const world = (over: Partial<WorldState> = {}): WorldState => ({ ...emptyWorldState("s", T), ...over });
const significance = { score: 0.9, reasonCodes: [], shouldDeliberate: true };
const decide = (over: { event?: MatterEvent; worldState?: WorldState } = {}) =>
  deterministicDecision({ event: over.event ?? event("development.server_error"), worldState: over.worldState ?? world(), significance });

describe("it always answers, and the answer is a decision", () => {
  it("produces something the schema accepts, for every situation the runtime meets", () => {
    const situations: WorldState[] = [
      world(),
      world({ activeProblems: [problem()] }),
      world({ activeProblems: [problem({ severity: "warning", kind: "build_failure" })] }),
      world({ activeProblems: [problem(), problem({ id: "p2", kind: "network_failure", severity: "warning" })] }),
      world({ behavior: { ...emptyWorldState("s", T).behavior, awaySeconds: 300 } }),
    ];
    for (const worldState of situations) {
      for (const type of ["development.server_error", "development.server_recovered", "user.interaction", "security.vulnerability_detected"]) {
        const d = decide({ event: event(type), worldState });
        expect(RuntimeDecision.safeParse(d).success, `${type}`).toBe(true);
      }
    }
  });

  it("gives the same answer twice for the same situation", () => {
    const worldState = world({ activeProblems: [problem()] });
    expect(JSON.stringify(decide({ worldState }))).toBe(JSON.stringify(decide({ worldState })));
  });

  it("ties its answer to the event it answered", () => {
    expect(decide().id).toContain("e1");
  });

  it("says why, in words a person could read, and keeps its thinking to itself", () => {
    const d = decide({ worldState: world({ activeProblems: [problem()] }) });
    expect(d.reasonSummary.length).toBeGreaterThan(0);
    expect(d.uiPlan?.reasonSummary.length).toBeGreaterThan(0);
    expect(Object.keys(d).some((k) => /thought|reasoning|chain/i.test(k))).toBe(false);
  });
});

describe("what it decides to do", () => {
  it("surfaces the incident while something is open", () => {
    const d = decide({ worldState: world({ activeProblems: [problem()] }) });
    expect(d.uiPlan?.intent).toBe("surface_incident");
    expect(d.uiPlan?.targetMode).toBe("incident");
  });

  it("comes back to normal once nothing is open", () => {
    const d = decide({ event: event("development.server_recovered", "info"), worldState: world() });
    expect(d.uiPlan?.intent).toBe("restore_normal");
  });

  it("does nothing for an ordinary moment", () => {
    const d = decide({ event: event("development.build_started", "info"), worldState: world() });
    expect(d.uiPlan?.intent).toBe("none");
    expect(d.capabilityPlan.capabilities).toEqual([]);
  });

  it("names the kind of trouble so the body can lay itself out for it", () => {
    for (const kind of ["runtime_error", "build_failure", "test_failure", "security_alert", "network_failure"]) {
      const d = decide({ worldState: world({ activeProblems: [problem({ kind })] }) });
      expect(d.uiPlan?.variant, kind).toBe(kind);
    }
  });

  it("plans only reading while it is working out what happened", () => {
    const d = decide({ worldState: world({ activeProblems: [problem()] }) });
    expect(d.capabilityPlan.capabilities.length).toBeGreaterThan(0);
    expect(d.autonomyRequirement.risk).toBe("read");
    expect(d.autonomyRequirement.requiresApproval).toBe(false);
    expect(d.autonomyRequirement.minLevel).toBeLessThanOrEqual(2);
  });

  it("is more confident about a critical problem than about quiet", () => {
    const loud = decide({ worldState: world({ activeProblems: [problem()] }) });
    const quiet = decide({ event: event("development.build_started", "info"), worldState: world() });
    expect(loud.uiPlan!.confidence).toBeGreaterThan(quiet.uiPlan!.confidence);
    expect(loud.uiPlan!.confidence).toBeLessThanOrEqual(1);
  });

  it("carries the significance it was given rather than inventing one", () => {
    const d = deterministicDecision({ event: event("development.server_error"), worldState: world({ activeProblems: [problem()] }), significance: { score: 0.42, reasonCodes: [], shouldDeliberate: true } });
    expect(d.significance).toBe(0.42);
  });
});

describe("the provider around it", () => {
  const provider = new MockProvider();
  const request = (context?: Record<string, unknown>) => ({ purpose: "decide.runtime", capability: "reason.deep" as const, context });

  it("needs nothing configured and is always well", async () => {
    expect(await provider.health()).toEqual({ id: "mock", healthy: true });
  });

  it("answers a decision request with a decision", async () => {
    const out = await provider.evaluate(request({ event: event("development.server_error"), worldState: world({ activeProblems: [problem()] }), significance }));
    expect(out.providerId).toBe("mock");
    expect(RuntimeDecision.safeParse(out.data).success).toBe(true);
    expect(out.tier).toBe("free");
  });

  it("answers a request that is not one without pretending to decide", async () => {
    // the caller validates what comes back, so answering with nothing is safer than guessing
    for (const context of [undefined, {}, { event: event("development.server_error") }, { worldState: world() }, { event: "not an event", significance: null }]) {
      const out = await provider.evaluate(request(context as Record<string, unknown>));
      expect(out.data, JSON.stringify(context) ?? "undefined").toBeUndefined();
      expect(out.providerId).toBe("mock");
    }
  });

  it("costs nothing and takes no time, so a demo never waits on it", async () => {
    const out = await provider.evaluate(request({ event: event("development.server_error"), worldState: world(), significance }));
    expect(out.tier).toBe("free");
    expect(out.latencyMs).toBe(0);
  });
});
