import { describe, it, expect } from "vitest";
import { emptyWorldState, INTENT_LABELS, IntentLabel, type WorldState } from "@particle/contracts";
import { inferIntent, isSwitching, intentChanged, DEFAULT_INTENT_CONFIG, type IntentConfig } from "./index";

/**
 * The intent hypothesis is what the body reshapes around when nothing is broken, so it is
 * running all the time and always says something. Two things matter at the edges: the ladder is
 * ordered — the more urgent reading wins — and a threshold a host can set must not be able to
 * turn a quiet session into a busy one.
 */
const T = "2026-09-04T00:00:00Z";
const problem = { id: "p", kind: "runtime_error", summary: "x", severity: "critical" as const, openedByEventId: "e", openedAt: T };

const world = (behavior: Partial<WorldState["behavior"]> = {}, activeProblems: WorldState["activeProblems"] = []): WorldState => {
  const base = emptyWorldState("s", T);
  return { ...base, activeProblems, behavior: { ...base.behavior, ...behavior } };
};

describe("alternating between a few places", () => {
  const abab = ["a", "b", "a", "b", "a", "b"];

  it("sees ping-pong between two or three contexts", () => {
    expect(isSwitching(abab, 6)).toBe(true);
    expect(isSwitching(["a", "b", "c", "a", "b", "c"], 6)).toBe(true);
    expect(isSwitching(abab, 3)).toBe(true);
  });

  it("does not call breadth juggling — that is exploring", () => {
    expect(isSwitching(["a", "b", "c", "d", "e", "f"], 6)).toBe(false);
  });

  it("does not call a repeat juggling — that is being stuck", () => {
    expect(isSwitching(["a", "a", "b", "a", "b", "a"], 6)).toBe(false);
    expect(isSwitching(["a", "a", "a", "a", "a", "a"], 6)).toBe(false);
  });

  it("wants a full window before deciding", () => {
    expect(isSwitching(["a", "b"], 6)).toBe(false);
    expect(isSwitching([], 6)).toBe(false);
  });

  it("refuses a window too small to show alternation", () => {
    // a window of one shows nothing, and a window of zero used to take the whole history
    // instead of none, which made an empty history read as juggling
    for (const n of [1, 0, -1]) {
      expect(isSwitching(abab, n), `abab/${n}`).toBe(false);
      expect(isSwitching([], n), `empty/${n}`).toBe(false);
      expect(isSwitching(["a"], n), `one/${n}`).toBe(false);
    }
  });

  it("reads only the end of the history", () => {
    expect(isSwitching(["x", "x", "x", "a", "b", "a", "b", "a", "b"], 6)).toBe(true);
  });
});

describe("the ladder, most urgent first", () => {
  it("puts coming back above everything", () => {
    const h = inferIntent(world({ awaySeconds: 60, idleSeconds: 120, repeatCount: 5, recentEntities: ["a", "b", "c"] }, [problem]));
    expect(h.label).toBe("returning");
    expect(h.reasonCodes[0]).toBe("away_60s");
  });

  it("puts going quiet above being stuck", () => {
    expect(inferIntent(world({ idleSeconds: 120, repeatCount: 5 })).label).toBe("idle");
  });

  it("puts being stuck above debugging, and says an open problem is part of it", () => {
    const h = inferIntent(world({ repeatCount: 3, lastActionKey: "retry" }, [problem]));
    expect(h.label).toBe("stuck");
    expect(h.reasonCodes).toContain("repeated_retry_x3");
    expect(h.reasonCodes).toContain("with_open_problem");
  });

  it("reads an open problem alone as debugging", () => {
    const h = inferIntent(world({}, [problem]));
    expect(h.label).toBe("debugging");
    expect(h.reasonCodes).toContain("open_problems_1");
  });

  it("puts juggling above breadth", () => {
    const h = inferIntent(world({ recentKeys: ["a", "b", "a", "b", "a", "b"], recentEntities: ["a", "b", "c", "d"] }));
    expect(h.label).toBe("switching");
    expect(h.reasonCodes).toContain("alternating_2_contexts");
  });

  it("reads several places without a pattern as exploring", () => {
    const h = inferIntent(world({ recentEntities: ["a", "b", "c"] }));
    expect(h.label).toBe("exploring");
    expect(h.reasonCodes).toContain("entities_3");
  });

  it("says focused when there is nothing else to say", () => {
    const h = inferIntent(world());
    expect(h.label).toBe("focused");
    expect(h.reasonCodes).toEqual(["steady_interaction"]);
  });

  it("is more sure of the readings it is more sure of", () => {
    const confidence = (h: { confidence: number }) => h.confidence;
    expect(confidence(inferIntent(world({ awaySeconds: 60 })))).toBeGreaterThan(confidence(inferIntent(world({}, [problem]))));
    expect(confidence(inferIntent(world({}, [problem])))).toBeGreaterThan(confidence(inferIntent(world())));
    for (const w of [world(), world({ awaySeconds: 60 }), world({}, [problem])]) {
      const h = inferIntent(w);
      expect(h.confidence).toBeGreaterThan(0);
      expect(h.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("thresholds a host can retune", () => {
  it("takes each threshold at its exact boundary", () => {
    expect(inferIntent(world({ awaySeconds: 29 })).label).not.toBe("returning");
    expect(inferIntent(world({ awaySeconds: 30 })).label).toBe("returning");
    expect(inferIntent(world({ idleSeconds: 59 })).label).not.toBe("idle");
    expect(inferIntent(world({ idleSeconds: 60 })).label).toBe("idle");
    expect(inferIntent(world({ repeatCount: 2 })).label).not.toBe("stuck");
    expect(inferIntent(world({ repeatCount: 3 })).label).toBe("stuck");
    expect(inferIntent(world({ recentEntities: ["a", "b"] })).label).not.toBe("exploring");
    expect(inferIntent(world({ recentEntities: ["a", "b", "c"] })).label).toBe("exploring");
  });

  it("follows a config that asks for more patience", () => {
    const patient: IntentConfig = { ...DEFAULT_INTENT_CONFIG, stuckRepeatCount: 10, exploringEntities: 10 };
    expect(inferIntent(world({ repeatCount: 5 }), patient).label).toBe("focused");
    expect(inferIntent(world({ recentEntities: ["a", "b", "c", "d"] }), patient).label).toBe("focused");
  });

  it("cannot be configured into calling a quiet session busy", () => {
    // every threshold at zero still has to produce one honest reading, not juggling from nothing
    const zeroed: IntentConfig = { returningAfterSeconds: 0, idleAfterSeconds: 0, stuckRepeatCount: 0, exploringEntities: 0, switchingKeys: 0 };
    const h = inferIntent(world(), zeroed);
    expect(h.label).toBe("returning"); // the first rung, since away is zero and the bar is zero
    expect(isSwitching([], zeroed.switchingKeys)).toBe(false);
  });

  it("rounds the seconds it reports rather than showing a fraction", () => {
    expect(inferIntent(world({ awaySeconds: 42.6 })).reasonCodes[0]).toBe("away_43s");
    expect(inferIntent(world({ idleSeconds: 90.4 })).reasonCodes[0]).toBe("idle_90s");
  });

  it("names the action even when the world never recorded one", () => {
    expect(inferIntent(world({ repeatCount: 3, lastActionKey: undefined })).reasonCodes[0]).toBe("repeated_action_x3");
  });
});

describe("noticing that the intent changed", () => {
  const h = (label: string, confidence = 0.8) => ({ label, confidence, reasonCodes: [] }) as never;

  it("treats the first reading as a change", () => {
    expect(intentChanged(undefined, h("focused"))).toBe(true);
  });

  it("ignores a different confidence or reason for the same reading", () => {
    expect(intentChanged(h("focused", 0.6), h("focused", 0.95))).toBe(false);
  });

  it("notices a different reading", () => {
    expect(intentChanged(h("focused"), h("stuck"))).toBe(true);
    expect(intentChanged(h("stuck"), h("debugging"))).toBe(true);
  });
});

/**
 * The label this engine hands back is shown to a person in three places, looked up by its own
 * name. The contracts hold the list of them and a schema for one, and neither was used by
 * anything — the hypothesis carries a plain string, so nothing checked that what comes out of
 * here is a label the body has words for. This is the producer's half of that.
 *
 * The wire stays open on purpose: a newer runtime may infer something this build has never heard
 * of, and the body shows an unknown label readably rather than erasing it. What is closed is what
 * THIS engine may say.
 */
describe("the label this engine hands back", () => {
  const situations: [string, WorldState][] = [
    ["nothing happening", world()],
    ["away a while", world({ awaySeconds: 600 })],
    ["idle a while", world({ idleSeconds: 300 })],
    ["repeating one action", world({ lastActionKey: "file:a", repeatCount: 5 })],
    ["a problem open", world({}, [problem])],
    ["alternating contexts", world({ recentKeys: ["a", "b", "a", "b", "a", "b"] })],
    ["many entities", world({ recentEntities: ["a", "b", "c", "d", "e"] })],
    ["steady interaction", world({ interactions: 12, lastInteractionAt: T })],
  ];

  it("is always one the contracts declare", () => {
    for (const [what, w] of situations) {
      const { label } = inferIntent(w);
      expect(INTENT_LABELS as readonly string[], what).toContain(label);
      expect(IntentLabel.safeParse(label).success, `${what}: ${label}`).toBe(true);
    }
  });

  it("is one the contracts declare however a host retunes the thresholds", () => {
    const configs: IntentConfig[] = [
      DEFAULT_INTENT_CONFIG,
      { returningAfterSeconds: 1, idleAfterSeconds: 1, stuckRepeatCount: 1, exploringEntities: 1, switchingKeys: 1 },
      {
        returningAfterSeconds: 1_000_000,
        idleAfterSeconds: 1_000_000,
        stuckRepeatCount: 1_000_000,
        exploringEntities: 1_000_000,
        switchingKeys: 1_000_000,
      },
    ];
    for (const config of configs) {
      for (const [what, w] of situations) {
        expect(INTENT_LABELS as readonly string[], what).toContain(inferIntent(w, config).label);
      }
    }
  });

  it("says something for every situation, with a confidence between none and certain", () => {
    for (const [what, w] of situations) {
      const { label, confidence } = inferIntent(w);
      expect(label.length, what).toBeGreaterThan(0);
      expect(confidence, what).toBeGreaterThan(0);
      expect(confidence, what).toBeLessThanOrEqual(1);
    }
  });
});
