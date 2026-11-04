import { describe, it, expect, vi } from "vitest";
import { installShutdown, SHUTDOWN_SIGNALS, type ShutdownDeps } from "./shutdown";

/**
 * What a stop signal has to do before the process ends.
 *
 * There was nothing here at all: no handler, and `app.close()` — the one call that runs the
 * onClose hook and so the only path that closes the channel and the store — was never made.
 * `docker stop` and Ctrl+C therefore killed the process mid-flight, the consumer never left its
 * group, and the broker handed every uncommitted message to the next process. That matters more
 * here than elsewhere: what stops a second fold is `seen`, which lives in this process's memory
 * and is empty the moment it starts, so a redelivered event is folded twice and the belief
 * counts one observation as two.
 */
function harness(over: Partial<ShutdownDeps> = {}) {
  const said: string[] = [];
  const exited: number[] = [];
  const handlers = new Map<string, () => void>();
  const deps: ShutdownDeps = {
    close: () => Promise.resolve(),
    waiting: () => 0,
    say: (line) => said.push(line),
    exit: (code) => void exited.push(code),
    on: (signal, handler) => void handlers.set(signal, handler),
    ...over,
  };
  installShutdown(deps);
  return { said, exited, signal: (s: string) => handlers.get(s)?.(), handlers };
}

describe("stopping the runtime", () => {
  it("listens for the signals a container and a terminal actually send", () => {
    const { handlers } = harness();
    expect([...handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);
    expect(SHUTDOWN_SIGNALS).toEqual(["SIGTERM", "SIGINT"]);
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    it(`closes the server on ${signal}, which is what leaves the group and the store cleanly`, async () => {
      const closed: string[] = [];
      const h = harness({ close: async () => void closed.push("closed") });
      h.signal(signal);
      await vi.waitFor(() => expect(h.exited).toEqual([0]));
      expect(closed).toEqual(["closed"]);
    });
  }

  it("says how many events it is letting go, rather than losing them quietly", async () => {
    const h = harness({ waiting: () => 7 });
    h.signal("SIGTERM");
    await vi.waitFor(() => expect(h.exited).toEqual([0]));
    expect(h.said.join("\n")).toContain("7");
  });

  it("says nothing about a backlog when there is none", async () => {
    const h = harness({ waiting: () => 0 });
    h.signal("SIGTERM");
    await vi.waitFor(() => expect(h.exited).toEqual([0]));
    expect(h.said.join("\n")).not.toContain("0 ");
  });

  it("ends anyway when closing hangs, instead of waiting for the kill", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ close: () => new Promise<void>(() => {}), graceMs: 5_000 });
      h.signal("SIGTERM");
      await vi.advanceTimersByTimeAsync(4_999);
      expect(h.exited).toEqual([]);
      await vi.advanceTimersByTimeAsync(2);
      expect(h.exited).toEqual([1]);
      expect(h.said.join("\n")).toContain("5000");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says why when closing fails, and does not pretend it stopped cleanly", async () => {
    const h = harness({ close: async () => { throw new Error("the kafka event bus did not close cleanly"); } });
    h.signal("SIGTERM");
    await vi.waitFor(() => expect(h.exited).toEqual([1]));
    expect(h.said.join("\n")).toContain("kafka");
  });

  it("ends at once on a second signal, because that is what pressing it twice means", async () => {
    vi.useFakeTimers();
    try {
      const h = harness({ close: () => new Promise<void>(() => {}) });
      h.signal("SIGINT");
      h.signal("SIGINT");
      expect(h.exited).toEqual([1]);
      // the first signal's deadline must not then exit a process that has already gone
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.exited).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes once however many signals arrive", async () => {
    let closes = 0;
    const h = harness({ close: async () => void (closes += 1) });
    h.signal("SIGTERM");
    h.signal("SIGINT");
    await vi.waitFor(() => expect(h.exited.length).toBeGreaterThan(0));
    expect(closes).toBe(1);
  });
});
