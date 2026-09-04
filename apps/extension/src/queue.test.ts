import { describe, it, expect } from "vitest";
import { createSendQueue } from "./shape";

/**
 * The extension observes transitions in traffic — a host started failing, a host came back — and
 * order is what makes them readable. It also runs in a service worker the browser may wake and
 * kill at will, against a runtime that may not be running at all, so the queue has to survive a
 * far end that never answers without holding the whole session in memory.
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("order", () => {
  it("does not let a recovery overtake the failure it recovers from", async () => {
    const arrived: string[] = [];
    const queue = createSendQueue(async (p) => {
      await sleep(p === "failure" ? 20 : 1);
      arrived.push(String(p));
    });
    queue.send("failure");
    await queue.send("recovery");
    expect(arrived).toEqual(["failure", "recovery"]);
  });

  it("waits for whatever the sender needs before the first send", async () => {
    // in the worker this is consent: nothing may leave before it has been read
    let allow = () => {};
    const ready = new Promise<void>((r) => (allow = r));
    const arrived: unknown[] = [];
    const queue = createSendQueue(async (p) => {
      await ready;
      arrived.push(p);
    });
    queue.send("a");
    queue.send("b");
    expect(arrived).toEqual([]);
    allow();
    await sleep(5);
    expect(arrived).toEqual(["a", "b"]);
  });
});

describe("a runtime that is not there", () => {
  it("keeps sensing after a failed send", async () => {
    const arrived: unknown[] = [];
    const queue = createSendQueue(async (p) => {
      if (p === "boom") throw new Error("connection refused");
      arrived.push(p);
    });
    queue.send("a");
    queue.send("boom");
    await queue.send("b");
    expect(arrived).toEqual(["a", "b"]);
    expect(queue.pending()).toBe(0);
  });

  it("stops queueing at the ceiling and says how many it let go", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const arrived: unknown[] = [];
    const queue = createSendQueue(
      async (p) => {
        await gate;
        arrived.push(p);
      },
      { maxPending: 3 },
    );
    for (const p of ["a", "b", "c", "d", "e"]) queue.send(p);
    expect(queue.pending()).toBe(3);
    expect(queue.dropped()).toBe(2);
    release();
    await sleep(5);
    expect(arrived).toEqual(["a", "b", "c"]);
  });

  it("holds five hundred by default", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const queue = createSendQueue(async () => await gate);
    for (let i = 0; i < 505; i += 1) queue.send(i);
    expect(queue.pending()).toBe(500);
    expect(queue.dropped()).toBe(5);
    release();
    await sleep(5);
  });
});
