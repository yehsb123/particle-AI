import { describe, it, expect } from "vitest";
import { SIM_EVENTS, simEvent, buildSimEvent, MatterEvent, KNOWN_EVENT_TYPES } from "./index";

/**
 * The palette used to be written out twice: once as an object in the runtime, once as an array in
 * the body. The body builds these itself in local mode, where there is no runtime to ask, and the
 * runtime builds them in connected mode, where the body only sends a key — so both needed the
 * list and neither could be the source. They had already drifted apart on two entries, which
 * meant the same button sent a different event depending on which mode a person was in: exactly
 * the difference connected mode is supposed not to have.
 */
const T = "2026-09-05T00:00:00Z";

describe("the palette", () => {
  it("offers something to simulate", () => {
    expect(SIM_EVENTS.length).toBeGreaterThan(8);
  });

  it("gives every entry a key, a label, a type and a severity", () => {
    for (const spec of SIM_EVENTS) {
      expect(spec.key.length, spec.label).toBeGreaterThan(0);
      expect(spec.label.length, spec.key).toBeGreaterThan(0);
      expect(spec.type.length, spec.key).toBeGreaterThan(0);
      expect(["debug", "info", "notice", "warning", "critical"], spec.key).toContain(spec.severity);
    }
  });

  it("names every key exactly once", () => {
    const keys = SIM_EVENTS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses keys that survive being put in a URL", () => {
    for (const spec of SIM_EVENTS) {
      expect(spec.key, spec.key).toMatch(/^[a-z0-9-]+$/);
      expect(encodeURIComponent(spec.key), spec.key).toBe(spec.key);
    }
  });

  it("names event types the runtime knows", () => {
    const known = new Set<string>(KNOWN_EVENT_TYPES);
    for (const spec of SIM_EVENTS) {
      expect(known.has(spec.type), `${spec.key} -> ${spec.type}`).toBe(true);
    }
  });

  it("can tell a story: something breaks, and something recovers", () => {
    const types = SIM_EVENTS.map((s) => s.type);
    for (const type of ["development.server_error", "development.server_recovered", "security.vulnerability_detected", "network.request"]) {
      expect(types, type).toContain(type);
    }
  });
});

describe("finding the event a key names", () => {
  it("finds each one the palette offers", () => {
    for (const spec of SIM_EVENTS) {
      expect(simEvent(spec.key), spec.key).toBe(spec);
    }
  });

  it("finds nothing for a key nobody defined", () => {
    for (const key of ["no-such-key", "HTTP-500", " http-500", "http-500 "]) {
      expect(simEvent(key), key).toBeUndefined();
    }
  });

  it("finds nothing for a name that belongs to every object", () => {
    // the key comes off a URL, and a palette held as an object answered to these with something
    // truthy that was not an event
    for (const key of ["toString", "constructor", "__proto__", "valueOf", "hasOwnProperty", "prototype"]) {
      expect(simEvent(key), key).toBeUndefined();
    }
  });

  it("finds nothing for a key that is not a key", () => {
    for (const key of [undefined, null, 7, {}, [], true, ""]) {
      expect(simEvent(key), JSON.stringify(key) ?? "undefined").toBeUndefined();
    }
  });
});

describe("the event a button builds", () => {
  it("is one the contract accepts, for every entry", () => {
    for (const spec of SIM_EVENTS) {
      const event = buildSimEvent(spec, "s", `e-${spec.key}`, T);
      expect(MatterEvent.safeParse(event).success, spec.key).toBe(true);
      expect(event.type, spec.key).toBe(spec.type);
      expect(event.sessionId, spec.key).toBe("s");
    }
  });

  it("carries a payload even where the entry declares none", () => {
    for (const spec of SIM_EVENTS) {
      expect(buildSimEvent(spec, "s", "e", T).payload, spec.key).toBeDefined();
    }
  });

  it("is the same event whichever side of the demo builds it", () => {
    // the body builds it in local mode and the runtime builds it in connected mode; one function
    // and one list is what makes those the same thing
    for (const spec of SIM_EVENTS) {
      const fromBody = buildSimEvent(spec, "s", "e1", T);
      const fromRuntime = buildSimEvent(simEvent(spec.key)!, "s", "e1", T);
      expect(fromRuntime, spec.key).toEqual(fromBody);
    }
  });
});
