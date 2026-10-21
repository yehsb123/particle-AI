import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, ingestFailure, wantsAsync } from "./server";
import { EventDropped } from "./queue";
import { SessionRuntime } from "./runtime";

/**
 * A sensor is not a client waiting for an answer. The extension and the desktop agent send what
 * they just observed and have nothing to do with what comes back, yet they were holding the
 * connection open through the whole loop — world, significance, intent, a model call, permissions,
 * capabilities, the morph. A slow model meant a sensor that stopped sensing.
 *
 * So a caller may say it is not waiting (`?wait=0`) and get an acknowledgement, while the event
 * itself is run in its session's order behind the ones before it. Saying nothing still means
 * waiting: the body's simulation lab reads the answer, and so does every test written before this.
 */
const event = (id: string, sessionId = "qa1") => ({
  id,
  sessionId,
  timestamp: "2026-10-21T00:00:00Z",
  source: "development" as const,
  type: "development.server_error",
  severity: "critical" as const,
  payload: {},
});

let app: FastifyInstance;

beforeEach(async () => {
  ({ app } = await buildServer());
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

describe("whether the caller is waiting", () => {
  it("waits unless it was told not to", () => {
    expect(wantsAsync({})).toBe(false);
    expect(wantsAsync({ wait: "1" })).toBe(false);
    expect(wantsAsync(undefined)).toBe(false);
  });

  it("does not wait when the caller said so", () => {
    expect(wantsAsync({ wait: "0" })).toBe(true);
  });

  it("refuses a spelling nobody defined rather than guessing which one was meant", () => {
    // "wait=false" reads like "do not wait" and would have been answered by waiting
    for (const bad of [{ wait: "false" }, { wait: "no" }, { wait: "" }, { wait: ["0", "1"] }]) {
      expect(() => wantsAsync(bad), JSON.stringify(bad)).toThrow();
    }
  });
});

describe("POST /api/events", () => {
  it("still answers with the whole loop's result when nobody said otherwise", async () => {
    const res = await app.inject({ method: "POST", url: "/api/events", payload: event("sync-1") });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.event.id).toBe("sync-1");
    expect(body.worldState.activeProblems[0].kind).toBe("runtime_error");
    expect(body.morph.applied).toBe(true);
  });

  it("acknowledges and lets go when the caller is not waiting", async () => {
    const res = await app.inject({ method: "POST", url: "/api/events?wait=0", payload: event("async-1") });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true, eventId: "async-1" });
  });

  /** An acknowledgement is not a promise that it was ignored: the loop runs it, just not now. */
  it("runs what it acknowledged", async () => {
    await app.inject({ method: "POST", url: "/api/events?wait=0", payload: event("async-2", "qa2") });
    await expect
      .poll(async () => (await app.inject({ method: "GET", url: "/api/sessions/qa2/state" })).json().activeProblems.length)
      .toBeGreaterThan(0);
  });

  it("runs a session's events in the order they arrived, however fast it answered", async () => {
    for (const id of ["ord-1", "ord-2", "ord-3"]) {
      const res = await app.inject({ method: "POST", url: "/api/events?wait=0", payload: event(id, "qa3") });
      expect(res.statusCode).toBe(202);
    }
    await expect
      .poll(async () => {
        const { events } = (await app.inject({ method: "GET", url: "/api/sessions/qa3/events" })).json();
        return (events as { id: string }[]).map((e) => e.id);
      })
      .toEqual(["ord-1", "ord-2", "ord-3"]);
  });

  /** Not waiting for the answer is not the same as never hearing that the event was malformed. */
  it("still refuses a malformed event to its face", async () => {
    const res = await app.inject({ method: "POST", url: "/api/events?wait=0", payload: { id: "x" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("a session that is sending faster than the loop can run", () => {
  const ev = (n: number) => event(`drop-${n}`, "qd1");

  it("lets the oldest waiting event go, keeps the newest, and writes down that it did", async () => {
    const runtime = new SessionRuntime(() => "2026-10-21T00:00:00.000Z", undefined, undefined, 1);
    const settled = [1, 2, 3, 4].map((n) => runtime.submit(runtime.parse(ev(n))).catch(() => undefined));
    await Promise.all(settled);

    // one ran straight away, one was still waiting at the end; the two in between were let go
    expect(runtime.store.listBySession("qd1").map((e) => e.id)).toEqual(["drop-1", "drop-4"]);

    const dropped = runtime.audit.list("qd1").filter((a) => a.kind === "events_dropped");
    expect(dropped).toHaveLength(2);
    expect(dropped.map((a) => a.sessionId)).toEqual(["qd1", "qd1"]);
    expect(dropped.map((a) => a.detail.dropped)).toEqual([1, 2]);
    expect(dropped[0]!.detail.queueMax).toBe(1);
  });

  it("tells the caller that was waiting, rather than answering as though it had run", async () => {
    const runtime = new SessionRuntime(() => "2026-10-21T00:00:00.000Z", undefined, undefined, 1);
    const running = runtime.submit(runtime.parse(ev(1)));
    const letGo = runtime.submit(runtime.parse(ev(2)));
    const kept = runtime.submit(runtime.parse(ev(3)));
    await expect(letGo).rejects.toMatchObject({ name: "EventDropped", sessionId: "qd1" });
    await Promise.all([running, kept]);
  });

  /**
   * 500 says the server broke; a dropped event means it is behind. A sensor reading 500 has no
   * reason to ease off, which is the one thing that would help.
   */
  it("answers a caller whose event was let go with 503, not with a 500 that blames the server", () => {
    expect(ingestFailure(new EventDropped("qd1"))).toEqual({
      code: 503,
      body: { error: "the session queue is full" },
    });
  });

  it("says on /health how many it has let go", async () => {
    process.env.DM_EVENT_QUEUE_MAX = "1";
    const built = await buildServer();
    try {
      await built.app.ready();
      const settled = [1, 2, 3, 4].map((n) => built.runtime.submit(built.runtime.parse(ev(n))).catch(() => undefined));
      await Promise.all(settled);
      const health = (await built.app.inject({ method: "GET", url: "/health" })).json();
      expect(health.ok).toBe(true);
      expect(health.queue).toEqual({ waiting: 0, dropped: 2, queueMax: 1 });
    } finally {
      delete process.env.DM_EVENT_QUEUE_MAX;
      await built.app.close();
    }
  });
});
