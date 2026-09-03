import { describe, it, expect } from "vitest";
import { inferIntent, intentChanged, isSwitching, DEFAULT_INTENT_CONFIG, type IntentConfig } from "./index";
import { emptyWorldState, type IntentHypothesis, type WorldState } from "@particle/contracts";

/**
 * Intent is what the body reacts to, and only one label can win. The order matters: a person who
 * just came back should get a re-entry summary, not a "stuck" card, even if their last few actions
 * repeated. These tests fix the whole ladder and each threshold's exact boundary.
 */
const T = "2026-09-03T00:00:00Z";
const C = DEFAULT_INTENT_CONFIG;
const problem = { id: "p", kind: "runtime_error", summary: "x", severity: "critical" as const, openedByEventId: "e", openedAt: T };

const w = (behavior: Partial<WorldState["behavior"]>, extra: Partial<WorldState> = {}): WorldState => {
  const base = emptyWorldState("s", T);
  return { ...base, ...extra, behavior: { ...base.behavior, ...behavior } };
};
const label = (state: WorldState, config?: IntentConfig) => inferIntent(state, config).label;

describe("intent — the whole ladder, top down", () => {
  // every condition true at once: each step down the ladder must lose to the one above it
  const everything = {
    awaySeconds: 120,
    idleSeconds: 300,
    repeatCount: 9,
    lastActionKey: "rerun",
    recentKeys: ["a", "b", "a", "b", "a", "b"],
    recentEntities: ["a", "b", "c", "d", "e"],
  };

  it("returning wins over idle, stuck, debugging, switching and exploring", () => {
    expect(label(w(everything, { activeProblems: [problem] }))).toBe("returning");
  });

  it("idle wins once the return is gone", () => {
    expect(label(w({ ...everything, awaySeconds: 0 }, { activeProblems: [problem] }))).toBe("idle");
  });

  it("stuck wins over debugging — a repeated action beats an open problem", () => {
    expect(label(w({ ...everything, awaySeconds: 0, idleSeconds: 0 }, { activeProblems: [problem] }))).toBe("stuck");
  });

  it("debugging wins over switching and exploring while a problem is open", () => {
    expect(label(w({ ...everything, awaySeconds: 0, idleSeconds: 0, repeatCount: 1 }, { activeProblems: [problem] }))).toBe("debugging");
  });

  it("switching wins over exploring when nothing is broken", () => {
    expect(label(w({ ...everything, awaySeconds: 0, idleSeconds: 0, repeatCount: 1 }))).toBe("switching");
  });

  it("exploring wins when the keys do not alternate", () => {
    expect(label(w({ awaySeconds: 0, idleSeconds: 0, repeatCount: 1, recentKeys: ["a", "b", "c", "d", "e", "f"], recentEntities: ["a", "b", "c"] }))).toBe("exploring");
  });

  it("focused is the resting state", () => {
    expect(label(w({}))).toBe("focused");
    expect(inferIntent(w({})).reasonCodes).toContain("steady_interaction");
  });
});

describe("intent — thresholds are exact", () => {
  it("returning needs the configured seconds away, not one less", () => {
    expect(label(w({ awaySeconds: C.returningAfterSeconds }))).toBe("returning");
    expect(label(w({ awaySeconds: C.returningAfterSeconds - 1 }))).toBe("focused");
  });

  it("idle needs the configured seconds of quiet", () => {
    expect(label(w({ idleSeconds: C.idleAfterSeconds }))).toBe("idle");
    expect(label(w({ idleSeconds: C.idleAfterSeconds - 1 }))).toBe("focused");
  });

  it("stuck needs the third repeat", () => {
    expect(label(w({ repeatCount: C.stuckRepeatCount, lastActionKey: "k" }))).toBe("stuck");
    expect(label(w({ repeatCount: C.stuckRepeatCount - 1, lastActionKey: "k" }))).toBe("focused");
  });

  it("exploring needs the configured breadth", () => {
    expect(label(w({ recentEntities: ["a", "b", "c"] }))).toBe("exploring");
    expect(label(w({ recentEntities: ["a", "b"] }))).toBe("focused");
  });

  it("a caller can retune every threshold", () => {
    const strict: IntentConfig = { returningAfterSeconds: 600, idleAfterSeconds: 600, stuckRepeatCount: 99, exploringEntities: 99, switchingKeys: 99 };
    const busy = w({ awaySeconds: 60, idleSeconds: 120, repeatCount: 5, lastActionKey: "k", recentEntities: ["a", "b", "c", "d"], recentKeys: ["a", "b", "a", "b", "a", "b"] });
    expect(label(busy, strict)).toBe("focused"); // nothing crosses the raised bars
    expect(label(busy)).toBe("returning"); // the defaults still see a return
  });
});

describe("intent — switching is alternation, not breadth", () => {
  it("needs enough evidence, all changes, and at most three contexts", () => {
    expect(isSwitching(["a", "b", "a", "b", "a", "b"], 6)).toBe(true);
    expect(isSwitching(["a", "b", "c", "a", "b", "c"], 6)).toBe(true); // three contexts still counts
    expect(isSwitching(["a", "b", "a", "b", "a"], 6)).toBe(false); // not enough keys yet
    expect(isSwitching(["a", "b", "b", "a", "b", "a"], 6)).toBe(false); // a repeat breaks the alternation
    expect(isSwitching(["a", "b", "c", "d", "a", "b"], 6)).toBe(false); // four contexts is breadth
    expect(isSwitching([], 6)).toBe(false);
  });

  it("reads only the newest keys, so an old pattern stops counting", () => {
    const stale = ["a", "b", "a", "b", "a", "b", "x", "y", "z", "q", "r", "s"];
    expect(isSwitching(stale, 6)).toBe(false);
    expect(label(w({ recentKeys: stale, recentEntities: ["x", "y", "z"] }))).toBe("exploring");
  });

  it("names how many contexts are being juggled", () => {
    expect(inferIntent(w({ recentKeys: ["a", "b", "a", "b", "a", "b"] })).reasonCodes).toContain("alternating_2_contexts");
  });
});

describe("intent — reason codes and transitions", () => {
  it("explains each label with the number behind it", () => {
    expect(inferIntent(w({ awaySeconds: 42 })).reasonCodes).toContain("away_42s");
    expect(inferIntent(w({ idleSeconds: 75 })).reasonCodes).toContain("idle_75s");
    expect(inferIntent(w({ repeatCount: 4, lastActionKey: "rerun-tests" })).reasonCodes).toContain("repeated_rerun-tests_x4");
    expect(inferIntent(w({ repeatCount: 4, lastActionKey: "k" }, { activeProblems: [problem] })).reasonCodes).toContain("with_open_problem");
    expect(inferIntent(w({}, { activeProblems: [problem, problem] })).reasonCodes).toContain("open_problems_2");
  });

  it("always returns a confidence between 0 and 1", () => {
    const states = [w({ awaySeconds: 99 }), w({ idleSeconds: 99 }), w({ repeatCount: 9, lastActionKey: "k" }), w({}, { activeProblems: [problem] }), w({ recentKeys: ["a", "b", "a", "b", "a", "b"] }), w({ recentEntities: ["a", "b", "c"] }), w({})];
    for (const s of states) {
      const c = inferIntent(s).confidence;
      expect(c).toBeGreaterThan(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("reports a transition only when the label actually changes", () => {
    const a: IntentHypothesis = { label: "focused", confidence: 0.6, reasonCodes: [] };
    const b: IntentHypothesis = { label: "focused", confidence: 0.9, reasonCodes: ["different"] };
    expect(intentChanged(a, b)).toBe(false); // same label, different confidence: not a transition
    expect(intentChanged(a, { label: "stuck", confidence: 0.8, reasonCodes: [] })).toBe(true);
    expect(intentChanged(undefined, a)).toBe(true); // the first inference is a transition
  });

  it("is pure — same world in, same hypothesis out", () => {
    const state = w({ awaySeconds: 45 }, { activeProblems: [problem] });
    expect(inferIntent(state)).toEqual(inferIntent(state));
  });
});
