import { describe, it, expect } from "vitest";
import { emptyWorldState, type MatterEvent, type WorldState } from "@particle/contracts";
import { evaluateSignificance, DEFAULT_SIGNIFICANCE_CONFIG, suggestMode, nextPresence, type SignificanceConfig } from "./index";

/**
 * Significance is the reflex in front of every deliberation: it runs on each event and decides
 * whether the expensive path is worth taking. It is also the number the inspector shows and the
 * audit keeps, so it has to be a real number under any configuration — a score that is not a
 * number spreads silently through the trace to every client.
 */
const T = "2026-09-04T00:00:00Z";
const world = (over: Partial<WorldState> = {}): WorldState => ({ ...emptyWorldState("s", T), ...over });
const ev = (over: Partial<MatterEvent> = {}): MatterEvent => ({
  id: "e",
  sessionId: "s",
  timestamp: T,
  source: "development",
  type: "development.server_error",
  severity: "critical",
  payload: {},
  ...over,
});

const problem = { id: "p", kind: "runtime_error", summary: "x", severity: "critical" as const, openedByEventId: "e", openedAt: T };
const seen = (n: number, type = "development.server_error") =>
  world({ recentEvents: Array.from({ length: n }, (_, i) => ev({ id: `r${i}`, type })) });

describe("the score is always a number", () => {
  it("stays a real number for every configuration a host might pass", () => {
    const configs: SignificanceConfig[] = [
      { ...DEFAULT_SIGNIFICANCE_CONFIG, noveltyWindow: 0 }, // 0/0 used to make this NaN
      { ...DEFAULT_SIGNIFICANCE_CONFIG, noveltyWindow: -1 },
      { ...DEFAULT_SIGNIFICANCE_CONFIG, noveltyWindow: 1 },
      { ...DEFAULT_SIGNIFICANCE_CONFIG, threshold: 0 },
      { ...DEFAULT_SIGNIFICANCE_CONFIG, threshold: 1 },
      { ...DEFAULT_SIGNIFICANCE_CONFIG, weights: { severity: 0, relevance: 0, novelty: 0, problem: 0 } },
      { ...DEFAULT_SIGNIFICANCE_CONFIG, weights: { severity: 1, relevance: 1, novelty: 1, problem: 1 } },
      { ...DEFAULT_SIGNIFICANCE_CONFIG, weights: { severity: -1, relevance: -1, novelty: -1, problem: -1 } },
    ];
    for (const config of configs) {
      for (const w of [world(), seen(3), world({ activeProblems: [problem] })]) {
        const r = evaluateSignificance(ev(), w, config);
        expect(Number.isFinite(r.score), JSON.stringify(config)).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1);
      }
    }
  });

  it("keeps the score inside nought and one whatever the weights say", () => {
    const heavy = { ...DEFAULT_SIGNIFICANCE_CONFIG, weights: { severity: 5, relevance: 5, novelty: 5, problem: 5 } };
    expect(evaluateSignificance(ev(), world({ activeContext: { activity: "development" } }), heavy).score).toBe(1);
    const none = { ...DEFAULT_SIGNIFICANCE_CONFIG, weights: { severity: 0, relevance: 0, novelty: 0, problem: 0 } };
    expect(evaluateSignificance(ev({ severity: "debug", type: "x", source: "user" }), world(), none).score).toBe(0);
  });

  it("always decides, and says why", () => {
    const r = evaluateSignificance(ev(), world());
    expect(typeof r.shouldDeliberate).toBe("boolean");
    expect(r.reasonCodes.length).toBeGreaterThan(0);
    expect(r.reasonCodes.every((c) => typeof c === "string" && c.length > 0)).toBe(true);
  });
});

describe("what makes an event worth thinking about", () => {
  it("takes a critical event seriously even in an empty world", () => {
    const r = evaluateSignificance(ev(), world());
    expect(r.shouldDeliberate).toBe(true);
    expect(r.reasonCodes).toContain("severity_critical");
  });

  it("counts an event that opens a problem, and one that closes it", () => {
    expect(evaluateSignificance(ev(), world()).reasonCodes).toContain("opens_problem");
    const closing = evaluateSignificance(ev({ type: "development.server_recovered", severity: "info" }), world({ activeProblems: [problem] }));
    expect(closing.reasonCodes).toContain("closes_problem");
    expect(closing.shouldDeliberate).toBe(true);
  });

  it("weighs a recovery for something that was never broken far lower", () => {
    // the transition is still named, but it only counts for much when a problem is actually open
    const recovery = ev({ type: "development.server_recovered", severity: "info" });
    const forReal = evaluateSignificance(recovery, world({ activeProblems: [problem] }));
    const forNothing = evaluateSignificance(recovery, world());
    expect(forReal.reasonCodes).toContain("closes_problem");
    expect(forNothing.reasonCodes).toContain("closes_problem");
    expect(forNothing.score).toBeLessThan(forReal.score);
    expect(forReal.shouldDeliberate).toBe(true);
  });

  it("finds development work relevant while someone is working", () => {
    const r = evaluateSignificance(ev(), world({ activeContext: { activity: "development" } }));
    expect(r.reasonCodes).toContain("relevant_to_activity");
    expect(r.score).toBeGreaterThan(evaluateSignificance(ev(), world()).score);
  });

  it("loses interest as the same event repeats", () => {
    const scores = [0, 1, 2, 3, 4].map((n) => evaluateSignificance(ev(), seen(n)).score);
    for (let i = 1; i < scores.length; i += 1) expect(scores[i]!, `${i}`).toBeLessThanOrEqual(scores[i - 1]!);
    expect(evaluateSignificance(ev(), seen(0)).reasonCodes).toContain("novel_event");
    expect(evaluateSignificance(ev(), seen(4)).reasonCodes).toContain("repetitive_event");
  });

  it("counts only repeats of the same kind of event", () => {
    const other = seen(4, "user.interaction");
    expect(evaluateSignificance(ev(), other).reasonCodes).toContain("novel_event");
  });

  it("leaves a quiet event alone", () => {
    const r = evaluateSignificance(ev({ severity: "debug", type: "user.interaction", source: "user" }), world());
    expect(r.shouldDeliberate).toBe(false);
    expect(r.score).toBeLessThan(DEFAULT_SIGNIFICANCE_CONFIG.threshold);
  });

  it("gives the same answer for the same inputs", () => {
    const w = world({ activeProblems: [problem], activeContext: { activity: "development" } });
    expect(JSON.stringify(evaluateSignificance(ev(), w))).toBe(JSON.stringify(evaluateSignificance(ev(), w)));
  });

  it("does not change the world it was given", () => {
    const w = world({ activeProblems: [problem] });
    const before = JSON.stringify(w);
    evaluateSignificance(ev(), w);
    expect(JSON.stringify(w)).toBe(before);
  });
});

describe("the shape the workspace should be in", () => {
  it("is an incident while something is open, and development when nothing is", () => {
    expect(suggestMode(world())).toBe("development");
    expect(suggestMode(world({ activeProblems: [problem] }))).toBe("incident");
  });
});

describe("what the presence indicator says", () => {
  const sig = (shouldDeliberate: boolean) => ({ score: shouldDeliberate ? 0.9 : 0.1, reasonCodes: [], shouldDeliberate });

  it("shows thinking whenever the runtime is about to deliberate", () => {
    for (const from of ["idle", "observing", "evaluating", "acting", "waiting_for_approval"] as const) {
      expect(nextPresence(from, sig(true)), from).toBe("evaluating");
    }
  });

  it("stays acting once it has acted, and settles to watching otherwise", () => {
    expect(nextPresence("acting", sig(false))).toBe("acting");
    expect(nextPresence("idle", sig(false))).toBe("observing");
    expect(nextPresence("observing", sig(false))).toBe("observing");
    expect(nextPresence("waiting_for_approval", sig(false))).toBe("observing");
  });
});
