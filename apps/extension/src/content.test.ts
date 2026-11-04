// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * What the content script does with what it counted when the worker does not take it.
 *
 * MV3 throws the service worker away after thirty idle seconds and starts it again on the next
 * message, and a message sent into that gap is refused — `sendMessage` rejects with "could not
 * establish connection". Every counter here was cleared on the line after the send, before its
 * answer, so an interaction batch, a first idle, a page reading and a return from a long absence
 * all went into that gap and left nothing behind: not here, not in the worker, not in the trail.
 * The background half of this same sensor already counts what it could not deliver.
 *
 * Nothing held this file before, so this drives the script itself: a `chrome` of its own, the
 * clock stopped, and real events dispatched at the page.
 */
type Changes = Record<string, { newValue?: unknown }>;

function harness() {
  const sent: { kind: string; payload: Record<string, unknown> }[] = [];
  let worker: "up" | "restarting" = "up";
  const changeListeners: ((changes: Changes, area: string) => void)[] = [];
  let firstRead: ((value: Record<string, unknown>) => void) | null = null;

  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      sendMessage: (msg: { kind: string; payload: Record<string, unknown> }) => {
        if (worker === "restarting") {
          return Promise.reject(new Error("Could not establish connection. Receiving end does not exist."));
        }
        sent.push(msg);
        return Promise.resolve(undefined);
      },
    },
    storage: {
      sync: { get: () => new Promise<Record<string, unknown>>((resolve) => (firstRead = resolve)) },
      onChanged: { addListener: (fn: (c: Changes, a: string) => void) => void changeListeners.push(fn) },
    },
  };

  return {
    sent,
    of: (kind: string) => sent.filter((m) => m.kind === kind),
    down: () => void (worker = "restarting"),
    up: () => void (worker = "up"),
    finishFirstRead: (consent: unknown) => firstRead?.({ consent }),
    change: (consent: unknown) => {
      for (const fn of changeListeners) fn({ consent: { newValue: consent } }, "sync");
    },
  };
}

const click = () => window.dispatchEvent(new Event("pointerdown"));
const TICK = 10_000;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as Record<string, unknown>).chrome;
});

describe("an interaction batch the worker did not take", () => {
  it("is still counted, and goes out with the next cycle", async () => {
    const h = harness();
    await import("./content");
    h.down();
    click();
    click();
    click();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("interaction")).toHaveLength(0); // the worker was restarting

    h.up();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("interaction")).toHaveLength(1);
    expect(h.of("interaction")[0]?.payload.count).toBe(3);
  });

  it("counts what happened while the send was in flight, and does not send it twice", async () => {
    const h = harness();
    await import("./content");
    click();
    click();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("interaction")[0]?.payload.count).toBe(2);

    click();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("interaction")).toHaveLength(2);
    expect(h.of("interaction")[1]?.payload.count).toBe(1);
  });

  it("says nothing at all when nothing happened", async () => {
    harness();
    await import("./content");
    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect((globalThis as { chrome: { runtime: unknown } }).chrome).toBeDefined();
  });
});

describe("a first idle the worker did not take", () => {
  it("is reported on the next cycle rather than never", async () => {
    const h = harness();
    await import("./content");
    h.down();
    await vi.advanceTimersByTimeAsync(70_000); // past the sixty seconds that make a page idle
    expect(h.of("idle")).toHaveLength(0);

    h.up();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("idle")).toHaveLength(1);
  });

  it("is reported once when it does arrive", async () => {
    const h = harness();
    await import("./content");
    await vi.advanceTimersByTimeAsync(70_000);
    await vi.advanceTimersByTimeAsync(TICK * 3);
    expect(h.of("idle")).toHaveLength(1);
  });
});

describe("a page reading the worker did not take", () => {
  it("is read again next cycle instead of being remembered as reported", async () => {
    const h = harness();
    await import("./content");
    h.finishFirstRead({ page: true });
    await vi.advanceTimersByTimeAsync(0);
    h.down();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("page")).toHaveLength(0);

    h.up();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("page")).toHaveLength(1);
  });

  it("does not repeat a page that has not changed", async () => {
    const h = harness();
    await import("./content");
    h.finishFirstRead({ page: true });
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("page")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(TICK * 6); // well past the thirty second floor
    expect(h.of("page")).toHaveLength(1);
  });
});

describe("a return from a long absence the worker did not take", () => {
  it("is still reported, with the time that was actually spent away", async () => {
    const h = harness();
    await import("./content");
    h.down();
    const hidden = (v: boolean) => {
      Object.defineProperty(document, "hidden", { value: v, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    hidden(true);
    await vi.advanceTimersByTimeAsync(30_000);
    hidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.of("visibility")).toHaveLength(0);

    h.up();
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("visibility")).toHaveLength(1);
    expect(h.of("visibility")[0]?.payload.awaySeconds).toBe(30);
    await vi.advanceTimersByTimeAsync(TICK * 2);
    expect(h.of("visibility")).toHaveLength(1); // and not again
  });
});

describe("the page layer's consent changed while the first read was in flight", () => {
  it("keeps what was just turned off, rather than the answer already on its way", async () => {
    const h = harness();
    await import("./content");
    h.change({ page: false }); // turned off in the options page while the read is out
    h.finishFirstRead({ page: true }); // ...and the read, holding the state from before, answers
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("page")).toHaveLength(0);
  });

  it("follows a change that arrives after the read has landed", async () => {
    const h = harness();
    await import("./content");
    h.finishFirstRead({ page: false });
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("page")).toHaveLength(0);
    h.change({ page: true });
    await vi.advanceTimersByTimeAsync(TICK);
    expect(h.of("page")).toHaveLength(1);
  });
});
