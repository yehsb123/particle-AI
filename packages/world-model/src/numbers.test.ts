import { describe, it, expect } from "vitest";
import { emptyWorldState, type MatterEvent, type WorldState } from "@particle/contracts";
import { reduce } from "./index";

/**
 * Every number the belief takes off a payload goes through one reader now.
 *
 * There were three: a strict one for counts, and two that used Number(), which reads true as 1,
 * "300" as three hundred and [503] as five hundred and three. None of those is a number anybody
 * sent, and it mattered most where the belief acts on the value — a status of [503] marked a host
 * as failing, and a failing host is what reshapes the body around a connection view. A payload
 * shaped like a number could invent an incident nobody had.
 *
 * The sensors have always checked the same way before sending, so nothing a real sensor sends
 * reads differently than it did.
 */
const T = "2026-09-05T00:00:00Z";
const NOT_NUMBERS = [true, false, "300", "503", [300], [503], [], {}, null, "many", NaN, Infinity, -Infinity];

const ev = (type: string, payload: Record<string, unknown>, source: MatterEvent["source"] = "user"): MatterEvent => ({
  id: "e1", sessionId: "s", timestamp: T, source, severity: "info", type, payload,
});
const after = (event: MatterEvent): WorldState => reduce(emptyWorldState("s", T), event);

describe("a duration the belief is told about", () => {
  it("is taken when it is a number of seconds", () => {
    expect(after(ev("user.idle", { seconds: 90 })).behavior.idleSeconds).toBe(90);
    expect(after(ev("user.visibility", { visible: true, awaySeconds: 300 })).behavior.awaySeconds).toBe(300);
  });

  it("is nothing when it is not a number", () => {
    for (const value of NOT_NUMBERS) {
      const label = JSON.stringify(value) ?? "undefined";
      expect(after(ev("user.idle", { seconds: value })).behavior.idleSeconds, `idle ${label}`).toBe(0);
      expect(after(ev("user.visibility", { visible: true, awaySeconds: value })).behavior.awaySeconds, `away ${label}`).toBe(0);
    }
  });

  it("is nothing when it is missing, or not a duration at all", () => {
    expect(after(ev("user.idle", {})).behavior.idleSeconds).toBe(0);
    expect(after(ev("user.idle", { seconds: -30 })).behavior.idleSeconds).toBe(0);
    expect(after(ev("user.visibility", { visible: true })).behavior.awaySeconds).toBe(0);
  });
});

describe("a request the belief is told about", () => {
  const request = (payload: Record<string, unknown>) => after(ev("network.request", payload, "sensor")).behavior.network;

  it("is a failure when the status says so", () => {
    const net = request({ host: "api.example.com", status: 503, ms: 120 });
    expect(net.failures).toBe(1);
    expect(net.failingHosts).toEqual(["api.example.com"]);
  });

  it("is not a failure because the status was shaped like one", () => {
    // this is the one that reshapes the body: a failing host opens a connection view
    for (const status of NOT_NUMBERS) {
      const net = request({ host: "api.example.com", status, ms: 120 });
      expect(net.failures, JSON.stringify(status) ?? "undefined").toBe(0);
      expect(net.failingHosts, JSON.stringify(status) ?? "undefined").toEqual([]);
    }
  });

  it("is still a failure when the sensor says so outright", () => {
    // error: true is the sensor's own word, not a number to be read
    const net = request({ host: "api.example.com", error: true });
    expect(net.failures).toBe(1);
    expect(net.failingHosts).toEqual(["api.example.com"]);
  });

  it("is not slow because the latency was shaped like a number", () => {
    for (const ms of NOT_NUMBERS) {
      expect(request({ host: "api.example.com", status: 200, ms }).slow, JSON.stringify(ms) ?? "undefined").toBe(0);
    }
    expect(request({ host: "api.example.com", status: 200, ms: 99_999 }).slow).toBe(1);
  });

  it("is counted as having happened either way", () => {
    // that a request happened is shape; what its status was is a claim about the request
    expect(request({ host: "api.example.com", status: "503" }).requests).toBe(1);
    expect(request({}).requests).toBe(1);
  });
});

describe("a count the belief is told about", () => {
  it("is taken when it is a number, and is one when nobody said", () => {
    expect(after(ev("user.interaction", { count: 12 })).behavior.interactions).toBe(12);
    expect(after(ev("user.interaction", {})).behavior.interactions).toBe(1);
  });

  it("is nothing when it is not a number", () => {
    for (const count of NOT_NUMBERS) {
      expect(after(ev("user.interaction", { count })).behavior.interactions, JSON.stringify(count) ?? "undefined").toBe(0);
    }
  });
});

describe("whatever it is told", () => {
  it("stays a belief the contract accepts", () => {
    for (const value of NOT_NUMBERS) {
      for (const [type, field] of [["user.idle", "seconds"], ["user.interaction", "count"], ["network.request", "status"]] as [string, string][]) {
        const world = after(ev(type, { host: "api.example.com", visible: true, [field]: value }, "sensor"));
        expect(Number.isFinite(world.behavior.idleSeconds), `${type} ${field}`).toBe(true);
        expect(Number.isFinite(world.behavior.interactions), `${type} ${field}`).toBe(true);
        expect(Number.isFinite(world.behavior.network.failures), `${type} ${field}`).toBe(true);
      }
    }
  });
});
