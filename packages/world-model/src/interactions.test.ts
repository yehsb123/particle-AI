import { describe, it, expect } from "vitest";
import { emptyWorldState, type MatterEvent, type WorldState } from "@particle/contracts";
import { reduce } from "./index";

/**
 * Both sensors batch. The body and the extension each watch a ten-second window, count how many
 * times something happened in it — never what — and send that count. The belief added one per
 * report however many it carried, so a person clicking two hundred times looked exactly like one
 * who clicked once, and the counting both sensors do was thrown away on arrival.
 *
 * The comment here described a payload carrying a single interaction, `{ kind, target }`, which
 * no sensor has ever sent. That is what made the increment look right.
 *
 * Nothing reads this number today — it is not in the inspector and no engine asks for it — so
 * this is the belief being accurate rather than a bug someone could see.
 */
const T = "2026-09-05T00:00:00Z";
const interaction = (payload: Record<string, unknown>): MatterEvent => ({
  id: "e1", sessionId: "s", timestamp: T, source: "user", type: "user.interaction", severity: "debug", payload,
});

const after = (...payloads: Record<string, unknown>[]): number => {
  let world: WorldState = emptyWorldState("s", T);
  for (const payload of payloads) world = reduce(world, interaction(payload));
  return world.behavior.interactions;
};

describe("what the belief records of a window of interactions", () => {
  it("is how many the sensor counted", () => {
    expect(after({ count: 12, host: "example.com" })).toBe(12);
    expect(after({ count: 1 })).toBe(1);
    expect(after({ count: 0 })).toBe(0);
  });

  it("adds up across the windows a sensor reports", () => {
    expect(after({ count: 12 }, { count: 8 }, { count: 1 })).toBe(21);
  });

  it("is one when a sender reports an occurrence rather than a batch", () => {
    // an older sensor, or one that reports each interaction as it happens
    expect(after({})).toBe(1);
    expect(after({ host: "example.com" })).toBe(1);
    expect(after({}, {}, {})).toBe(3);
  });

  it("is nothing for a count that is not a count", () => {
    // Number(true) is 1 and Number("5") is 5; neither is a count anybody sent
    for (const count of ["many", "5", null, {}, [], true, false, NaN, -9, -Infinity]) {
      expect(after({ count }), JSON.stringify(count) ?? "undefined").toBe(0);
    }
  });

  it("is a whole number, whatever it was sent as", () => {
    expect(after({ count: 2.7 })).toBe(2);
    expect(after({ count: 0.4 })).toBe(0);
    expect(Number.isInteger(after({ count: 1.5 }, { count: 1.5 }))).toBe(true);
  });

  it("cannot be pushed past what a window could hold", () => {
    // the ingest API takes whatever a client posts, and a window with more than this in it is
    // not a person
    expect(after({ count: 1_000_000 })).toBe(10_000);
    expect(after({ count: Infinity })).toBe(0);
    expect(after({ count: Number.MAX_SAFE_INTEGER })).toBe(10_000);
  });

  it("still marks the moment and clears what the person was away from", () => {
    const world = reduce(
      { ...emptyWorldState("s", T), behavior: { ...emptyWorldState("s", T).behavior, idleSeconds: 90, awaySeconds: 300 } },
      interaction({ count: 5 }),
    );
    expect(world.behavior.interactions).toBe(5);
    expect(world.behavior.lastInteractionAt).toBe(T);
    expect(world.behavior.idleSeconds).toBe(0);
    expect(world.behavior.awaySeconds).toBe(0);
  });

  it("keeps one session's count out of another's", () => {
    const mine = reduce(emptyWorldState("mine", T), interaction({ count: 7 }));
    const theirs = reduce(emptyWorldState("theirs", T), { ...interaction({ count: 3 }), sessionId: "theirs" });
    expect(mine.behavior.interactions).toBe(7);
    expect(theirs.behavior.interactions).toBe(3);
  });
});
