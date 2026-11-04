import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * Which layers the service worker believes it may send, driven through the worker itself.
 *
 * Nothing held this file before, and both of the things below are decisions about what may leave
 * somebody's machine. They are observable without exporting anything: the worker announces the
 * layers it senses the moment it has read consent, so the body's indicator is honest, and that
 * announcement is the one thing it posts before anybody touches a tab. What is on the wire is
 * what it believes it is allowed to do.
 *
 * MV3 restarts this worker constantly, so "the moment it starts" is not a rare path — it is
 * every thirty idle seconds.
 */
type Changes = Record<string, { newValue?: unknown }>;

function harness() {
  const stored: Record<string, unknown> = {};
  const changeListeners: ((changes: Changes, area: string) => void)[] = [];
  let firstRead: ((value: Record<string, unknown>) => void) | null = null;
  let firstReadFails: ((err: unknown) => void) | null = null;
  let reads = 0;
  const noop = { addListener: () => {} };

  const chrome = {
    storage: {
      sync: {
        get: (_keys: unknown) => {
          reads += 1;
          // The first read is the one the worker starts with; it is held open so a change can be
          // made to arrive while it is still in flight, which is the race this is about.
          if (reads === 1) {
            return new Promise<Record<string, unknown>>((resolve, reject) => {
              firstRead = resolve;
              firstReadFails = reject;
            });
          }
          return Promise.resolve({ ...stored });
        },
      },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      onChanged: { addListener: (fn: (c: Changes, a: string) => void) => void changeListeners.push(fn) },
    },
    windows: { onFocusChanged: noop, WINDOW_ID_NONE: -1 },
    webNavigation: { onCommitted: noop },
    webRequest: { onBeforeRequest: noop, onCompleted: noop, onErrorOccurred: noop },
    runtime: { onMessage: noop },
    action: { onClicked: noop },
    sidePanel: { open: async () => {} },
  };

  const posted: { layers: string[] }[] = [];
  const fetchMock = vi.fn(async (_url: unknown, init: { body?: string } = {}) => {
    const event = JSON.parse(init.body ?? "{}") as { type?: string; payload?: { layers?: string[] } };
    if (event.type === "sensor.layers_changed") posted.push({ layers: event.payload?.layers ?? [] });
    return { ok: true, status: 202, json: async () => ({ accepted: true, eventId: "e" }) };
  });

  (globalThis as Record<string, unknown>).chrome = chrome;
  (globalThis as Record<string, unknown>).fetch = fetchMock;

  return {
    posted,
    /** What the options page wrote, and the change event the browser then delivers. */
    write(consent: Record<string, boolean>) {
      stored.consent = consent;
      for (const fn of changeListeners) fn({ consent: { newValue: consent } }, "sync");
    },
    finishFirstRead(value: Record<string, unknown>) {
      firstRead?.(value);
    },
    failFirstRead() {
      firstReadFails?.(new Error("storage unavailable"));
    },
    lastLayers: () => posted.at(-1)?.layers,
  };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  delete (globalThis as Record<string, unknown>).chrome;
  delete (globalThis as Record<string, unknown>).fetch;
});

describe("the worker could not read consent at all", () => {
  it("senses nothing, because not knowing is not permission", async () => {
    const h = harness();
    await import("./background");
    h.failFirstRead();
    await vi.waitFor(() => expect(h.posted).toHaveLength(1));
    // the defaults are what somebody gets when they have never chosen; a failed read is not that
    expect(h.lastLayers()).toEqual([]);
  });

  it("senses what was stored when the read does work", async () => {
    const h = harness();
    await import("./background");
    h.finishFirstRead({ consent: { interactions: true, tabs: false, network: false, page: false } });
    await vi.waitFor(() => expect(h.posted).toHaveLength(1));
    expect(h.lastLayers()).toEqual(["interactions", "idle", "visibility"]);
  });
});

describe("consent changed while the worker was still waking up", () => {
  it("keeps the layer somebody just turned off, rather than the read that was already in flight", async () => {
    const h = harness();
    await import("./background");
    // the options page turns everything off while the worker's first read has not come back yet
    h.write({ interactions: false, tabs: false, network: false, page: false });
    // ...and only then does the read, holding the state from before, finally answer
    h.finishFirstRead({ consent: { interactions: true, tabs: true, network: false, page: false } });
    await vi.waitFor(() => expect(h.posted.length).toBeGreaterThanOrEqual(2));
    await new Promise((r) => setTimeout(r, 10)); // let any late announcement land too
    expect(h.lastLayers()).toEqual([]);
  });

  it("still follows a change that arrives after the worker is up", async () => {
    const h = harness();
    await import("./background");
    h.finishFirstRead({ consent: { interactions: false, tabs: false, network: false, page: false } });
    await vi.waitFor(() => expect(h.posted).toHaveLength(1));
    h.write({ interactions: true, tabs: true, network: false, page: false });
    await vi.waitFor(() => expect(h.posted).toHaveLength(2));
    expect(h.lastLayers()).toEqual(["interactions", "idle", "visibility", "tabs"]);
  });
});
