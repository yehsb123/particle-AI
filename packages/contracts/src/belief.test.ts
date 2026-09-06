import { describe, it, expect } from "vitest";
import {
  WorldState,
  RECENT_EVENTS_LIMIT,
  MAX_ENVIRONMENT_ITEMS,
  MAX_SENSORS,
  MAX_SENSOR_LAYERS,
  MAX_IDENTIFIER,
} from "./index";

/**
 * A belief arrives two ways: folded from a live event by the reducer, or read straight off a
 * snapshot on resume. The reducer had been hardened — sixteen sensors, sixteen layers each, every
 * name cleaned and cut, an own property written even for a sensor called "__proto__" — and the
 * schema had been left saying none of it.
 *
 * So the resume path restored exactly what the reducer exists to prevent. Measured on the real
 * server: a snapshot holding five hundred sensors with five-thousand-character layer names and ten
 * thousand recent events came back whole, and the world-state broadcast that every watching body
 * receives went from about a kilobyte to four megabytes — and stayed there, since that belief is
 * snapshotted again and put in every prompt.
 *
 * The sensing map is also the one thing on screen that tells a person what is watching them, drawn
 * from here verbatim. What it can say is not something a snapshot gets to decide.
 *
 * It trims rather than refuses: refusing fails the whole parse, and a resume is meant to bring back
 * everything it can understand rather than nothing.
 */
const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);
const CONTROL = new RegExp("[" + String.fromCharCode(0) + "-" + String.fromCharCode(31) + "]");

const belief = (over: Record<string, unknown> = {}) => ({
  sessionId: "s1",
  updatedAt: "2026-09-07T00:00:00.000Z",
  ...over,
});
const event = (i: number) => ({
  id: "e" + i,
  sessionId: "s1",
  timestamp: "2026-09-07T00:00:00.000Z",
  source: "user",
  type: "user.interaction",
  severity: "info",
  payload: { kind: "click" },
});

describe("a belief read back off a snapshot", () => {
  it("is still a belief when it is an ordinary one", () => {
    const parsed = WorldState.parse(belief({
      sensing: { web: ["interactions", "idle"], ext: ["tabs"] },
      recentEvents: [event(1), event(2)],
      environment: { applications: ["code", "chrome"] },
    }));
    expect(parsed.sensing).toEqual({ web: ["interactions", "idle"], ext: ["tabs"] });
    expect(parsed.recentEvents.length).toBe(2);
    expect(parsed.environment.applications).toEqual(["code", "chrome"]);
  });

  it("holds the sensing map to what a sensor may actually say", () => {
    const sensing: Record<string, string[]> = {};
    for (let i = 0; i < 500; i++) sensing["sensor-" + i] = ["layer-" + "L".repeat(5_000)];
    const parsed = WorldState.parse(belief({ sensing }));
    expect(Object.keys(parsed.sensing).length).toBe(MAX_SENSORS);
    for (const layers of Object.values(parsed.sensing)) {
      expect(layers.length).toBeLessThanOrEqual(MAX_SENSOR_LAYERS);
      for (const layer of layers) expect(layer.length).toBeLessThanOrEqual(MAX_IDENTIFIER + 1);
    }
  });

  it("shows no name it could not have been given", () => {
    const parsed = WorldState.parse(belief({
      sensing: { ["watching" + ESC + "[31m"]: ["network" + NUL, "everything you type"] },
    }));
    const names = Object.keys(parsed.sensing);
    const layers = Object.values(parsed.sensing).flat();
    expect(names.some((n) => CONTROL.test(n))).toBe(false);
    expect(layers.some((l) => CONTROL.test(l))).toBe(false);
    // the sensor is still shown, under the name a person can actually read
    expect(names).toEqual(["watching[31m"]);
    expect(layers).toEqual(["network", "everything you type"]);
  });

  it("drops a sensor that has nothing left to be called", () => {
    const parsed = WorldState.parse(belief({ sensing: { [ESC + NUL]: ["network"], web: ["idle"] } }));
    expect(Object.keys(parsed.sensing)).toEqual(["web"]);
  });

  it("drops a sensor declaring no layers, the way revoking one does", () => {
    const parsed = WorldState.parse(belief({ sensing: { web: [], ext: ["tabs"] } }));
    expect(Object.keys(parsed.sensing)).toEqual(["ext"]);
  });

  it("writes an own property even when cleaning a name produces a dangerous one", () => {
    // zod drops a literal "__proto__" key before the transform ever sees it, so the danger is not
    // the obvious spelling: it is a name that becomes that one only after the control characters
    // come out. Assigning by key there would set the prototype, leaving a sensing map that looks
    // empty and a world state failing its own schema, from one snapshot.
    // a computed key, so this is an own property named __proto__ plus an escape, not a prototype
    const sensing: Record<string, string[]> = { ["__proto__" + ESC]: ["network"], web: ["idle"] };
    const parsed = WorldState.parse(belief({ sensing }));
    expect(Object.getPrototypeOf(parsed.sensing)).toBe(Object.prototype);
    expect(Object.hasOwn(parsed.sensing, "__proto__")).toBe(true);
    expect(Object.hasOwn(parsed.sensing, "web")).toBe(true);
    expect(parsed.sensing.web).toEqual(["idle"]);
  });

  it("keeps the newest recent events and no more than the reducer would", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => event(i));
    const parsed = WorldState.parse(belief({ recentEvents: many }));
    expect(parsed.recentEvents.length).toBe(RECENT_EVENTS_LIMIT);
    // the newest are the ones that mean anything
    expect(parsed.recentEvents.at(-1)?.id).toBe("e9999");
  });

  it("holds the environment lists to a length", () => {
    const parsed = WorldState.parse(belief({
      environment: {
        applications: Array.from({ length: 5_000 }, (_, i) => "app-" + i),
        files: Array.from({ length: 5_000 }, (_, i) => "f" + i),
      },
    }));
    expect(parsed.environment.applications?.length).toBe(MAX_ENVIRONMENT_ITEMS);
    expect(parsed.environment.files?.length).toBe(MAX_ENVIRONMENT_ITEMS);
  });

  it("weighs what a belief weighs, whatever the snapshot weighed", () => {
    const sensing: Record<string, string[]> = {};
    for (let i = 0; i < 500; i++) sensing["sensor-" + i] = ["layer-" + "L".repeat(5_000)];
    const big = belief({
      sensing,
      recentEvents: Array.from({ length: 10_000 }, (_, i) => event(i)),
      environment: { applications: Array.from({ length: 5_000 }, (_, i) => "app-" + i) },
    });
    expect(JSON.stringify(big).length).toBeGreaterThan(3_000_000);
    expect(JSON.stringify(WorldState.parse(big)).length).toBeLessThan(60_000);
  });

  it("comes back rather than being refused, because a resume brings back what it can", () => {
    const sensing: Record<string, string[]> = {};
    for (let i = 0; i < 500; i++) sensing["sensor-" + i] = ["x"];
    const parsed = WorldState.safeParse(belief({ sensing, recentEvents: Array.from({ length: 9_000 }, (_, i) => event(i)) }));
    expect(parsed.success).toBe(true);
  });
});
