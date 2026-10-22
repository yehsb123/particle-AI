import { describe, it, expect } from "vitest";
import type { MatterEvent } from "@particle/contracts";
import { InProcessEventBus } from "./inproc";

/**
 * The channel an event travels down from a sensor to the loop, with nothing in between.
 *
 * This is the default and it is meant to be invisible: handing an event to the bus has to be the
 * same act as calling the loop with it — the same ordering, the same answer, the same failure in
 * the caller's hands. Everything below is that sameness written down, so a second channel cannot
 * be added by loosening what the first one promises.
 */
const event = (id: string, sessionId = "s1"): MatterEvent => ({
  id,
  sessionId,
  timestamp: "2026-10-22T00:00:00.000Z",
  source: "development",
  type: "development.build_failed",
  severity: "warning",
  payload: {},
});

describe("an event handed to the in-process channel", () => {
  it("reaches the subscriber and brings its answer back to whoever published", async () => {
    const bus = new InProcessEventBus<string>();
    const seen: string[] = [];
    await bus.subscribe(async (e) => {
      seen.push(e.id);
      return `ran ${e.id}`;
    });

    const delivery = await bus.publish(event("e1"));

    expect(seen).toEqual(["e1"]);
    expect(delivery).toEqual({ handled: true, via: "inproc", result: "ran e1" });
  });

  /**
   * The loop folds each event into the belief the one before it left behind, so the order the
   * channel hands them over in IS the order they happened in. A channel that reorders is a
   * channel that changes what the runtime believes.
   */
  it("hands them over in the order they were published", async () => {
    const bus = new InProcessEventBus<void>();
    const taken: string[] = [];
    await bus.subscribe(async (e) => {
      taken.push(e.id); // when the loop was HANDED it; finishing order is the session lane's job
      await new Promise<void>((r) => setTimeout(r, e.id === "slow" ? 20 : 0));
    });

    await Promise.all([bus.publish(event("slow")), bus.publish(event("quick"))]);

    expect(taken).toEqual(["slow", "quick"]);
  });

  /**
   * Handed over before `publish` returns, not a tick later.
   *
   * The acknowledgement for a caller that is not waiting carries what that session has lost, and
   * it is read straight after publishing because queueing the event is what may have pushed an
   * older one out. A channel that deferred the handover by a tick would answer every such caller
   * with the count from before its own event arrived.
   */
  it("hands the event over before the publisher's promise exists", async () => {
    const bus = new InProcessEventBus<void>();
    const taken: string[] = [];
    await bus.subscribe(async (e) => {
      taken.push(e.id);
    });

    const pending = bus.publish(event("e1"));
    expect(taken).toEqual(["e1"]);
    await pending;
  });

  /**
   * A dropped event, a storage failure, a bug: whatever the loop refused with has to arrive at
   * the caller unchanged, because the HTTP layer reads the failure to decide between 503 and 500.
   * A channel that swallowed it would answer 200 for work that never ran.
   */
  it("gives the publisher the failure the subscriber refused with, unchanged", async () => {
    const bus = new InProcessEventBus<void>();
    const refusal = Object.assign(new Error("the session queue was full"), { name: "EventDropped" });
    await bus.subscribe(async () => {
      throw refusal;
    });

    await expect(bus.publish(event("e1"))).rejects.toBe(refusal);
  });

  /**
   * Publishing into a channel nobody is listening on is the silent loss this whole part exists to
   * prevent: the caller would be answered as though the loop had run.
   */
  it("refuses to publish when nothing is listening", async () => {
    const bus = new InProcessEventBus<void>();
    await expect(bus.publish(event("e1"))).rejects.toThrow(/nothing is listening/i);
  });

  it("refuses a second subscriber rather than quietly replacing the first", async () => {
    const bus = new InProcessEventBus<void>();
    await bus.subscribe(async () => undefined);
    await expect(bus.subscribe(async () => undefined)).rejects.toThrow(/already/i);
  });
});

describe("closing the channel", () => {
  it("stops delivering, and says so instead of accepting events into nothing", async () => {
    const bus = new InProcessEventBus<void>();
    const seen: string[] = [];
    await bus.subscribe(async (e) => {
      seen.push(e.id);
    });
    await bus.publish(event("before"));

    await bus.close();

    await expect(bus.publish(event("after"))).rejects.toThrow(/closed/i);
    expect(seen).toEqual(["before"]);
  });

  it("can be closed twice without complaining", async () => {
    const bus = new InProcessEventBus<void>();
    await bus.close();
    await bus.close();
  });
});
