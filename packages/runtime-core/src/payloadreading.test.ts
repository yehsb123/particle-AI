import { describe, it, expect } from "vitest";
import { emptyWorldState, type MatterEvent, type WorldState } from "@particle/contracts";
import { reduce } from "@particle/world-model";
import { evaluateSignificance } from "@particle/significance-engine";

/**
 * The belief and the reflex read the same payload, so they have to read it the same way.
 *
 * They did not. The belief took a number only when it was one, and cleaned every name it kept;
 * the reflex ran the same fields through Number() and String() and compared the raw payload
 * against the cleaned name the belief had stored. Two readings of one event:
 *
 *   { status: [503] } was not a failure to the belief and was one to the reflex, so a deliberation
 *   cycle ran — and with a real provider behind it, a model call went out — over an incident that
 *   never happened.
 *
 *   a path longer than a name may be was stored cut and compared whole, so opening it three times
 *   raised the belief's repeat count and never once raised the reflex's behavior signal. The
 *   person who was stuck got no card.
 *
 * These are not two tests of two modules. They are one test that the two agree, which is the only
 * thing that was ever broken.
 */
const T = (s: number) => `2026-09-05T00:00:${String(s).padStart(2, "0")}Z`;

const ev = (type: string, payload: Record<string, unknown>, source: MatterEvent["source"] = "user", at = 0): MatterEvent => ({
  id: `e${at}`,
  sessionId: "s",
  timestamp: T(at),
  source,
  severity: "info",
  type,
  payload,
});

const fresh = (): WorldState => emptyWorldState("s", T(0));

/** What each side made of one event arriving at one world. */
const bothRead = (world: WorldState, event: MatterEvent) => ({
  belief: reduce(world, event),
  reflex: evaluateSignificance(event, world),
});

describe("a status shaped like a number", () => {
  it("is a failure to both sides when it is a real one", () => {
    const { belief, reflex } = bothRead(fresh(), ev("network.request", { host: "api.example.com", status: 503 }, "sensor"));
    expect(belief.behavior.network.failingHosts).toEqual(["api.example.com"]);
    expect(reflex.reasonCodes).toContain("network_shape");
  });

  it("is a failure to neither side when it is only shaped like one", () => {
    for (const status of [[503], "503", true, { code: 503 }]) {
      const label = JSON.stringify(status) ?? "undefined";
      const { belief, reflex } = bothRead(fresh(), ev("network.request", { host: "api.example.com", status }, "sensor"));
      expect(belief.behavior.network.failingHosts, label).toEqual([]);
      expect(reflex.reasonCodes, label).not.toContain("network_shape");
      expect(reflex.shouldDeliberate, label).toBe(false);
    }
  });

  it("names the failing host the same way on both sides, so a recovery is recognised", () => {
    // the belief cleans a host name; the reflex compared the raw payload against the cleaned one
    const host = `api.${"x".repeat(200)}.example.com`;
    const failing = reduce(fresh(), ev("network.request", { host, status: 503 }, "sensor", 1));
    const recovery = ev("network.request", { host, status: 200 }, "sensor", 2);
    expect(failing.behavior.network.failingHosts).toHaveLength(1);
    expect(evaluateSignificance(recovery, failing).reasonCodes).toContain("network_shape");
  });
});

describe("a duration shaped like a number", () => {
  it("is read by neither side when it is a string", () => {
    const idle = bothRead(fresh(), ev("user.idle", { seconds: "600" }));
    expect(idle.belief.behavior.idleSeconds).toBe(0);
    expect(idle.reflex.reasonCodes).not.toContain("behavior_signal");

    const back = bothRead(fresh(), ev("user.visibility", { visible: true, awaySeconds: "300" }));
    expect(back.belief.behavior.awaySeconds).toBe(0);
    expect(back.reflex.reasonCodes).not.toContain("behavior_signal");
  });

  it("is read by both sides when it is a number", () => {
    const idle = bothRead(fresh(), ev("user.idle", { seconds: 600 }));
    expect(idle.belief.behavior.idleSeconds).toBe(600);
    expect(idle.reflex.reasonCodes).toContain("behavior_signal");

    const back = bothRead(fresh(), ev("user.visibility", { visible: true, awaySeconds: 300 }));
    expect(back.belief.behavior.awaySeconds).toBe(300);
    expect(back.reflex.reasonCodes).toContain("behavior_signal");
  });
});

describe("a name longer than a name may be", () => {
  /** Open or act on the same thing three times; the third is the one that should say "stuck". */
  const thirdTime = (type: string, field: string, value: string) => {
    let world = fresh();
    world = reduce(world, ev(type, { [field]: value }, "user", 1));
    world = reduce(world, ev(type, { [field]: value }, "user", 2));
    const third = ev(type, { [field]: value }, "user", 3);
    return { world, reflex: evaluateSignificance(third, world) };
  };

  it("counts up on both sides when it is short", () => {
    const { world, reflex } = thirdTime("user.opened_file", "path", "src/a.ts");
    expect(world.behavior.repeatCount).toBe(2);
    expect(reflex.reasonCodes).toContain("behavior_signal");
  });

  it("counts up on both sides when it is too long to keep whole", () => {
    const { world, reflex } = thirdTime("user.opened_file", "path", `src/${"deep/".repeat(40)}a.ts`);
    expect(world.behavior.repeatCount).toBe(2);
    expect(reflex.reasonCodes).toContain("behavior_signal");
  });

  it("counts up on both sides when it carries a control character", () => {
    const { world, reflex } = thirdTime("user.action", "key", `re-run${String.fromCharCode(27)}[2J`);
    expect(world.behavior.repeatCount).toBe(2);
    expect(reflex.reasonCodes).toContain("behavior_signal");
  });
});
