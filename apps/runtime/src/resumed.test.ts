import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { MAX_SENSORS, RECENT_EVENTS_LIMIT } from "@particle/contracts";
import { buildServer } from "./server";
import type { SessionRuntime } from "./runtime";
import type { Persistence } from "@particle/persistence";

/**
 * A resume reads a belief straight off the snapshot store — written by whichever build was running
 * then — and never passes it through the reducer that folds live events. The reducer had been
 * hardened and the schema left saying none of it, so a resume restored exactly what the reducer
 * exists to prevent, and the world-state broadcast every watching body receives went from about a
 * kilobyte to four megabytes and stayed there, since that belief is snapshotted again and put in
 * every prompt.
 *
 * The schema holds the ceilings now. This is the same check through the real resume, because what
 * matters is the belief the runtime actually goes on using.
 */
let app: FastifyInstance;
let runtime: SessionRuntime;
let persistence: Persistence;
beforeEach(async () => {
  ({ app, runtime, persistence } = await buildServer());
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);
const AT = "2026-09-07T00:00:00.000Z";
const SESSION = "resumed";

const oversizedWorld = () => {
  const sensing: Record<string, string[]> = {};
  for (let i = 0; i < 500; i++) sensing["sensor-" + i] = ["layer-" + "L".repeat(5_000)];
  sensing["watching" + ESC + "[31m"] = ["network" + NUL, "everything you type"];
  return {
    sessionId: SESSION,
    updatedAt: AT,
    activeContext: {},
    environment: { applications: Array.from({ length: 5_000 }, (_, i) => "app-" + i), files: [], processes: [] },
    activeProblems: [],
    recentEvents: Array.from({ length: 10_000 }, (_, i) => ({
      id: "e" + i, sessionId: SESSION, timestamp: AT, source: "user", type: "user.interaction", severity: "info", payload: { kind: "click" },
    })),
    behavior: { interactionsPerMinute: 0, idleSeconds: 0, awaySeconds: 0, recentHosts: [], failingHosts: [] },
    sensing,
    attention: { typing: false },
    autonomy: { level: 2 },
  };
};

describe("what a resume is allowed to bring back", () => {
  it("brings the session back rather than refusing it", async () => {
    await persistence.snapshots.save({ sessionId: SESSION, kind: "world", at: AT, data: oversizedWorld() });
    // a resume is meant to bring back everything it can understand, not nothing
    expect(await runtime.resume(SESSION)).toBeTruthy();
  });

  it("brings back a belief the reducer could have produced", async () => {
    await persistence.snapshots.save({ sessionId: SESSION, kind: "world", at: AT, data: oversizedWorld() });
    await runtime.resume(SESSION);
    const world = runtime.peekWorld(SESSION);
    expect(Object.keys(world.sensing).length).toBe(MAX_SENSORS);
    expect(world.recentEvents.length).toBe(RECENT_EVENTS_LIMIT);
    expect(world.environment.applications?.length).toBe(200);
  });

  it("says nothing on the sensing line that a sensor could not have said", async () => {
    await persistence.snapshots.save({ sessionId: SESSION, kind: "world", at: AT, data: oversizedWorld() });
    await runtime.resume(SESSION);
    const sensing = runtime.peekWorld(SESSION).sensing;
    const words = [...Object.keys(sensing), ...Object.values(sensing).flat()];
    for (const word of words) {
      expect(word.includes(ESC), word).toBe(false);
      expect(word.includes(NUL), word).toBe(false);
      expect(word.length).toBeLessThan(130);
    }
  });

  it("does not make every broadcast after it carry the snapshot's weight", async () => {
    const world = oversizedWorld();
    expect(JSON.stringify(world).length).toBeGreaterThan(3_000_000);
    await persistence.snapshots.save({ sessionId: SESSION, kind: "world", at: AT, data: world });
    await runtime.resume(SESSION);
    const broadcast = JSON.stringify({ kind: "world_state_changed", sessionId: SESSION, worldState: runtime.peekWorld(SESSION) });
    expect(broadcast.length).toBeLessThan(60_000);
  });

  it("leaves an ordinary snapshot as it was", async () => {
    await persistence.snapshots.save({
      sessionId: "ordinary", kind: "world", at: AT,
      data: { ...oversizedWorld(), sessionId: "ordinary", sensing: { web: ["interactions", "idle"], ext: ["tabs"] }, recentEvents: [], environment: { applications: ["code"] } },
    });
    await runtime.resume("ordinary");
    const world = runtime.peekWorld("ordinary");
    expect(world.sensing).toEqual({ web: ["interactions", "idle"], ext: ["tabs"] });
    expect(world.environment.applications).toEqual(["code"]);
  });
});
