import { describe, it, expect } from "vitest";
import { KNOWN_EVENT_TYPES, MAX_SCREEN_SUMMARY, type ScreenReading } from "@particle/contracts";
import { MAX_PENDING_READS, createReadQueue, screenReadPayload, screenReader } from "./shape";

const reading: ScreenReading = {
  activity: "messaging",
  summary: "Two unread messages in a team chat.",
  topics: ["unread", "team chat"],
  needsAttention: true,
  confidence: 0.75,
};

const source = {
  app: "KakaoTalk",
  window: "team chat",
  path: "C:/Temp/particle-KakaoTalk.png",
  providerId: "mock",
  modelId: "deterministic",
};

/**
 * Reading is its own switch. Photographing a window and sending those pixels to a model are two
 * different things to consent to, and the second one is the one that takes them off this
 * machine (docs/CONSENT_V2.md).
 */
describe("whether a picture is read at all", () => {
  const brains = ["mock"];

  it("is off, silently, when nobody asked for it", () => {
    expect(screenReader(false, true, brains)).toEqual({ run: false, note: null });
  });

  it("stays off when the camera is off, however the reading switch is set", () => {
    expect(screenReader(true, false, brains).run).toBe(false);
    expect(screenReader(false, false, brains)).toEqual({ run: false, note: null });
  });

  it("says which switches are missing when somebody asked for reading and nothing is photographed", () => {
    const decision = screenReader(true, false, brains);
    expect(decision.note).toContain("DM_CAPTURE");
    expect(decision.note).toContain("DM_SCREEN_READ");
  });

  it("refuses to run with no brain that can be handed a picture", () => {
    const decision = screenReader(true, true, []);
    expect(decision.run).toBe(false);
    expect(decision.note).toContain("no brain");
  });

  /** Somebody who turned this on is told, once, where their pixels are about to go. */
  it("runs when both switches are on, and names the brains that may read", () => {
    const decision = screenReader(true, true, ["mock", "anthropic"]);
    expect(decision.run).toBe(true);
    expect(decision.note).toContain("mock, anthropic");
    expect(decision.note).toContain("DM_SCREEN_READ");
  });

  /**
   * The line a person reads at the moment they consent has to say which of the two happened.
   * With no key the only brain that may be handed a picture is the deterministic one, which runs
   * in this process and looks at no pixels, and `.env.example` and the agent README both say
   * nothing leaves the machine in that case.
   */
  it("says nothing leaves the machine when every brain that may read runs in this process", () => {
    const decision = screenReader(true, true, ["mock"]);
    expect(decision.run).toBe(true);
    expect(decision.note).toContain("no picture leaves this machine");
    expect(decision.note).not.toContain("off this machine");
  });

  it("names the hosted brain, and only it, when a picture would leave the machine", () => {
    const decision = screenReader(true, true, ["anthropic", "mock"]);
    expect(decision.note).toContain("off this machine");
    expect(decision.note).toContain("anthropic reads the pixels off this machine");
  });

  it("names every hosted brain when more than one could be handed a picture", () => {
    const decision = screenReader(true, true, ["anthropic", "openai", "mock"]);
    expect(decision.note).toContain("anthropic, openai read the pixels off this machine");
  });
});

describe("what a reading reports to the runtime", () => {
  it("reports a type the runtime knows", () => {
    expect(KNOWN_EVENT_TYPES as readonly string[]).toContain("sensor.screen_read");
  });

  it("carries the situation, who read it, and where the picture is", () => {
    const payload = screenReadPayload(reading, source);
    expect(payload).toEqual({
      app: "KakaoTalk",
      window: "team chat",
      path: "C:/Temp/particle-KakaoTalk.png",
      provider: "mock",
      model: "deterministic",
      activity: "messaging",
      summary: "Two unread messages in a team chat.",
      topics: "unread, team chat",
      needsAttention: true,
      confidence: 0.75,
    });
  });

  /**
   * The belief keeps a payload's scalar fields and leaves anything nested behind, so a list of
   * topics that travelled as a list would arrive as nothing at all.
   */
  it("is flat: every field is a string, a number or a flag", () => {
    for (const [key, value] of Object.entries(screenReadPayload(reading, source))) {
      expect(["string", "number", "boolean"], key).toContain(typeof value);
    }
  });

  it("carries no model at all rather than an empty one", () => {
    const payload = screenReadPayload(reading, { ...source, modelId: undefined });
    expect("model" in payload).toBe(false);
  });

  it("holds what the model wrote to the same length every other name is held to", () => {
    const payload = screenReadPayload(
      { ...reading, summary: "s".repeat(MAX_SCREEN_SUMMARY), topics: ["t".repeat(60), "u".repeat(60)] },
      source,
    );
    expect(String(payload.summary).length).toBeLessThanOrEqual(121);
    expect(String(payload.topics).length).toBeLessThanOrEqual(121);
  });

  it("takes an escape sequence out of a window title before it reaches a log line", () => {
    const payload = screenReadPayload(reading, { ...source, window: `team\u001b[2J chat` });
    expect(payload.window).toBe("team[2J chat");
  });
});

/**
 * Taking a picture and having a model read it are two different speeds. The reading used to
 * happen inside the capture lock, so the next picture of any app waited for a model to answer
 * about the last one: at a minute between pictures that is invisible, at the one-second floor it
 * is a camera that stops taking pictures because a model is thinking.
 *
 * So a picture is queued and the photographer leaves. One reading runs at a time — the point of
 * the lock was never to protect the model, it was that two readings of one window racing each
 * other reach the runtime in the wrong order — and when readings fall behind, the OLDEST frames
 * go. A picture of the window somebody was in two minutes ago is not what the body needs.
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => {};
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

describe("pictures waiting to be read", () => {
  it("reads one at a time, in the order they were taken", async () => {
    const read: string[] = [];
    const queue = createReadQueue<string>(async (frame) => {
      await sleep(frame === "a" ? 15 : 1);
      read.push(frame);
    });
    queue.push("a");
    queue.push("b");
    await sleep(40);
    expect(read).toEqual(["a", "b"]);
  });

  it("never has two readings in flight at once", async () => {
    let running = 0;
    let most = 0;
    const held = gate();
    const queue = createReadQueue<string>(async () => {
      running += 1;
      most = Math.max(most, running);
      await held.wait;
      running -= 1;
    });
    queue.push("a");
    queue.push("b");
    held.open();
    await sleep(5);
    expect(most).toBe(1);
  });

  it("lets the photographer go before the model has answered", async () => {
    const held = gate();
    const queue = createReadQueue<string>(() => held.wait);
    queue.push("a"); // returns rather than waiting on the reading it just started
    expect(queue.pending()).toBe(1);
    held.open();
    await sleep(5);
    expect(queue.pending()).toBe(0);
  });

  it("drops the oldest frames when readings fall behind, and keeps the newest", async () => {
    const read: string[] = [];
    const held = gate();
    const queue = createReadQueue<string>(
      async (frame) => {
        await held.wait;
        read.push(frame);
      },
      { max: 2 },
    );
    for (const frame of ["reading", "old", "older", "new", "newest"]) queue.push(frame);
    expect(queue.dropped()).toBe(2);
    held.open();
    await sleep(5);
    expect(read).toEqual(["reading", "new", "newest"]);
  });

  it("says which frame it let go and how many that makes", async () => {
    const letGo: { frame: string; total: number }[] = [];
    const held = gate();
    const queue = createReadQueue<string>(() => held.wait, { max: 1, onDrop: (frame, total) => letGo.push({ frame, total }) });
    for (const frame of ["reading", "a", "b", "c"]) queue.push(frame);
    expect(letGo).toEqual([
      { frame: "a", total: 1 },
      { frame: "b", total: 2 },
    ]);
    held.open();
    await sleep(5);
  });

  it("keeps reading after one reading fails, and tells whoever asked to be told", async () => {
    const errors: string[] = [];
    const read: string[] = [];
    const queue = createReadQueue<string>(
      async (frame) => {
        if (frame === "bad") throw new Error("the model refused");
        read.push(frame);
      },
      { onError: (err) => errors.push(String(err)) },
    );
    queue.push("bad");
    queue.push("good");
    await sleep(5);
    expect(read).toEqual(["good"]);
    expect(errors).toEqual(["Error: the model refused"]);
  });

  /**
   * A reader that throws before it ever returns a promise used to leave the worker marked busy
   * with nobody reading: every frame after it queued behind work that had already failed, and
   * the layer stopped without a word. The readers here are async, but this is an export.
   */
  it("does not wedge when a reader throws before it returns a promise", async () => {
    const errors: string[] = [];
    const read: string[] = [];
    const queue = createReadQueue<string>(
      (frame) => {
        if (frame === "bad") throw new Error("thrown, not rejected");
        read.push(frame);
        return Promise.resolve();
      },
      { onError: (err) => errors.push(String(err)) },
    );
    queue.push("bad");
    queue.push("good");
    await sleep(5);
    expect(read).toEqual(["good"]);
    expect(errors).toEqual(["Error: thrown, not rejected"]);
    expect(queue.pending()).toBe(0);
  });

  it("holds a couple of frames by default — the newest window is the one worth reading", async () => {
    const held = gate();
    const queue = createReadQueue<string>(() => held.wait);
    for (let i = 0; i < 2 + MAX_PENDING_READS; i += 1) queue.push(`frame${i}`);
    expect(queue.pending()).toBe(MAX_PENDING_READS + 1); // the one in flight is not waiting
    expect(queue.dropped()).toBe(1);
    held.open();
    await sleep(5);
  });
});
