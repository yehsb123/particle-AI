import { describe, it, expect } from "vitest";
import { emptyWorldState, RECENT_EVENTS_LIMIT, type MatterEvent, type WorldState } from "@particle/contracts";
import { reduce } from "./index";

/**
 * The world state is fed by sensors that never stop. Every list in it is bounded, and anything
 * the reducer does not understand must pass through without changing belief. These tests hold
 * those two properties — they are what keeps a long session from growing without limit or
 * drifting on malformed input.
 */
const T = (n: number) => new Date(Date.UTC(2026, 8, 3, 0, 0, n)).toISOString();
const start = () => emptyWorldState("s", T(0));

const ev = (over: Partial<MatterEvent> & Pick<MatterEvent, "type">): MatterEvent => ({
  id: `e-${Math.random().toString(36).slice(2, 8)}`,
  sessionId: "s",
  timestamp: T(1),
  source: "user",
  severity: "debug",
  payload: {},
  ...over,
});

function feed(world: WorldState, events: MatterEvent[]): WorldState {
  return events.reduce((w, e) => reduce(w, e), world);
}

describe("world model — every list is bounded", () => {
  it("keeps only the newest 50 events", () => {
    const w = feed(start(), Array.from({ length: 120 }, (_, i) => ev({ id: `x${i}`, type: "user.interaction", timestamp: T(i) })));
    expect(w.recentEvents).toHaveLength(RECENT_EVENTS_LIMIT);
    expect(w.recentEvents.at(-1)?.id).toBe("x119");
    expect(w.recentEvents[0]?.id).toBe("x70");
  });

  it("keeps 8 recent entities and 8 recent keys, newest last, without duplicates piling up", () => {
    const w = feed(start(), Array.from({ length: 30 }, (_, i) => ev({ type: "user.opened_file", payload: { path: `src/f${i}.ts` } })));
    expect(w.behavior.recentEntities).toHaveLength(8);
    expect(w.behavior.recentEntities.at(-1)).toBe("src/f29.ts");
    expect(w.behavior.recentKeys).toHaveLength(8);

    // re-opening a file moves it to the end instead of appearing twice
    const again = reduce(w, ev({ type: "user.opened_file", payload: { path: "src/f25.ts" } }));
    expect(again.behavior.recentEntities.filter((e) => e === "src/f25.ts")).toHaveLength(1);
    expect(again.behavior.recentEntities.at(-1)).toBe("src/f25.ts");
  });

  it("keeps 50 touched files even after hundreds of navigations", () => {
    const w = feed(start(), Array.from({ length: 300 }, (_, i) => ev({ type: "user.opened_file", payload: { path: `site:h${i}.example` } })));
    expect(w.environment.files).toHaveLength(50);
    expect(w.environment.files?.at(-1)).toBe("site:h299.example");
  });

  it("tracks at most 5 failing hosts, most recent first", () => {
    const w = feed(
      start(),
      Array.from({ length: 9 }, (_, i) => ev({ type: "network.request", source: "sensor", severity: "warning", payload: { host: `h${i}`, status: 503 } })),
    );
    expect(w.behavior.network.failingHosts).toEqual(["h8", "h7", "h6", "h5", "h4"]);
    expect(w.behavior.network.failures).toBe(9); // the counter still sees them all
  });

  it("accepts at most 16 reported sensing layers per sensor", () => {
    const layers = Array.from({ length: 40 }, (_, i) => `layer${i}`);
    const w = reduce(start(), ev({ type: "sensor.layers_changed", source: "sensor", payload: { sensor: "extension", layers } }));
    expect(w.sensing.extension).toHaveLength(16);
  });
});

describe("world model — unknown and malformed input changes nothing", () => {
  it("passes an unknown event type through, touching only the timestamp and the event log", () => {
    const before = start();
    const after = reduce(before, ev({ type: "totally.unknown.event", timestamp: T(5), payload: { anything: true } }));
    expect(after.updatedAt).toBe(T(5));
    expect(after.recentEvents).toHaveLength(1);
    expect(after.behavior).toEqual(before.behavior);
    expect(after.activeProblems).toEqual([]);
    expect(after.environment).toEqual(before.environment);
  });

  it("ignores events whose payload is the wrong shape", () => {
    const w = feed(start(), [
      ev({ type: "user.opened_file", payload: { path: 42 } }),
      ev({ type: "user.action", payload: { key: null } }),
      ev({ type: "user.changed_goal", payload: {} }),
      ev({ type: "sensor.layers_changed", source: "sensor", payload: { sensor: "x", layers: "not an array" } }),
      ev({ type: "network.request", source: "sensor", payload: {} }),
    ]);
    expect(w.behavior.recentEntities).toEqual([]);
    expect(w.behavior.lastActionKey).toBeUndefined();
    expect(w.currentGoal).toBeUndefined();
    expect(w.sensing.x).toBeUndefined();
    expect(w.behavior.network.failingHosts).toEqual([]); // a hostless request opens no problem
  });

  it("never mutates the state it was given", () => {
    const before = start();
    const snapshot = JSON.stringify(before);
    reduce(before, ev({ type: "user.opened_file", payload: { path: "src/a.ts" } }));
    reduce(before, ev({ type: "network.request", source: "sensor", payload: { host: "h", status: 500 } }));
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("is replay-stable: the same events in the same order give the same state", () => {
    const events = [
      ev({ id: "a", type: "user.opened_file", timestamp: T(1), payload: { path: "src/a.ts" } }),
      ev({ id: "b", type: "network.request", timestamp: T(2), source: "sensor", severity: "warning", payload: { host: "api", status: 503 } }),
      ev({ id: "c", type: "user.idle", timestamp: T(3), payload: { seconds: 90 } }),
      ev({ id: "d", type: "network.request", timestamp: T(4), source: "sensor", payload: { host: "api", status: 200 } }),
    ];
    expect(JSON.stringify(feed(start(), events))).toBe(JSON.stringify(feed(start(), events)));
  });
});

describe("world model — problem lifecycle stays consistent", () => {
  it("opens one network problem for many failures and closes it when the last host recovers", () => {
    let w = feed(start(), [
      ev({ type: "network.request", source: "sensor", severity: "warning", payload: { host: "a", status: 503 } }),
      ev({ type: "network.request", source: "sensor", severity: "warning", payload: { host: "b", status: 500 } }),
    ]);
    expect(w.activeProblems.filter((p) => p.kind === "network_failure")).toHaveLength(1);

    w = reduce(w, ev({ type: "network.request", source: "sensor", payload: { host: "a", status: 200 } }));
    expect(w.activeProblems).toHaveLength(1); // b is still failing
    w = reduce(w, ev({ type: "network.request", source: "sensor", payload: { host: "b", status: 204 } }));
    expect(w.activeProblems).toEqual([]);
    expect(w.behavior.network.failingHosts).toEqual([]);
  });

  it("counts slow answers without calling them failures", () => {
    const w = reduce(start(), ev({ type: "network.request", source: "sensor", payload: { host: "slow", status: 200, ms: 4000 } }));
    expect(w.behavior.network.slow).toBe(1);
    expect(w.behavior.network.failures).toBe(0);
    expect(w.activeProblems).toEqual([]);
  });
});
