import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { Persistence } from "@particle/persistence";
import type { MatterEvent } from "@particle/contracts";
import { buildServer } from "./server";

/**
 * The events listing used to be read off the in-memory mirror, which is as old as the process.
 * Restart the runtime and a session whose every event was still in the database answered with an
 * empty list — the trail a person opens to find out what happened was gone, while the rows it
 * describes sat there. The durable log is what the session is; the mirror is a copy of this run.
 */
let app: FastifyInstance;
let persistence: Persistence;

beforeEach(async () => {
  ({ app, persistence } = await buildServer());
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

const ev = (id: string, sessionId: string, over: Partial<MatterEvent> = {}): MatterEvent => ({
  id,
  sessionId,
  timestamp: "2026-10-16T00:00:00.000Z",
  source: "development",
  type: "development.server_error",
  severity: "critical",
  payload: {},
  ...over,
});

// CI runs these against a real Postgres, where rows outlive the test that wrote them and every
// spec shares one database: a session name has to be this run's alone.
const session = (name: string) => `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

const listed = async (session: string) => {
  const r = await app.inject({ method: "GET", url: `/api/sessions/${session}/events` });
  expect(r.statusCode).toBe(200);
  return (r.json().events as MatterEvent[]).map((e) => e.id);
};

describe("the events a session is shown", () => {
  it("includes what an earlier run of the runtime stored", async () => {
    // written by the process before this one: in the durable log, never in this run's mirror
    const restarted = session("restarted");
    await persistence.events.append(ev(`${restarted}-e1`, restarted));
    expect(await listed(restarted)).toEqual([`${restarted}-e1`]);
  });

  it("shows an event ingested in this run exactly once", async () => {
    const live = session("live");
    await app.inject({ method: "POST", url: "/api/events", payload: ev(`${live}-e1`, live) });
    expect(await listed(live)).toEqual([`${live}-e1`]);
  });

  it("stays each session's own", async () => {
    const mine = session("mine");
    const theirs = session("theirs");
    await persistence.events.append(ev(`${mine}-e1`, mine));
    await persistence.events.append(ev(`${theirs}-e1`, theirs));
    expect(await listed(mine)).toEqual([`${mine}-e1`]);
    expect(await listed(session("nobody"))).toEqual([]);
  });
});
