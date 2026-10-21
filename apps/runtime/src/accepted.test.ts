import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import type { MatterEvent } from "@particle/contracts";
import type { EventLogStore } from "@particle/persistence";
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

  /**
   * The acknowledgement carries how many of this session's events the runtime has let go, because
   * that is the only thing travelling back to a sender that no longer waits for anything. Without
   * it a sensor whose observations were being thrown away saw a 202 every time, and the only
   * record of the loss was in a log nobody running a daemon is reading.
   */
  it("acknowledges and lets go when the caller is not waiting, and says what it has lost", async () => {
    const res = await app.inject({ method: "POST", url: "/api/events?wait=0", payload: event("async-1") });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ accepted: true, eventId: "async-1", dropped: 0 });
  });

  it("counts this session's losses in the acknowledgement, not the whole runtime's", async () => {
    process.env.DM_EVENT_QUEUE_MAX = "1";
    const built = await buildServer();
    try {
      await built.app.ready();
      const lost = [1, 2, 3, 4].map((n) =>
        built.runtime.submit(built.runtime.parse(event(`lost-${n}`, "qa4"))).catch(() => undefined),
      );
      await Promise.all(lost);
      const mine = await built.app.inject({ method: "POST", url: "/api/events?wait=0", payload: event("mine", "qa4") });
      expect(mine.json()).toEqual({ accepted: true, eventId: "mine", dropped: 2 });
      const other = await built.app.inject({ method: "POST", url: "/api/events?wait=0", payload: event("other", "qa5") });
      expect(other.json()).toEqual({ accepted: true, eventId: "other", dropped: 0 });
    } finally {
      delete process.env.DM_EVENT_QUEUE_MAX;
      await built.app.close();
    }
  });

  /** An acknowledgement is not a promise that it was ignored: the loop runs it, just not now. */
  it("runs what it acknowledged", async () => {
    await app.inject({ method: "POST", url: "/api/events?wait=0", payload: event("async-2", "qa2") });
    await expect
      .poll(async () => (await app.inject({ method: "GET", url: "/api/sessions/qa2/state" })).json().activeProblems.length)
      .toBeGreaterThan(0);
  });

  /** Not waiting for the answer is not the same as never hearing that the event was malformed. */
  it("still refuses a malformed event to its face", async () => {
    const res = await app.inject({ method: "POST", url: "/api/events?wait=0", payload: { id: "x" } });
    expect(res.statusCode).toBe(400);
  });
});

/**
 * Three acknowledged events are three events the runtime is now holding, and nothing about HTTP
 * keeps them apart once it has answered 202 to all three. What keeps them in order is the lane.
 *
 * An earlier version of this test posted them one at a time and read the log back, which proved
 * nothing: the requests were already serial, and the first thing the loop does with an event is
 * append it synchronously, so the order came out right with the lane taken out entirely. This one
 * holds the first event inside the loop, hands over the second and third while it is still in
 * there, and watches where they come out.
 */
describe("events that arrive while the loop is still busy", () => {
  class SlowFirstLog implements EventLogStore {
    readonly finished: string[] = [];
    private events: MatterEvent[] = [];
    constructor(private readonly slowFor: string, private readonly delayMs: number) {}
    async append(event: MatterEvent): Promise<void> {
      if (event.id === this.slowFor) await new Promise<void>((r) => setTimeout(r, this.delayMs));
      this.events.push(event);
      this.finished.push(event.id);
    }
    async listBySession(sessionId: string): Promise<MatterEvent[]> {
      return this.events.filter((e) => e.sessionId === sessionId);
    }
    async all(): Promise<MatterEvent[]> {
      return [...this.events];
    }
  }

  it("runs them in the order they arrived, not in the order they happen to finish", async () => {
    const log = new SlowFirstLog("ord-1", 30);
    const runtime = new SessionRuntime(() => new Date().toISOString(), log);
    // all three handed over in one turn, the way three 202s leave the server
    const all = ["ord-1", "ord-2", "ord-3"].map((id) => runtime.submit(runtime.parse(event(id, "qa3"))));
    await Promise.all(all);
    expect(log.finished).toEqual(["ord-1", "ord-2", "ord-3"]);
  });

  it("keeps one session's slow event from holding up another session", async () => {
    const log = new SlowFirstLog("slow-1", 30);
    const runtime = new SessionRuntime(() => new Date().toISOString(), log);
    const slow = runtime.submit(runtime.parse(event("slow-1", "qa6")));
    await runtime.submit(runtime.parse(event("quick-1", "qa7")));
    expect(log.finished).toEqual(["quick-1"]);
    await slow;
    expect(log.finished).toEqual(["quick-1", "slow-1"]);
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
    // which observation went, not only how many: a count alone cannot be matched to anything
    expect(dropped.map((a) => a.detail.eventId)).toEqual(["drop-2", "drop-3"]);
    expect(dropped[0]!.detail.queueMax).toBe(1);
  });

  it("tells the caller that was waiting, rather than answering as though it had run", async () => {
    const runtime = new SessionRuntime(() => "2026-10-21T00:00:00.000Z", undefined, undefined, 1);
    const running = runtime.submit(runtime.parse(ev(1)));
    const letGo = runtime.submit(runtime.parse(ev(2)));
    const kept = runtime.submit(runtime.parse(ev(3)));
    await expect(letGo).rejects.toMatchObject({ name: "EventDropped", sessionId: "qd1", eventId: "drop-2" });
    await Promise.all([running, kept]);
  });

  /**
   * 500 says the server broke; a dropped event means it is behind. A sensor reading 500 has no
   * reason to ease off, which is the one thing that would help.
   */
  it("answers a caller whose event was let go with 503, not with a 500 that blames the server", () => {
    expect(ingestFailure(new EventDropped("qd1", "drop-2"))).toEqual({
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
