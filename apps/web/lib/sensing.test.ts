import { describe, it, expect } from "vitest";
import { SENSOR_NAMES, SENSING_LAYERS } from "@particle/contracts";
import { describeSensor, describeLayer } from "./sensing";
import { t } from "./i18n";

/**
 * The indicator is the runtime's honesty about what it can see: which sensors are reporting and
 * what each of them watches. A name with no words behind it would appear as a bare identifier in
 * the one place the person looks to find out what is being observed about them.
 */
describe("every sensor and layer has words", () => {
  it("names each sensor in both languages", () => {
    for (const sensor of SENSOR_NAMES) {
      for (const lang of ["en", "ko"] as const) {
        expect(t(`sensor_${sensor}`, lang), `${lang}:${sensor}`).not.toBe(`sensor_${sensor}`);
      }
      expect(t(`sensor_${sensor}`, "en"), sensor).not.toBe(t(`sensor_${sensor}`, "ko"));
    }
  });

  it("names each layer in both languages", () => {
    for (const layer of SENSING_LAYERS) {
      for (const lang of ["en", "ko"] as const) {
        expect(t(`layer_${layer}`, lang), `${lang}:${layer}`).not.toBe(`layer_${layer}`);
      }
    }
  });

  it("includes the name the runtime gives a sensor that did not give one", () => {
    // the world model records an unnamed sensor as "unknown"; it used to reach the screen as
    // the lookup key itself
    expect(SENSOR_NAMES).toContain("unknown");
    expect(describeSensor("unknown", "en")).not.toBe("unknown");
    expect(describeSensor("unknown", "ko")).not.toBe("unknown");
  });

  it("describes each of them rather than naming it", () => {
    for (const sensor of SENSOR_NAMES) expect(describeSensor(sensor, "ko"), sensor).not.toBe(sensor);
    for (const layer of SENSING_LAYERS) expect(describeLayer(layer, "ko"), layer).not.toBe(layer);
  });
});

describe("a name nobody wrote words for", () => {
  it("is still shown, readably", () => {
    // saying that some sensor is watching is worth more than saying nothing is
    expect(describeSensor("some_new_sensor", "en")).toBe("some new sensor");
    expect(describeLayer("clipboard_shape", "ko")).toBe("clipboard shape");
  });

  it("never leaves the lookup key on the screen", () => {
    for (const name of [...SENSOR_NAMES, "invented"]) {
      expect(describeSensor(name, "en"), name).not.toContain("sensor_");
      expect(describeSensor(name, "ko"), name).not.toContain("sensor_");
    }
    for (const name of [...SENSING_LAYERS, "invented"]) {
      expect(describeLayer(name, "en"), name).not.toContain("layer_");
      expect(describeLayer(name, "ko"), name).not.toContain("layer_");
    }
  });

  it("has nothing to say for nothing", () => {
    expect(describeSensor("", "en")).toBe("");
    expect(describeLayer("", "en")).toBe("");
  });

  it("is not confused by a name that belongs to every object", () => {
    for (const name of ["toString", "constructor"]) {
      expect(describeSensor(name, "en"), name).toBe(name);
      expect(describeLayer(name, "en"), name).toBe(name);
    }
  });
});
