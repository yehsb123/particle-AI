import { describe, it, expect } from "vitest";
import { DEFAULT_EVENT_QUEUE_MAX, EventDropped, SessionQueues, eventQueueMax } from "./queue";

/**
 * A session's events only mean anything in the order they happened — a recovery after a failure,
 * a file saved after the branch it was saved on. So one session runs one event at a time, and a
 * second session never waits behind the first.
 *
 * The other half is what happens when the loop falls behind: a queue with no ceiling is a process
 * that runs out of memory instead of saying it is overwhelmed, and a ceiling that drops quietly
 * is worse than either. At the ceiling the OLDEST goes, because a body reshapes itself around
 * where somebody is now, and whoever queued it is told so rather than left holding a promise.
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => {};
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

describe("one session at a time, in the order it was received", () => {
  it("runs a session's events one after another even when the first is slow", async () => {
    const queues = new SessionQueues(10);
    const ran: string[] = [];
    const first = queues.run("s1", async () => {
      await sleep(20);
      ran.push("first");
    });
    const second = queues.run("s1", async () => {
      ran.push("second");
    });
    const third = queues.run("s1", async () => {
      ran.push("third");
    });
    await Promise.all([first, second, third]);
    expect(ran).toEqual(["first", "second", "third"]);
  });

  it("never starts the next one while one is still running", async () => {
    const queues = new SessionQueues(10);
    const held = gate();
    let running = 0;
    let most = 0;
    const task = async () => {
      running += 1;
      most = Math.max(most, running);
      await held.wait;
      running -= 1;
    };
    const all = [queues.run("s1", task), queues.run("s1", task), queues.run("s1", task)];
    held.open();
    await Promise.all(all);
    expect(most).toBe(1);
  });

  it("lets a second session work while the first is stuck", async () => {
    const queues = new SessionQueues(10);
    const stuck = gate();
    const slow = queues.run("s1", () => stuck.wait);
    await expect(queues.run("s2", async () => "done")).resolves.toBe("done");
    stuck.open();
    await slow;
  });

  it("hands each caller back what its own task answered", async () => {
    const queues = new SessionQueues(10);
    await expect(queues.run("s1", async () => ({ ok: 1 }))).resolves.toEqual({ ok: 1 });
  });

  it("fails only the caller whose task threw, and carries on with the rest", async () => {
    const queues = new SessionQueues(10);
    const boom = queues.run("s1", async () => {
      throw new Error("ingest blew up");
    });
    const after = queues.run("s1", async () => "still here");
    await expect(boom).rejects.toThrow("ingest blew up");
    await expect(after).resolves.toBe("still here");
  });
});

describe("a loop that has fallen behind", () => {
  it("lets the oldest waiting event go and keeps the newest", async () => {
    const queues = new SessionQueues(2);
    const held = gate();
    const ran: string[] = [];
    const running = queues.run("s1", async () => {
      await held.wait;
      ran.push("running");
    });
    const a = queues.run("s1", async () => void ran.push("a"));
    const b = queues.run("s1", async () => void ran.push("b"));
    const c = queues.run("s1", async () => void ran.push("c"));

    await expect(a).rejects.toBeInstanceOf(EventDropped);
    held.open();
    await Promise.all([running, b, c]);
    expect(ran).toEqual(["running", "b", "c"]);
  });

  it("tells whoever queued the dropped event which session it was dropped from", async () => {
    const queues = new SessionQueues(1);
    const held = gate();
    const running = queues.run("s1", () => held.wait);
    const dropped = queues.run("s1", async () => undefined);
    const kept = queues.run("s1", async () => undefined);

    await expect(dropped).rejects.toMatchObject({ sessionId: "s1" });
    held.open();
    await Promise.all([running, kept]);
  });

  it("counts what it let go, in total and for the session it happened in", async () => {
    const queues = new SessionQueues(1);
    const held = gate();
    const settled: Promise<unknown>[] = [queues.run("s1", () => held.wait)];
    for (let i = 0; i < 3; i += 1) settled.push(queues.run("s1", async () => undefined).catch(() => undefined));
    settled.push(queues.run("s2", async () => undefined));

    expect(queues.dropped()).toBe(2);
    expect(queues.droppedFor("s1")).toBe(2);
    expect(queues.droppedFor("s2")).toBe(0);
    held.open();
    await Promise.all(settled);
  });

  it("says so the moment it happens, naming the session and the running total", async () => {
    const seen: { sessionId: string; dropped: number }[] = [];
    const queues = new SessionQueues(1, (sessionId, dropped) => seen.push({ sessionId, dropped }));
    const held = gate();
    const settled: Promise<unknown>[] = [queues.run("s1", () => held.wait)];
    for (let i = 0; i < 3; i += 1) settled.push(queues.run("s1", async () => undefined).catch(() => undefined));

    expect(seen).toEqual([
      { sessionId: "s1", dropped: 1 },
      { sessionId: "s1", dropped: 2 },
    ]);
    held.open();
    await Promise.all(settled);
  });

  it("reports how many are waiting, and settles back to none", async () => {
    const queues = new SessionQueues(10);
    const held = gate();
    const all = [queues.run("s1", () => held.wait), queues.run("s1", async () => undefined), queues.run("s2", async () => undefined)];
    expect(queues.waiting()).toBe(1); // the one in flight is not waiting
    held.open();
    await Promise.all(all);
    expect(queues.waiting()).toBe(0);
  });

  /** A session name arrives from outside; a queue that remembers every one of them is a leak. */
  it("forgets a session once nothing of it is left to run", async () => {
    const queues = new SessionQueues(10);
    await queues.run("s1", async () => undefined);
    await queues.run("s2", async () => undefined);
    await sleep(0); // the caller hears first; the lane is cleared on the turn after
    expect(queues.sessions()).toBe(0);
  });
});

describe("how deep the queue is allowed to get", () => {
  it("is a hundred when nobody said otherwise", () => {
    expect(DEFAULT_EVENT_QUEUE_MAX).toBe(100);
    expect(eventQueueMax({})).toBe(100);
    expect(eventQueueMax({ DM_EVENT_QUEUE_MAX: "" })).toBe(100);
    expect(new SessionQueues().limit).toBe(100);
  });

  it("is whatever somebody put in the environment", () => {
    expect(eventQueueMax({ DM_EVENT_QUEUE_MAX: "5" })).toBe(5);
  });

  it("refuses a depth that is not a whole number of events, rather than queueing none", () => {
    for (const bad of ["0", "-1", "abc", "1.5", "100events"]) {
      expect(() => eventQueueMax({ DM_EVENT_QUEUE_MAX: bad }), bad).toThrow(/DM_EVENT_QUEUE_MAX/);
    }
  });
});
