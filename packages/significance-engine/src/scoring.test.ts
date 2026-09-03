import { describe, it, expect } from "vitest";
import { evaluateSignificance, DEFAULT_SIGNIFICANCE_CONFIG, type SignificanceConfig } from "./significance";
import { emptyWorldState, SEVERITY_RANK, type MatterEvent, type WorldState } from "@particle/contracts";

/**
 * Significance is the cheap reflex in front of every expensive deliberation: it decides what is
 * worth thinking about. The arithmetic and the deliberate/reflex boundary are pinned here so a
 * weight change cannot quietly make the runtime chatty (or deaf).
 */
const T = "2026-09-03T00:00:00Z";
const W = DEFAULT_SIGNIFICANCE_CONFIG.weights;

const ev = (over: Partial<MatterEvent> & Pick<MatterEvent, "type">): MatterEvent => ({
  id: "e1", sessionId: "s", timestamp: T, source: "system", severity: "info", payload: {}, ...over,
});
const world = (over: Partial<WorldState> = {}): WorldState => ({ ...emptyWorldState("s", T), ...over });
const dev = () => world({ activeContext: { activity: "development" } });
const repeats = (type: string, n: number): MatterEvent[] => Array.from({ length: n }, (_, i) => ev({ id: `r${i}`, type }));

describe("significance — the score is the documented weighted sum", () => {
  it("computes severity × relevance × novelty × problem exactly", () => {
    // a first-time warning from a development source while developing: no problem transition
    const r = evaluateSignificance(ev({ type: "system.resource_warning", severity: "warning", source: "development" }), dev());
    const expected = W.severity * (SEVERITY_RANK.warning / 4) + W.relevance * 1 + W.novelty * 1 + W.problem * 0;
    expect(r.score).toBeCloseTo(expected, 10);
    expect(r.reasonCodes).toContain("relevant_to_activity");
    expect(r.reasonCodes).toContain("novel_event");
  });

  it("scores a debug event from an unrelated source near zero", () => {
    const r = evaluateSignificance(ev({ type: "x.y", severity: "debug", source: "system" }), world());
    expect(r.score).toBeCloseTo(W.novelty * 1, 10); // novelty only
    expect(r.shouldDeliberate).toBe(false);
    expect(r.reasonCodes).toContain("reflex_only");
  });

  it("gives a user-sourced event half relevance", () => {
    const r = evaluateSignificance(ev({ type: "user.action", source: "user", severity: "info" }), world());
    expect(r.score).toBeCloseTo(W.severity * 0.25 + W.relevance * 0.5 + W.novelty, 10);
  });

  it("never leaves the 0..1 range, even with absurd weights", () => {
    const huge: SignificanceConfig = { weights: { severity: 5, relevance: 5, novelty: 5, problem: 5 }, threshold: 0.6, noveltyWindow: 4 };
    const r = evaluateSignificance(ev({ type: "development.server_error", severity: "critical", source: "development" }), dev(), huge);
    expect(r.score).toBe(1);
    const zero: SignificanceConfig = { weights: { severity: 0, relevance: 0, novelty: 0, problem: 0 }, threshold: 0.6, noveltyWindow: 4 };
    expect(evaluateSignificance(ev({ type: "x", severity: "debug" }), world(), zero).score).toBe(0);
  });
});

describe("significance — novelty decays step by step", () => {
  it("falls 1 → 0.75 → 0.5 → 0.25 → 0 as the same event repeats", () => {
    const scores = [0, 1, 2, 3, 4, 6].map((n) => {
      const r = evaluateSignificance(ev({ type: "system.resource_warning", severity: "debug" }), world({ recentEvents: repeats("system.resource_warning", n) }));
      return Number((r.score / W.novelty).toFixed(4));
    });
    expect(scores).toEqual([1, 0.75, 0.5, 0.25, 0, 0]); // clamped at zero, never negative
  });

  it("marks the fourth repetition as repetitive and the first as novel", () => {
    const first = evaluateSignificance(ev({ type: "a.b" }), world());
    expect(first.reasonCodes).toContain("novel_event");
    const later = evaluateSignificance(ev({ type: "a.b" }), world({ recentEvents: repeats("a.b", 4) }));
    expect(later.reasonCodes).toContain("repetitive_event");
    expect(later.reasonCodes).not.toContain("novel_event");
  });

  it("counts only the same event type — a different type stays novel", () => {
    const r = evaluateSignificance(ev({ type: "a.b" }), world({ recentEvents: repeats("c.d", 10) }));
    expect(r.reasonCodes).toContain("novel_event");
  });
});

describe("significance — the deliberate boundary", () => {
  it("deliberates exactly at the threshold, not below it", () => {
    const cfg = (threshold: number): SignificanceConfig => ({ ...DEFAULT_SIGNIFICANCE_CONFIG, threshold });
    const e = ev({ type: "system.resource_warning", severity: "warning", source: "development" });
    const score = evaluateSignificance(e, dev()).score;
    expect(evaluateSignificance(e, dev(), cfg(score)).shouldDeliberate).toBe(true);
    expect(evaluateSignificance(e, dev(), cfg(score + 0.0001)).shouldDeliberate).toBe(false);
  });

  it("always deliberates on a critical event, however repetitive and irrelevant", () => {
    const r = evaluateSignificance(
      ev({ type: "external.alert", severity: "critical", source: "external" }),
      world({ recentEvents: repeats("external.alert", 20) }),
    );
    expect(r.shouldDeliberate).toBe(true);
    expect(r.reasonCodes).toContain("severity_critical");
  });

  it("always deliberates when a problem opens, and on a closer only while one is open", () => {
    const opener = evaluateSignificance(ev({ type: "development.build_failed", severity: "warning" }), world({ recentEvents: repeats("development.build_failed", 20) }));
    expect(opener.shouldDeliberate).toBe(true);
    expect(opener.reasonCodes).toContain("opens_problem");

    const closerNoProblem = evaluateSignificance(ev({ type: "development.build_succeeded" }), world({ recentEvents: repeats("development.build_succeeded", 20) }));
    expect(closerNoProblem.shouldDeliberate).toBe(false); // nothing to close, nothing to think about
    expect(closerNoProblem.reasonCodes).toContain("closes_problem");

    const withProblem = world({
      activeProblems: [{ id: "p", kind: "build_failure", summary: "x", severity: "warning", openedByEventId: "e", openedAt: T }],
      recentEvents: repeats("development.build_succeeded", 20),
    });
    expect(evaluateSignificance(ev({ type: "development.build_succeeded" }), withProblem).shouldDeliberate).toBe(true);
  });
});

describe("significance — behaviour and traffic signals stand on their own", () => {
  const behaviour = (over: Partial<WorldState["behavior"]>): WorldState => ({ ...world(), behavior: { ...emptyWorldState("s", T).behavior, ...over } });

  it("a long-enough return, a third repeat and a long idle each force deliberation on their own", () => {
    const returning = evaluateSignificance(ev({ type: "user.visibility", source: "user", payload: { visible: true, awaySeconds: 30 } }), world());
    expect(returning.shouldDeliberate).toBe(true);
    expect(returning.reasonCodes).toContain("behavior_signal");

    const stuck = evaluateSignificance(
      ev({ type: "user.action", source: "user", payload: { key: "rerun" } }),
      behaviour({ lastActionKey: "rerun", repeatCount: 2 }),
    );
    expect(stuck.shouldDeliberate).toBe(true);

    const idle = evaluateSignificance(ev({ type: "user.idle", source: "user", severity: "debug", payload: { seconds: 60 } }), world());
    expect(idle.shouldDeliberate).toBe(true);
  });

  it("ignores the same signals just below their thresholds", () => {
    expect(evaluateSignificance(ev({ type: "user.visibility", source: "user", payload: { visible: true, awaySeconds: 29 } }), world()).shouldDeliberate).toBe(false);
    expect(
      evaluateSignificance(ev({ type: "user.action", source: "user", severity: "debug", payload: { key: "rerun" } }), behaviour({ lastActionKey: "rerun", repeatCount: 1 })).shouldDeliberate,
    ).toBe(false);
    expect(evaluateSignificance(ev({ type: "user.idle", source: "user", severity: "debug", payload: { seconds: 59 } }), world()).shouldDeliberate).toBe(false);
  });

  it("treats a host that starts failing as significant, and a repeat failure as not", () => {
    const first = evaluateSignificance(ev({ type: "network.request", source: "sensor", severity: "warning", payload: { host: "api", status: 503 } }), world());
    expect(first.shouldDeliberate).toBe(true);
    expect(first.reasonCodes).toContain("network_shape");

    const already = world({
      activeProblems: [{ id: "p", kind: "network_failure", summary: "api", severity: "warning", openedByEventId: "e", openedAt: T }],
      behavior: { ...emptyWorldState("s", T).behavior, network: { requests: 3, failures: 2, slow: 0, failingHosts: ["api"] } },
    });
    const repeat = evaluateSignificance(ev({ type: "network.request", source: "sensor", severity: "warning", payload: { host: "api", status: 503 } }), already);
    expect(repeat.shouldDeliberate).toBe(false); // anti-thrash: the problem is already open
    // the recovery of the last failing host is significant again
    const recovery = evaluateSignificance(ev({ type: "network.request", source: "sensor", payload: { host: "api", status: 200 } }), already);
    expect(recovery.shouldDeliberate).toBe(true);
  });

  it("is pure — the same inputs always give the same result", () => {
    const e = ev({ type: "development.server_error", severity: "critical", source: "development" });
    const w = dev();
    expect(evaluateSignificance(e, w)).toEqual(evaluateSignificance(e, w));
  });
});
