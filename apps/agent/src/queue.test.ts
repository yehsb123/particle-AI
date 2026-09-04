import { describe, it, expect } from "vitest";
import { createSendQueue } from "./shape";

/**
 * What the agent sends are transitions — tests started failing, tests pass again — and a
 * transition only means anything in order. Two parallel requests can arrive the wrong way round,
 * so sends go one at a time. The other half is what happens when the runtime is down or slow:
 * sensing is best-effort, and the queue must neither wedge nor grow without limit.
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("one at a time, in the order they happened", () => {
  it("keeps order even when the far end answers out of order", async () => {
    const arrived: string[] = [];
    const queue = createSendQueue(async (p) => {
      await sleep(p === "failure" ? 20 : 1);
      arrived.push(String(p));
    });

    queue.send("failure");
    queue.send("recovery");
    await queue.send("failure again");

    // a recovery overtaking the failure it recovers from would read as a runtime that never broke
    expect(arrived).toEqual(["failure", "recovery", "failure again"]);
  });

  it("resolves each send once the queue has reached it", async () => {
    const seen: unknown[] = [];
    const queue = createSendQueue(async (p) => {
      seen.push(p);
    });
    await queue.send("a");
    expect(seen).toEqual(["a"]);
    await queue.send("b");
    expect(seen).toEqual(["a", "b"]);
  });

  it("counts what is queued or in flight, and settles back to nothing", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const queue = createSendQueue(async () => await gate);

    queue.send("a");
    queue.send("b");
    expect(queue.pending()).toBe(2);
    release();
    await sleep(5);
    expect(queue.pending()).toBe(0);
  });
});

describe("a runtime that is not answering", () => {
  it("carries on after a send fails, and tells whoever asked to be told", async () => {
    const arrived: unknown[] = [];
    const errors: string[] = [];
    const queue = createSendQueue(
      async (p) => {
        if (p === "boom") throw new Error("runtime offline");
        arrived.push(p);
      },
      { onError: (err) => errors.push(String(err)) },
    );

    queue.send("a");
    queue.send("boom");
    await queue.send("b");

    expect(arrived).toEqual(["a", "b"]);
    expect(errors).toEqual(["Error: runtime offline"]);
    expect(queue.pending()).toBe(0);
  });

  it("swallows a failure quietly when nobody asked to be told", async () => {
    const queue = createSendQueue(async () => {
      throw new Error("offline");
    });
    await expect(queue.send("a")).resolves.toBeUndefined();
    expect(queue.pending()).toBe(0);
  });

  it("keeps going when something that is not an Error is thrown", async () => {
    const errors: unknown[] = [];
    const queue = createSendQueue(
      async (p) => {
        if (p === "bad") throw "a bare string";
      },
      { onError: (err) => errors.push(err) },
    );
    queue.send("bad");
    await queue.send("good");
    expect(errors).toEqual(["a bare string"]);
  });
});

describe("a far end that has stopped answering entirely", () => {
  it("stops queueing at the ceiling instead of growing forever", async () => {
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
    // the oldest survived: what is already queued is the beginning of the story
    expect(arrived).toEqual(["a", "b", "c"]);
  });

  it("takes new sends again once the queue drains", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const arrived: unknown[] = [];
    const queue = createSendQueue(
      async (p) => {
        await gate;
        arrived.push(p);
      },
      { maxPending: 2 },
    );
    queue.send("a");
    queue.send("b");
    queue.send("dropped");
    release();
    await sleep(5);

    await queue.send("after");
    expect(arrived).toEqual(["a", "b", "after"]);
    expect(queue.dropped()).toBe(1);
  });

  it("reports honestly how many it let go", async () => {
    const queue = createSendQueue(async () => await sleep(50), { maxPending: 1 });
    queue.send("kept");
    for (let i = 0; i < 10; i += 1) queue.send(`dropped${i}`);
    expect(queue.dropped()).toBe(10);
    expect(queue.pending()).toBe(1);
  });

  it("holds five hundred by default", async () => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const queue = createSendQueue(async () => await gate);
    for (let i = 0; i < 520; i += 1) queue.send(i);
    expect(queue.pending()).toBe(500);
    expect(queue.dropped()).toBe(20);
    release();
    await sleep(5);
  });
});
