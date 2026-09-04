import { describe, it, expect } from "vitest";
import type { MatterEvent } from "@particle/contracts";
import { replay } from "./replay";
import { createRuntimeCore } from "./factory";
import type { RuntimeClock } from "./index";

/**
 * "Event-sourced and replays deterministically" is the claim the whole debugging story rests on:
 * feed the same log back and get the same world, the same body and the same audit trail. What
 * makes it hold is the clock — replay uses the timestamps in the log so guards see the same gaps
 * they saw live, and that clock only ever moves forward, because a log is in arrival order while
 * its timestamps come from whichever machine sent each event.
 */
const T = (s: number) => `2026-09-04T00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}Z`;

const ev = (id: string, at: number, type = "development.server_error", severity: MatterEvent["severity"] = "critical", sessionId = "s"): MatterEvent => ({
  id,
  sessionId,
  timestamp: T(at),
  source: "development",
  type,
  severity,
  payload: {},
});

const incident = (id: string, at: number, sessionId = "s") => ev(id, at, "development.server_error", "critical", sessionId);
const recovery = (id: string, at: number, sessionId = "s") => ev(id, at, "development.server_recovered", "info", sessionId);

const log = [incident("e1", 0), recovery("e2", 30), incident("e3", 60)];
const state = (r: Awaited<ReturnType<typeof replay>>, session = "s") => ({
  world: r.core.getWorld(session),
  blueprint: r.core.getBlueprint(session),
  audit: r.steps.flatMap((s) => s.audit.map((a) => a.kind)),
});

describe("the same log gives the same everything", () => {
  it("reproduces the world, the body and the audit trail exactly", async () => {
    const first = state(await replay(log));
    const second = state(await replay(log));
    expect(JSON.stringify(second.world)).toBe(JSON.stringify(first.world));
    expect(JSON.stringify(second.blueprint)).toBe(JSON.stringify(first.blueprint));
    expect(second.audit).toEqual(first.audit);
    expect(first.audit.length).toBeGreaterThan(0);
  });

  it("reproduces what a live run arrived at", async () => {
    const live = createRuntimeCore({ iso: () => T(0), ms: () => 0 });
    for (const e of log) await live.ingest(e);
    const replayed = await replay(log, { iso: () => T(0), ms: () => 0 });
    expect(JSON.stringify(replayed.core.getBlueprint("s"))).toBe(JSON.stringify(live.getBlueprint("s")));
    expect(JSON.stringify(replayed.core.getWorld("s"))).toBe(JSON.stringify(live.getWorld("s")));
  });

  it("gives a step for every event, in order", async () => {
    const r = await replay(log);
    expect(r.steps).toHaveLength(3);
    expect(r.steps.map((s) => s.significance.score.toFixed(3))).toEqual((await replay(log)).steps.map((s) => s.significance.score.toFixed(3)));
  });

  it("has nothing to say about an empty log, and creates no session for it", async () => {
    const r = await replay([]);
    expect(r.steps).toEqual([]);
    expect(r.core.listSessions()).toEqual([]);
  });
});

describe("the clock the log is replayed on", () => {
  it("sees the gaps the live run saw, so a morph minutes later is not rate-limited", async () => {
    const r = await replay(log);
    expect(r.steps.filter((s) => s.morph.applied)).toHaveLength(3);
    expect(r.steps.flatMap((s) => s.morph.guardReasonCodes)).not.toContain("cooldown_active");
  });

  it("stamps its records with the instant the event carried, not the instant of the replay", async () => {
    const r = await replay(log);
    const at = r.steps.flatMap((s) => s.audit.map((a) => a.at));
    expect(at.length).toBeGreaterThan(0);
    expect(at.every((t) => t.startsWith("2026-09-04T00:0"))).toBe(true);
    expect(new Set(at).size).toBeGreaterThan(1); // it moved with the log, rather than freezing
  });

  it("uses a clock the caller supplies instead of the log's own", async () => {
    const frozen: RuntimeClock = { iso: () => T(0), ms: () => 0 };
    const r = await replay(log, frozen);
    expect(r.steps.flatMap((s) => s.audit.map((a) => a.at)).every((t) => t === T(0))).toBe(true);
  });

  it("only ever moves forward, so two sensors with different clocks cannot stall a replay", async () => {
    // arrival order is the truth; the timestamps are what each sender claimed
    const outOfOrder = [incident("e1", 30), recovery("e2", 5), incident("e3", 40)];
    const r = await replay(outOfOrder);
    expect(r.steps.filter((s) => s.morph.applied)).toHaveLength(3);
    expect(r.steps.flatMap((s) => s.morph.guardReasonCodes)).not.toContain("cooldown_active");
    expect(r.core.getWorld("s").activeProblems).toHaveLength(1);
  });

  it("ignores a timestamp it cannot read rather than stopping the clock", async () => {
    const broken = [incident("e1", 0), { ...recovery("e2", 30), timestamp: "2026-09-04T00:00:30Z" }, incident("e3", 60)];
    const r = await replay(broken);
    expect(r.steps).toHaveLength(3);
    expect(r.core.getWorld("s").activeProblems).toHaveLength(1);
  });
});

describe("a log with more than one session in it", () => {
  const mixed = [incident("a1", 0, "alpha"), incident("b1", 1, "beta"), recovery("a2", 40, "alpha")];

  it("keeps each session's world to itself", async () => {
    const r = await replay(mixed);
    expect(r.core.getWorld("alpha").activeProblems).toEqual([]);
    expect(r.core.getWorld("beta").activeProblems).toHaveLength(1);
    expect(r.core.listSessions().map((s) => s.sessionId).sort()).toEqual(["alpha", "beta"]);
  });

  it("is as repeatable across sessions as it is within one", async () => {
    const a = await replay(mixed);
    const b = await replay(mixed);
    for (const session of ["alpha", "beta"]) {
      expect(JSON.stringify(b.core.getBlueprint(session)), session).toBe(JSON.stringify(a.core.getBlueprint(session)));
    }
  });
});

describe("what a verify run needs seeded", () => {
  it("takes the preferences the live run had learned, since those are not events", async () => {
    const r = await replay(log, undefined, { memory: { preferences: [{ key: "dismissed:augment:stuck", weight: 5 }] } });
    expect(r.core.exportMemory("s").preferences).toContainEqual({ key: "dismissed:augment:stuck", weight: 5 });
  });

  it("runs without any seed at all", async () => {
    for (const memory of [null, undefined, {}, { preferences: [] }]) {
      const r = await replay(log, undefined, { memory });
      expect(r.steps).toHaveLength(3);
    }
  });

  it("does not seed a session the log never mentions", async () => {
    const r = await replay([], undefined, { memory: { preferences: [{ key: "k", weight: 1 }] } });
    expect(r.core.listSessions()).toEqual([]);
  });
});
