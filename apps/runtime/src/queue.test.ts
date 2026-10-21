import { describe, it, expect } from "vitest";
import {
  DEFAULT_EVENT_QUEUE_MAX,
  EventDropped,
  MAX_REMEMBERED_DROPPING_SESSIONS,
  SessionQueues,
  eventQueueMax,
} from "./queue";

/**
 * A session's events only mean anything in the order they happened — a recovery after a failure,
 * a file saved on the branch somebody just switched to. So one session runs one event at a time,
 * and a second session never waits behind the first.
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
    const first = queues.run("s1", "e1", async () => {
      await sleep(20);
      ran.push("first");
    });
    const second = queues.run("s1", "e2", async () => {
      ran.push("second");
    });
    const third = queues.run("s1", "e3", async () => {
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
    const all = [queues.run("s1", "e1", task), queues.run("s1", "e2", task), queues.run("s1", "e3", task)];
    held.open();
    await Promise.all(all);
    expect(most).toBe(1);
  });

  it("lets a second session work while the first is stuck", async () => {
    const queues = new SessionQueues(10);
    const stuck = gate();
    const slow = queues.run("s1", "e1", () => stuck.wait);
    await expect(queues.run("s2", "e2", async () => "done")).resolves.toBe("done");
    stuck.open();
    await slow;
  });

  it("hands each caller back what its own task answered", async () => {
    const queues = new SessionQueues(10);
    await expect(queues.run("s1", "e1", async () => ({ ok: 1 }))).resolves.toEqual({ ok: 1 });
  });

  it("fails only the caller whose task threw, and carries on with the rest", async () => {
    const queues = new SessionQueues(10);
    const boom = queues.run("s1", "e1", async () => {
      throw new Error("ingest blew up");
    });
    const after = queues.run("s1", "e2", async () => "still here");
    await expect(boom).rejects.toThrow("ingest blew up");
    await expect(after).resolves.toBe("still here");
  });

  /**
   * A task that throws before it ever returns a promise used to leave the lane marked running
   * with nobody running in it — every later event for that session queued behind a job that had
   * already failed, and the session simply stopped, silently and permanently.
   */
  it("does not wedge the lane when a task throws before it returns a promise", async () => {
    const queues = new SessionQueues(10);
    const boom = queues.run("s1", "e1", () => {
      throw new Error("thrown, not rejected");
    });
    const after = queues.run("s1", "e2", async () => "still here");
    await expect(boom).rejects.toThrow("thrown, not rejected");
    await expect(after).resolves.toBe("still here");
  });
});

describe("a loop that has fallen behind", () => {
  it("lets the oldest waiting event go and keeps the newest", async () => {
    const queues = new SessionQueues(2);
    const held = gate();
    const ran: string[] = [];
    const running = queues.run("s1", "running", async () => {
      await held.wait;
      ran.push("running");
    });
    const a = queues.run("s1", "a", async () => void ran.push("a"));
    const b = queues.run("s1", "b", async () => void ran.push("b"));
    const c = queues.run("s1", "c", async () => void ran.push("c"));

    await expect(a).rejects.toBeInstanceOf(EventDropped);
    held.open();
    await Promise.all([running, b, c]);
    expect(ran).toEqual(["running", "b", "c"]);
  });

  it("tells whoever queued the dropped event which session and which event it was", async () => {
    const queues = new SessionQueues(1);
    const held = gate();
    const running = queues.run("s1", "running", () => held.wait);
    const dropped = queues.run("s1", "the-lost-one", async () => undefined);
    const kept = queues.run("s1", "kept", async () => undefined);

    await expect(dropped).rejects.toMatchObject({ sessionId: "s1", eventId: "the-lost-one" });
    held.open();
    await Promise.all([running, kept]);
  });

  it("counts what it let go, in total and for the session it happened in", async () => {
    const queues = new SessionQueues(1);
    const held = gate();
    const settled: Promise<unknown>[] = [queues.run("s1", "running", () => held.wait)];
    for (let i = 0; i < 3; i += 1) settled.push(queues.run("s1", `e${i}`, async () => undefined).catch(() => undefined));
    settled.push(queues.run("s2", "other", async () => undefined));

    expect(queues.dropped()).toBe(2);
    expect(queues.droppedFor("s1")).toBe(2);
    expect(queues.droppedFor("s2")).toBe(0);
    held.open();
    await Promise.all(settled);
  });

  /**
   * The count used to live on the lane, and the lane is thrown away the moment the session goes
   * quiet. So a session that had lost fifty events went idle for a second and the next audit
   * record began again at one: nothing anywhere could say how much of somebody's afternoon the
   * runtime had let go of. The lane is about work in hand; the count is about what was lost.
   */
  it("remembers what a session lost after the session has gone quiet", async () => {
    const queues = new SessionQueues(1);
    const held = gate();
    const settled: Promise<unknown>[] = [queues.run("s1", "running", () => held.wait)];
    for (let i = 0; i < 3; i += 1) settled.push(queues.run("s1", `e${i}`, async () => undefined).catch(() => undefined));
    held.open();
    await Promise.all(settled);
    await sleep(0);

    expect(queues.sessions()).toBe(0); // the lane is gone
    expect(queues.droppedFor("s1")).toBe(2); // what it lost is not
    await queues.run("s1", "later", async () => undefined);
    expect(queues.droppedFor("s1")).toBe(2); // and a later event does not reset it
  });

  /** Session names come from outside, so even a count per name cannot be kept for all of them. */
  it("remembers a bounded number of sessions that lost something", async () => {
    const queues = new SessionQueues(1);
    const held = gate();
    const settled: Promise<unknown>[] = [];
    const overflow = (session: string) => {
      settled.push(queues.run(session, "running", () => held.wait));
      settled.push(queues.run(session, "waiting", async () => undefined).catch(() => undefined));
      settled.push(queues.run(session, "newest", async () => undefined).catch(() => undefined));
    };
    for (let i = 0; i < MAX_REMEMBERED_DROPPING_SESSIONS + 1; i += 1) overflow(`s${i}`);

    expect(queues.remembered()).toBe(MAX_REMEMBERED_DROPPING_SESSIONS);
    expect(queues.droppedFor("s0")).toBe(0); // the oldest to lose something is the first forgotten
    expect(queues.droppedFor(`s${MAX_REMEMBERED_DROPPING_SESSIONS}`)).toBe(1);
    // the total is a plain count and never forgets
    expect(queues.dropped()).toBe(MAX_REMEMBERED_DROPPING_SESSIONS + 1);
    held.open();
    await Promise.all(settled);
  });

  it("says so the moment it happens, naming the session, the event and the running total", async () => {
    const seen: { sessionId: string; eventId: string; droppedForSession: number }[] = [];
    const queues = new SessionQueues(1, (dropped) => seen.push(dropped));
    const held = gate();
    const settled: Promise<unknown>[] = [queues.run("s1", "running", () => held.wait)];
    for (const id of ["a", "b", "c"]) settled.push(queues.run("s1", id, async () => undefined).catch(() => undefined));

    expect(seen).toEqual([
      { sessionId: "s1", eventId: "a", droppedForSession: 1 },
      { sessionId: "s1", eventId: "b", droppedForSession: 2 },
    ]);
    held.open();
    await Promise.all(settled);
  });

  it("reports how many are waiting, and settles back to none", async () => {
    const queues = new SessionQueues(10);
    const held = gate();
    const all = [
      queues.run("s1", "e1", () => held.wait),
      queues.run("s1", "e2", async () => undefined),
      queues.run("s2", "e3", async () => undefined),
    ];
    expect(queues.waiting()).toBe(1); // the one in flight is not waiting
    held.open();
    await Promise.all(all);
    expect(queues.waiting()).toBe(0);
  });

  /** A session name arrives from outside; a lane kept for every one of them is a leak. */
  it("forgets a session once nothing of it is left to run", async () => {
    const queues = new SessionQueues(10);
    await queues.run("s1", "e1", async () => undefined);
    await queues.run("s2", "e2", async () => undefined);
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
