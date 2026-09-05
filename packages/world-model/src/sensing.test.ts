import { describe, it, expect } from "vitest";
import { emptyWorldState, MAX_IDENTIFIER, type MatterEvent, type WorldState } from "@particle/contracts";
import { reduce } from "./index";

/**
 * A sensor declares what it observes, and the body shows that back to the person as the
 * honest-sensing indicator: these are the words someone reads to find out what is watching them.
 *
 * Every other identifier the belief takes goes through one reader that trims it and takes control
 * characters out. Layer names did not. How many a sensor could declare was bounded at sixteen,
 * but not how long one could be, so a five thousand character layer went into the belief whole
 * and one carrying an escape sequence kept it — into snapshots, into the rail that lists every
 * session this runtime senses, and into whatever an operator reads them with.
 */
const T = "2026-09-05T00:00:00Z";
const ESC = "\u001b";

const declares = (payload: Record<string, unknown>): WorldState =>
  reduce(emptyWorldState("s", T), {
    id: "e1", sessionId: "s", timestamp: T, source: "sensor", type: "sensor.layers_changed", severity: "debug", payload,
  } as MatterEvent);

const layersOf = (payload: Record<string, unknown>): string[] => {
  const sensing = declares(payload).sensing ?? {};
  return Object.values(sensing)[0] ?? [];
};

describe("what a sensor says it observes", () => {
  it("is taken as declared", () => {
    expect(layersOf({ sensor: "web", layers: ["interactions", "idle", "visibility"] })).toEqual([
      "interactions", "idle", "visibility",
    ]);
  });

  it("is trimmed when a name is long enough to be prose", () => {
    const [layer] = layersOf({ sensor: "web", layers: ["a".repeat(5_000)] });
    expect(layer!.length).toBe(MAX_IDENTIFIER + 1);
    expect(layer!.endsWith("…")).toBe(true);
  });

  it("carries no escape sequence into the words a person reads", () => {
    expect(layersOf({ sensor: "web", layers: [`tab${ESC}[31ms`] })).toEqual(["tab[31ms"]);
    for (let code = 0; code < 0xa0; code += 1) {
      if (code >= 0x20 && code < 0x7f) continue;
      const char = String.fromCharCode(code);
      expect(layersOf({ sensor: "web", layers: [`a${char}b`] }), `U+${code.toString(16)}`).toEqual(["ab"]);
    }
  });

  it("keeps the names that are names and drops the rest", () => {
    expect(layersOf({ sensor: "web", layers: ["tabs", 7, null, {}, [], true, "", "idle"] })).toEqual(["tabs", "idle"]);
  });

  it("is still bounded in how many it may declare", () => {
    const many = Array.from({ length: 500 }, (_, i) => `layer${i}`);
    expect(layersOf({ sensor: "web", layers: many })).toHaveLength(16);
  });

  it("is nothing when a name is only characters that cannot be shown", () => {
    expect(layersOf({ sensor: "web", layers: [ESC, "\u0000\u0007"] })).toEqual([]);
  });

  it("is nothing at all when the sensor declares no list", () => {
    for (const layers of [undefined, null, "tabs", 7, {}]) {
      const sensing = declares({ sensor: "web", layers }).sensing ?? {};
      expect(Object.keys(sensing), JSON.stringify(layers) ?? "undefined").toEqual([]);
    }
  });

  it("is recorded under a sensor name that was trimmed the same way", () => {
    const sensing = declares({ sensor: `we${ESC}[31mb`, layers: ["tabs"] }).sensing ?? {};
    expect(Object.keys(sensing)).toEqual(["we[31mb"]);

    const long = declares({ sensor: "a".repeat(5_000), layers: ["tabs"] }).sensing ?? {};
    expect(Object.keys(long)[0]!.length).toBe(MAX_IDENTIFIER + 1);
  });

  it("is kept for the sensor that declared it and no other", () => {
    let world = emptyWorldState("s", T);
    for (const [sensor, layers] of [["web", ["idle"]], ["extension", ["tabs"]]] as [string, string[]][]) {
      world = reduce(world, {
        id: `e-${sensor}`, sessionId: "s", timestamp: T, source: "sensor", type: "sensor.layers_changed", severity: "debug",
        payload: { sensor, layers },
      } as MatterEvent);
    }
    expect(world.sensing).toEqual({ web: ["idle"], extension: ["tabs"] });
  });
});
