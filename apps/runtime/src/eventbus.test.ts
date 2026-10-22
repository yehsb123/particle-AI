import { describe, it, expect } from "vitest";
import type { Delivery, EventBus, EventHandler } from "@particle/event-bus";
import { InProcessEventBus } from "@particle/event-bus";
import type { MatterEvent } from "@particle/contracts";
import type { IngestResult } from "@particle/runtime-core";
import { buildServer } from "./server";
import { EventDropped } from "./queue";

/**
 * The runtime takes its events out of a channel rather than out of a function call.
 *
 * With the default channel that is the same thing and this file proves it: what arrives over HTTP
 * goes in one end, the loop is on the other, and the answer travels back. With a broker in the
 * middle the second half stops being true — the loop may be running in another process — and the
 * answer is the one thing a channel cannot invent. So the server says where the event went and
 * answers 202, instead of returning an empty world state that reads like a result.
 */
const event = (id: string, sessionId = "bus1") => ({
  id,
  sessionId,
  timestamp: "2026-10-22T00:00:00.000Z",
  source: "development" as const,
  type: "development.server_error",
  severity: "critical" as const,
  payload: {},
});

/** Remembers what was published, and still runs the loop. */
class WatchedBus implements EventBus<IngestResult> {
  readonly via = "inproc" as const;
  readonly published: MatterEvent[] = [];
  private readonly inner = new InProcessEventBus<IngestResult>();
  publish(e: MatterEvent): Promise<Delivery<IngestResult>> {
    this.published.push(e);
    return this.inner.publish(e);
  }
  subscribe(handler: EventHandler<IngestResult>): Promise<void> {
    return this.inner.subscribe(handler);
  }
  close(): Promise<void> {
    return this.inner.close();
  }
}

/** A channel that hands the event to somebody else: nothing to answer with, and it says so. */
class HandedOverBus implements EventBus<IngestResult> {
  readonly via = "kafka" as const;
  readonly published: MatterEvent[] = [];
  private handler?: EventHandler<IngestResult>;
  async publish(e: MatterEvent): Promise<Delivery<IngestResult>> {
    this.published.push(e);
    return { handled: false, via: "kafka", topic: "dm.events", key: e.sessionId };
  }
  async subscribe(handler: EventHandler<IngestResult>): Promise<void> {
    this.handler = handler;
  }
  /** What a consumer does when the broker hands the message back to this process. */
  async consume(e: MatterEvent): Promise<void> {
    await this.handler!(e);
  }
  async close(): Promise<void> {
    this.handler = undefined;
  }
}

/** A channel whose far end let the event go. */
class DroppingBus implements EventBus<IngestResult> {
  readonly via = "inproc" as const;
  async publish(e: MatterEvent): Promise<Delivery<IngestResult>> {
    throw new EventDropped(e.sessionId, e.id);
  }
  async subscribe(): Promise<void> {}
  async close(): Promise<void> {}
}

describe("what arrives over HTTP goes through the channel", () => {
  it("publishes the parsed event and answers with what the loop said", async () => {
    const bus = new WatchedBus();
    const { app } = await buildServer({ bus });
    try {
      const res = await app.inject({ method: "POST", url: "/api/events", payload: event("e1") });
      expect(res.statusCode).toBe(200);
      expect(bus.published.map((e) => e.id)).toEqual(["e1"]);
      expect(res.json().worldState.activeProblems[0].kind).toBe("runtime_error");
    } finally {
      await app.close();
    }
  });

  it("publishes a simulated event too, rather than reaching past the channel", async () => {
    const bus = new WatchedBus();
    const { app } = await buildServer({ bus });
    try {
      const res = await app.inject({ method: "POST", url: "/api/sim/bus2/http-500" });
      expect(res.statusCode).toBe(200);
      expect(bus.published).toHaveLength(1);
      expect(bus.published[0]!.sessionId).toBe("bus2");
    } finally {
      await app.close();
    }
  });
});

/**
 * The other end of the channel is the loop. An event that reaches the runtime from a broker
 * rather than from a socket is run exactly the same way — in its session's lane, in order.
 */
describe("what comes out of the channel reaches the loop", () => {
  it("runs an event handed over by a consumer, and the session can be read back", async () => {
    const bus = new HandedOverBus();
    const { app } = await buildServer({ bus });
    try {
      await bus.consume({ ...event("from-broker", "bus3"), payload: {} });
      const state = (await app.inject({ method: "GET", url: "/api/sessions/bus3/state" })).json();
      expect(state.activeProblems.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});

/**
 * With a broker in the middle the result belongs to whichever runtime consumed the message. The
 * answer says that: 202, where it went, and nothing that reads like a world state. Returning 200
 * with an empty one would make the body draw a session in which nothing is wrong.
 */
describe("a synchronous request while the channel runs through a broker", () => {
  it("says it was handed over, and does not pretend to have run the loop", async () => {
    const bus = new HandedOverBus();
    const { app } = await buildServer({ bus });
    try {
      const res = await app.inject({ method: "POST", url: "/api/events", payload: event("e1", "bus4") });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ accepted: true, eventId: "e1", deliveredTo: "kafka", topic: "dm.events" });
      expect(bus.published.map((e) => e.id)).toEqual(["e1"]);
    } finally {
      await app.close();
    }
  });

  it("answers a simulated event the same way", async () => {
    const bus = new HandedOverBus();
    const { app } = await buildServer({ bus });
    try {
      const res = await app.inject({ method: "POST", url: "/api/sim/bus5/http-500" });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({ accepted: true, deliveredTo: "kafka", topic: "dm.events" });
      expect(res.json().worldState).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it("still refuses a malformed event itself, before anything is published", async () => {
    const bus = new HandedOverBus();
    const { app } = await buildServer({ bus });
    try {
      const res = await app.inject({ method: "POST", url: "/api/events", payload: { id: "x" } });
      expect(res.statusCode).toBe(400);
      expect(bus.published).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it("acknowledges a caller that was not waiting, and publishes it", async () => {
    const bus = new HandedOverBus();
    const { app } = await buildServer({ bus });
    try {
      const res = await app.inject({ method: "POST", url: "/api/events?wait=0", payload: event("e2", "bus6") });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toMatchObject({ accepted: true, eventId: "e2", deliveredTo: "kafka" });
      await expect.poll(() => bus.published.map((e) => e.id)).toEqual(["e2"]);
    } finally {
      await app.close();
    }
  });
});

/**
 * A runtime that is behind is not a runtime that broke. The events route has always said so with
 * a 503; the simulation route answered the same loss with a 500 that blames the server, because
 * it never looked at what the failure was.
 */
describe("an event the loop let go", () => {
  it("is a 503 on the simulation route, the same as on the events route", async () => {
    const { app } = await buildServer({ bus: new DroppingBus() });
    try {
      const sim = await app.inject({ method: "POST", url: "/api/sim/bus7/http-500" });
      expect(sim.statusCode).toBe(503);
      expect(sim.json()).toEqual({ error: "the session queue is full" });

      const direct = await app.inject({ method: "POST", url: "/api/events", payload: event("e1", "bus7") });
      expect(direct.statusCode).toBe(503);
      expect(direct.json()).toEqual({ error: "the session queue is full" });
    } finally {
      await app.close();
    }
  });
});
