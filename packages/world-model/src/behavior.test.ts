import { describe, it, expect } from "vitest";
import { WorldState, emptyWorldState, type MatterEvent } from "@particle/contracts";
import { reduce } from "./index";

/**
 * The behaviour half of the world: what someone has been doing, and what the sensors report
 * about traffic. Every field here comes out of an event payload, and a payload is whatever a
 * client posts, so the reducer has to fold it in without believing it — and whatever arrives,
 * the result still has to be a world state the schema accepts.
 */
const T = "2026-09-04T00:00:00Z";
const ev = (type: string, payload: Record<string, unknown>, id = "e"): MatterEvent => ({
  id,
  sessionId: "s",
  timestamp: T,
  source: "sensor",
  type,
  severity: "debug",
  payload,
});

const fold = (events: MatterEvent[]) => events.reduce((w, e) => reduce(w, e), emptyWorldState("s", T));
const valid = (w: unknown) => WorldState.safeParse(w).success;

describe("what the sensors say they watch", () => {
  it("records a sensor's layers, and forgets it when it says it watches nothing", () => {
    const on = fold([ev("sensor.layers_changed", { sensor: "extension", layers: ["tabs", "network"] })]);
    expect(on.sensing).toEqual({ extension: ["tabs", "network"] });
    const off = reduce(on, ev("sensor.layers_changed", { sensor: "extension", layers: [] }));
    expect(off.sensing).toEqual({});
  });

  it("keeps each sensor separate", () => {
    const w = fold([
      ev("sensor.layers_changed", { sensor: "extension", layers: ["tabs"] }, "e1"),
      ev("sensor.layers_changed", { sensor: "agent", layers: ["files", "git"] }, "e2"),
    ]);
    expect(w.sensing).toEqual({ extension: ["tabs"], agent: ["files", "git"] });
  });

  it("survives a sensor named after something the language uses", () => {
    // assigning by key would have set the prototype for a sensor called __proto__, leaving a
    // sensing map that reads as empty and a world state that fails its own validation
    for (const sensor of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      const w = fold([ev("sensor.layers_changed", { sensor, layers: ["tabs"] })]);
      expect(Object.keys(w.sensing ?? {}), sensor).toEqual([sensor]);
      expect(valid(w), sensor).toBe(true);
      expect(Object.getPrototypeOf(w.sensing), sensor).toBe(Object.prototype);
    }
  });

  it("takes only strings as layers, and only so many", () => {
    const w = fold([ev("sensor.layers_changed", { sensor: "x", layers: ["a", 42, null, "b", { deep: true }] })]);
    expect(w.sensing?.x).toEqual(["a", "b"]);
    const many = fold([ev("sensor.layers_changed", { sensor: "x", layers: Array.from({ length: 40 }, (_, i) => `l${i}`) })]);
    expect(many.sensing?.x).toHaveLength(16);
  });

  it("ignores a report that is not a list of layers", () => {
    for (const layers of ["tabs", 42, null, { tabs: true }]) {
      const w = fold([ev("sensor.layers_changed", { sensor: "x", layers })]);
      expect(w.sensing, JSON.stringify(layers)).toEqual({});
    }
  });

  it("stops taking new sensors long before a client can fill the world with them", () => {
    const w = fold(Array.from({ length: 300 }, (_, i) => ev("sensor.layers_changed", { sensor: `s${i}`, layers: ["x"] }, `e${i}`)));
    expect(Object.keys(w.sensing ?? {}).length).toBeLessThanOrEqual(16);
    expect(valid(w)).toBe(true);
  });

  it("still lets a sensor already known update itself at the ceiling", () => {
    const full = fold(Array.from({ length: 20 }, (_, i) => ev("sensor.layers_changed", { sensor: `s${i}`, layers: ["x"] }, `e${i}`)));
    const updated = reduce(full, ev("sensor.layers_changed", { sensor: "s0", layers: ["y"] }, "again"));
    expect(updated.sensing?.s0).toEqual(["y"]);
  });
});

describe("traffic, as shape", () => {
  const request = (payload: Record<string, unknown>, id: string) => ev("network.request", payload, id);

  it("counts a request, a failure and a slow answer", () => {
    const w = fold([
      request({ host: "a.com", status: 200, ms: 10 }, "n1"),
      request({ host: "b.com", status: 503 }, "n2"),
      request({ host: "c.com", status: 200, ms: 3000 }, "n3"),
    ]);
    expect(w.behavior.network).toMatchObject({ requests: 3, failures: 1, slow: 1 });
    expect(w.behavior.network.failingHosts).toEqual(["b.com"]);
  });

  it("opens one problem while a host is failing, and closes it when it answers again", () => {
    const failing = fold([request({ host: "a.com", status: 503 }, "n1"), request({ host: "a.com", status: 500 }, "n2")]);
    expect(failing.activeProblems.filter((p) => p.kind === "network_failure")).toHaveLength(1);
    const back = reduce(failing, request({ host: "a.com", status: 200 }, "n3"));
    expect(back.behavior.network.failingHosts).toEqual([]);
    expect(back.activeProblems.filter((p) => p.kind === "network_failure")).toHaveLength(0);
  });

  it("keeps the problem while any other host is still failing", () => {
    const w = fold([
      request({ host: "a.com", status: 503 }, "n1"),
      request({ host: "b.com", status: 503 }, "n2"),
      request({ host: "a.com", status: 200 }, "n3"),
    ]);
    expect(w.behavior.network.failingHosts).toEqual(["b.com"]);
    expect(w.activeProblems.filter((p) => p.kind === "network_failure")).toHaveLength(1);
  });

  it("treats a transport error as a failure whatever the status says", () => {
    const w = fold([request({ host: "a.com", error: true }, "n1")]);
    expect(w.behavior.network.failures).toBe(1);
    expect(w.behavior.network.failingHosts).toEqual(["a.com"]);
  });

  it("does not treat a client error or a redirect as a failing host", () => {
    const w = fold([request({ host: "a.com", status: 404 }, "n1"), request({ host: "b.com", status: 302 }, "n2")]);
    expect(w.behavior.network.failures).toBe(0);
    expect(w.behavior.network.failingHosts).toEqual([]);
  });

  it("remembers only the last few failing hosts", () => {
    const w = fold(Array.from({ length: 12 }, (_, i) => request({ host: `h${i}.com`, status: 503 }, `n${i}`)));
    expect(w.behavior.network.failingHosts).toHaveLength(5);
    expect(w.behavior.network.failingHosts[0]).toBe("h11.com");
  });

  it("puts a host back at the front when it fails again", () => {
    const w = fold([
      request({ host: "a.com", status: 503 }, "n1"),
      request({ host: "b.com", status: 503 }, "n2"),
      request({ host: "a.com", status: 503 }, "n3"),
    ]);
    expect(w.behavior.network.failingHosts).toEqual(["a.com", "b.com"]);
  });

  it("folds in a payload of the wrong shape without breaking the world", () => {
    const w = fold([request({ host: 42, status: "503", ms: "slow" }, "n1"), request({}, "n2")]);
    expect(valid(w)).toBe(true);
    expect(w.behavior.network.requests).toBe(2);
    // The request is still counted — that it happened is shape. But a status of "503" is not a
    // status: it used to be read as one, and a host marked failing is what reshapes the body
    // around a connection view, so a wrong-shaped payload could invent an incident nobody had.
    expect(w.behavior.network.failingHosts).toEqual([]);
    expect(w.behavior.network.failures).toBe(0);
  });

  it("reads a real failure exactly as before", () => {
    const w = fold([request({ host: "api.example.com", status: 503, ms: 1800 }, "n3")]);
    expect(w.behavior.network.failingHosts).toEqual(["api.example.com"]);
    expect(w.behavior.network.failures).toBe(1);
  });
});

describe("what someone has been doing", () => {
  it("counts interactions and clears idle and away time", () => {
    const w = fold([
      ev("user.idle", { seconds: 120 }, "i1"),
      ev("user.interaction", { kind: "click" }, "i2"),
    ]);
    expect(w.behavior.interactions).toBe(1);
    expect(w.behavior.idleSeconds).toBe(0);
    expect(w.behavior.lastInteractionAt).toBe(T);
  });

  it("reads a duration only when it is a real, non-negative number", () => {
    expect(fold([ev("user.idle", { seconds: 90 })]).behavior.idleSeconds).toBe(90);
    for (const seconds of ["ninety", -5, null, undefined, Number.NaN, {}]) {
      expect(fold([ev("user.idle", { seconds })]).behavior.idleSeconds, JSON.stringify(seconds) ?? "undefined").toBe(0);
    }
  });

  it("records coming back only when the person is actually back", () => {
    expect(fold([ev("user.visibility", { visible: true, awaySeconds: 90 })]).behavior.awaySeconds).toBe(90);
    expect(fold([ev("user.visibility", { visible: false, awaySeconds: 90 })]).behavior.awaySeconds).toBe(0);
    expect(fold([ev("user.visibility", { visible: "yes", awaySeconds: 90 })]).behavior.awaySeconds).toBe(0);
  });

  it("counts a repeated action and resets on a different one", () => {
    const same = fold([1, 2, 3].map((i) => ev("user.action", { key: "retry" }, `a${i}`)));
    expect(same.behavior.repeatCount).toBe(3);
    expect(same.behavior.lastActionKey).toBe("retry");
    const different = reduce(same, ev("user.action", { key: "open" }, "a4"));
    expect(different.behavior.repeatCount).toBe(1);
  });

  it("ignores an action with no key at all", () => {
    const w = fold([ev("user.action", { key: "retry" }, "a1"), ev("user.action", { key: 42 }, "a2")]);
    expect(w.behavior.repeatCount).toBe(1);
    expect(w.behavior.lastActionKey).toBe("retry");
  });

  it("remembers the last few places, most recent last, without repeating one", () => {
    const w = fold([
      ev("user.opened_file", { path: "a.ts" }, "f1"),
      ev("user.opened_file", { path: "b.ts" }, "f2"),
      ev("user.opened_file", { path: "a.ts" }, "f3"),
    ]);
    expect(w.behavior.recentEntities).toEqual(["b.ts", "a.ts"]);
    expect(w.activeContext.focusedEntity).toBe("a.ts");
  });

  it("counts how often the person handed a change back", () => {
    const w = fold([ev("user.requested_undo", {}, "u1"), ev("user.requested_undo", {}, "u2")]);
    expect(w.behavior.undoCount).toBe(2);
  });

  it("stays a valid world however odd the behaviour payloads are", () => {
    const w = fold([
      ev("user.idle", { seconds: -1 }, "b1"),
      ev("user.visibility", { visible: 1 }, "b2"),
      ev("user.action", { key: null }, "b3"),
      ev("user.opened_file", { path: 42 }, "b4"),
      ev("user.interaction", {}, "b5"),
      ev("network.request", { host: null }, "b6"),
    ]);
    expect(valid(w)).toBe(true);
  });
});
