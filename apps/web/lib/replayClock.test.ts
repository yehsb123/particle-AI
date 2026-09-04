import { describe, it, expect } from "vitest";
import { createReplayClock } from "./replayClock";

/**
 * The body keeps its own log in the browser and replays it on reload. The guard that decides
 * whether a morph may happen reads this clock, so during a restore it has to be the saved
 * event's own instant — otherwise minutes of history collapse into microseconds and morphs that
 * happened live are refused. And it only moves forward: a saved log is in the order events were
 * recorded, but their timestamps came from a clock that can be stepped backwards.
 */
const T = (s: number) => `2026-09-04T00:00:${String(s).padStart(2, "0")}Z`;

describe("before and after a restore", () => {
  it("is real time until a replay begins", () => {
    const clock = createReplayClock(() => "wall-iso", () => 1_000);
    expect(clock.replaying()).toBe(false);
    expect(clock.iso()).toBe("wall-iso");
    expect(clock.ms()).toBe(1_000);
  });

  it("becomes the replayed event's own instant", () => {
    const clock = createReplayClock(() => "wall-iso", () => 1_000);
    clock.advanceTo(T(30));
    expect(clock.replaying()).toBe(true);
    expect(clock.iso()).toBe(T(30));
    expect(clock.ms()).toBe(Date.parse(T(30)));
  });

  it("goes back to real time when the restore is over", () => {
    const clock = createReplayClock(() => "wall-iso", () => 1_000);
    clock.advanceTo(T(30));
    clock.release();
    expect(clock.replaying()).toBe(false);
    expect(clock.iso()).toBe("wall-iso");
    expect(clock.ms()).toBe(1_000);
  });

  it("can be used for a second restore after the first", () => {
    const clock = createReplayClock();
    clock.advanceTo(T(30));
    clock.release();
    clock.advanceTo(T(5));
    expect(clock.iso()).toBe(T(5)); // a fresh restore starts wherever its own log starts
  });
});

describe("it only ever moves forward", () => {
  it("follows a log whose timestamps rise", () => {
    const clock = createReplayClock();
    for (const s of [0, 10, 30, 59]) {
      clock.advanceTo(T(s));
      expect(clock.iso(), String(s)).toBe(T(s));
    }
  });

  it("stays where it is for a timestamp older than the one before", () => {
    // a clock correction while the log was being written puts an earlier time after a later one
    const clock = createReplayClock();
    clock.advanceTo(T(30));
    clock.advanceTo(T(5));
    expect(clock.iso()).toBe(T(30));
    expect(clock.ms()).toBe(Date.parse(T(30)));
  });

  it("takes the same instant twice without complaint", () => {
    const clock = createReplayClock();
    clock.advanceTo(T(30));
    clock.advanceTo(T(30));
    expect(clock.iso()).toBe(T(30));
  });

  it("carries on after a timestamp it cannot read", () => {
    const clock = createReplayClock(() => "wall-iso");
    clock.advanceTo("not a timestamp");
    expect(clock.replaying()).toBe(false); // nothing to replay at, so real time still
    clock.advanceTo(T(10));
    clock.advanceTo("yesterday");
    expect(clock.iso()).toBe(T(10));
    clock.advanceTo(T(20));
    expect(clock.iso()).toBe(T(20));
  });

  it("keeps its two readings agreeing with each other", () => {
    const clock = createReplayClock();
    for (const s of [0, 30, 5, 59]) clock.advanceTo(T(s));
    expect(clock.ms()).toBe(Date.parse(clock.iso()));
  });
});
