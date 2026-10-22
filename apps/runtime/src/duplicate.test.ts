import { describe, it, expect } from "vitest";
import type { Delivery, EventBus, EventHandler } from "@particle/event-bus";
import type { MatterEvent } from "@particle/contracts";
import type { IngestResult } from "@particle/runtime-core";
import { buildServer } from "./server";
import { SessionRuntime } from "./runtime";
import { SeenEvents } from "./seen";

/**
 * A broker delivers at least once.
 *
 * Nothing inside one process ever handed the loop the same event twice, so until there was a
 * topic in the middle this could not happen. Now it can: a consumer that restarts, or a group
 * that rebalances, is handed messages it has already run. Folded a second time, one observation
 * is counted twice — the belief says a person clicked twice as often as they did, a repetition
 * crosses a threshold a step early, and the trail shows one event under two rows.
 */
const interaction = (id: string, sessionId: string, count: number): MatterEvent => ({
  id,
  sessionId,
  timestamp: "2026-10-22T00:00:00.000Z",
  source: "user",
  type: "user.interaction",
  severity: "debug",
  payload: { count },
});

/** A channel that hands the event to a broker, and can hand it back as often as a broker would. */
class RedeliveringBus implements EventBus<IngestResult | undefined> {
  readonly via = "kafka" as const;
  private handler?: EventHandler<IngestResult | undefined>;
  async publish(e: MatterEvent): Promise<Delivery<IngestResult | undefined>> {
    return { handled: false, via: "kafka", topic: "dm.events", key: e.sessionId };
  }
  async subscribe(handler: EventHandler<IngestResult | undefined>): Promise<void> {
    this.handler = handler;
  }
  /** What the consumer does when the broker hands this process a message. */
  async consume(e: MatterEvent): Promise<void> {
    await this.handler!(e);
  }
  async close(): Promise<void> {
    this.handler = undefined;
  }
}

describe("the same event arriving twice", () => {
  it("is folded into the belief once, however often the broker hands it over", async () => {
    const bus = new RedeliveringBus();
    const { app, runtime } = await buildServer({ bus });
    try {
      const event = interaction("dup-1", "dup-session", 5);
      await bus.consume(event);
      await bus.consume(event);

      const world = runtime.peekWorld("dup-session");
      expect(world.behavior.interactions).toBe(5);
      expect(world.recentEvents.filter((e) => e.id === "dup-1")).toHaveLength(1);
      expect(runtime.store.listBySession("dup-session")).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("says in that session's trail that it let a second copy go", async () => {
    const bus = new RedeliveringBus();
    const { app, runtime } = await buildServer({ bus });
    try {
      const event = interaction("dup-2", "trail-session", 1);
      await bus.consume(event);
      await bus.consume(event);

      const records = runtime.audit.list("trail-session").filter((r) => r.kind === "event_duplicate");
      expect(records).toHaveLength(1);
      expect(records[0]!.detail).toMatchObject({ eventId: "dup-2" });
    } finally {
      await app.close();
    }
  });
});

describe("what it remembers having folded", () => {
  it("forgets the oldest id in a session once it is full, rather than growing without end", () => {
    const seen = new SeenEvents(3, 10);
    for (const id of ["a", "b", "c", "d"]) expect(seen.firstTime("s", id)).toBe(true);

    expect(seen.rememberedFor("s")).toBe(3);
    // "a" fell out of the memory, so a copy of it is folded again: the bound is the trade.
    expect(seen.firstTime("s", "a")).toBe(true);
    expect(seen.firstTime("s", "d")).toBe(false);
  });

  it("forgets the session that has gone longest without an event, and only that one", () => {
    const seen = new SeenEvents(10, 2);
    seen.firstTime("old", "e1");
    seen.firstTime("mid", "e1");
    seen.firstTime("old", "e2"); // "old" is the most recent again
    seen.firstTime("new", "e1"); // over the ceiling: "mid" is the one that goes

    // Read without asking: asking IS remembering, and would itself evict a session here.
    expect(seen.remembered()).toBe(2);
    expect(seen.rememberedFor("mid")).toBe(0);
    expect(seen.rememberedFor("old")).toBe(2);
    expect(seen.rememberedFor("new")).toBe(1);
  });

  /**
   * A session name and an event id both arrive from outside. Neither is ever a key on an object,
   * so a name that means something to the language means nothing here.
   */
  it("takes a session or an event named after a language feature as an ordinary name", () => {
    const seen = new SeenEvents();
    expect(seen.firstTime("__proto__", "constructor")).toBe(true);
    expect(seen.firstTime("__proto__", "constructor")).toBe(false);
    expect(seen.firstTime("toString", "constructor")).toBe(true);
    expect(seen.remembered()).toBe(2);
  });
});

/**
 * The lane lets the OLDEST waiting event go when a session is sending faster than the loop runs.
 * That event was never folded into anything, so the copy a broker hands back is not a duplicate —
 * it is the only copy left, and refusing it would turn a drop into a permanent loss.
 */
describe("an event the lane let go", () => {
  it("is folded when the broker hands it over again", async () => {
    const runtime = new SessionRuntime(() => "2026-10-22T00:00:00.000Z", undefined, undefined, 1);
    const ev = (n: number) => runtime.parse(interaction(`q-${n}`, "lane", 1));

    const settled = [1, 2, 3].map((n) => runtime.fold(ev(n)).catch(() => undefined));
    await Promise.all(settled);
    expect(runtime.store.listBySession("lane").map((e) => e.id)).toEqual(["q-1", "q-3"]);

    await runtime.fold(ev(2));
    expect(runtime.store.listBySession("lane").map((e) => e.id)).toEqual(["q-1", "q-3", "q-2"]);
    expect(runtime.audit.list("lane").filter((a) => a.kind === "event_duplicate")).toHaveLength(0);
  });
});

describe("a duplicate over the HTTP door", () => {
  it("is answered as already folded rather than as a second loop that changed nothing", async () => {
    const { app } = await buildServer();
    try {
      const body = interaction("http-dup", "http-session", 2);
      const first = await app.inject({ method: "POST", url: "/api/events", payload: body });
      const second = await app.inject({ method: "POST", url: "/api/events", payload: body });

      expect(first.statusCode).toBe(200);
      expect(first.json().worldState.behavior.interactions).toBe(2);
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual({ accepted: true, eventId: "http-dup", duplicate: true });

      const state = (await app.inject({ method: "GET", url: "/api/sessions/http-session/state" })).json();
      expect(state.behavior.interactions).toBe(2);
    } finally {
      await app.close();
    }
  });
});
