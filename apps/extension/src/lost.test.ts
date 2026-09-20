import { describe, it, expect } from "vitest";
import { createSendQueue } from "./shape";

/**
 * What this sensor does when an event does not arrive.
 *
 * The queue is best-effort and does not retry — the far end being down is not its problem — but
 * "best-effort" was doing more work than it looked. Three things were true at once:
 *
 *   a send that failed was counted nowhere: dropped() read zero while events were gone
 *   the extension passed no onError, so nothing anywhere said an event had been lost
 *   an onError that threw rejected the chain, so no later send ever ran again
 *
 * The fetch behind this carries a five second timeout, so a runtime answering slowly is enough to
 * lose an event — and that is exactly what a flaky end-to-end run looked like from the outside: an
 * event that simply never came, with nothing in any log to say why. Measured before the fix: two
 * failed sends, dropped() zero. After: two.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("what the queue does with an event it could not deliver", () => {
  it("counts it, because an event that did not arrive is gone either way", async () => {
    const queue = createSendQueue(async () => {
      throw new Error("TimeoutError: signal timed out");
    });
    await queue.send({ id: "e1" });
    await queue.send({ id: "e2" });
    expect(queue.dropped()).toBe(2);
    expect(queue.pending()).toBe(0);
  });

  it("counts nothing when everything arrives", async () => {
    const arrived: unknown[] = [];
    const queue = createSendQueue(async (p) => {
      arrived.push(p);
    });
    await queue.send({ id: "ok" });
    expect(arrived).toHaveLength(1);
    expect(queue.dropped()).toBe(0);
  });

  it("still counts the ones it refused at the ceiling", async () => {
    // the original meaning of this number, unchanged: the rationale was "says how many it let go"
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const queue = createSendQueue(async () => await gate, { maxPending: 3 });
    for (let i = 0; i < 10; i += 1) void queue.send(i);
    expect(queue.pending()).toBe(3);
    expect(queue.dropped()).toBe(7);
    release();
    await sleep(5);
  });

  it("tells whoever is listening, with the reason", async () => {
    const seen: string[] = [];
    const queue = createSendQueue(
      async () => {
        throw new Error("TimeoutError: signal timed out");
      },
      { onError: (err) => seen.push(String(err)) },
    );
    await queue.send({ id: "e" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("TimeoutError");
  });

  it("keeps sending after a handler that throws", async () => {
    // nothing called from a failure path may end the queue: a rejected link meant no later send
    // ever ran, and every event after the first failure was lost, with an unhandled rejection as
    // the only sign it had happened
    const arrived: unknown[] = [];
    let failNext = true;
    const queue = createSendQueue(
      async (p) => {
        if (failNext) {
          failNext = false;
          throw new Error("the first one fails");
        }
        arrived.push(p);
      },
      {
        onError: () => {
          throw new Error("a handler that itself throws");
        },
      },
    );
    for (const p of ["a", "b", "c"]) void queue.send(p);
    await sleep(30);
    expect(arrived).toEqual(["b", "c"]);
    expect(queue.dropped()).toBe(1);
  });

  it("keeps sending after the far end has been down and come back", async () => {
    const arrived: unknown[] = [];
    let down = true;
    const queue = createSendQueue(async (p) => {
      if (down) throw new Error("Failed to fetch");
      arrived.push(p);
    });
    await queue.send("while down");
    down = false;
    await queue.send("after it came back");
    expect(arrived).toEqual(["after it came back"]);
    expect(queue.dropped()).toBe(1);
  });
});
