import { describe, it, expect } from "vitest";
import { EventStore, createEvent } from "./index";

/**
 * The event log is the runtime's memory of what happened: replay rebuilds a session from it, and
 * everything downstream assumes it is append-only, in order, per-session correct, and bounded.
 * These tests hold it to that under the awkward cases — eviction across interleaved sessions, a
 * subscriber that throws, malformed input.
 */
type EventSpec = Parameters<typeof createEvent>[0];
const ev = (id: string, sessionId: string, over: Record<string, unknown> = {}) =>
  createEvent({
    id,
    sessionId,
    timestamp: "2026-09-03T00:00:00Z",
    source: "development",
    type: "development.build_started",
    severity: "info",
    payload: {},
    ...over,
  } as EventSpec);

describe("append and order", () => {
  it("keeps arrival order, both overall and within a session", () => {
    const store = new EventStore();
    for (const [id, s] of [["a", "s1"], ["b", "s2"], ["c", "s1"], ["d", "s2"], ["e", "s1"]] as const) store.append(ev(id, s));
    expect(store.all().map((e) => e.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(store.listBySession("s1").map((e) => e.id)).toEqual(["a", "c", "e"]);
    expect(store.listBySession("s2").map((e) => e.id)).toEqual(["b", "d"]);
  });

  it("returns the event it stored, so a caller can read the parsed form", () => {
    const store = new EventStore();
    const returned = store.append({ id: "a", sessionId: "s1", timestamp: "2026-09-03T00:00:00Z", source: "user", type: "user.action", severity: "info", payload: { detail: 1 } });
    expect(returned.id).toBe("a");
    expect(returned.payload).toEqual({ detail: 1 });
    expect(store.all()[0]).toBe(returned);
  });

  it("says nothing about a session it has never seen", () => {
    const store = new EventStore();
    expect(store.listBySession("never")).toEqual([]);
    expect(store.count()).toBe(0);
    expect(store.all()).toEqual([]);
  });

  it("hands back copies, so a caller cannot lengthen or shorten the log", () => {
    const store = new EventStore();
    store.append(ev("a", "s1"));
    store.all().push(ev("forged", "s1"));
    store.listBySession("s1").push(ev("forged", "s1"));
    expect(store.count()).toBe(1);
    expect(store.listBySession("s1")).toHaveLength(1);
  });
});

describe("the bound holds without corrupting the per-session index", () => {
  it("evicts oldest first and keeps each session's slice truthful", () => {
    const store = new EventStore(3);
    store.append(ev("a", "s1"));
    store.append(ev("b", "s2"));
    store.append(ev("c", "s1"));
    store.append(ev("d", "s2")); // pushes a out
    store.append(ev("e", "s1")); // pushes b out
    expect(store.count()).toBe(3);
    expect(store.all().map((e) => e.id)).toEqual(["c", "d", "e"]);
    expect(store.listBySession("s1").map((e) => e.id)).toEqual(["c", "e"]);
    expect(store.listBySession("s2").map((e) => e.id)).toEqual(["d"]);
  });

  it("forgets a session entirely once its last event ages out", () => {
    const store = new EventStore(2);
    store.append(ev("a", "gone"));
    store.append(ev("b", "stays"));
    store.append(ev("c", "stays"));
    expect(store.listBySession("gone")).toEqual([]);
    expect(store.listBySession("stays").map((e) => e.id)).toEqual(["b", "c"]);
  });

  it("stays at its bound under sustained load, and the session slices add up", () => {
    const store = new EventStore(50);
    for (let i = 0; i < 500; i += 1) store.append(ev(`e${i}`, `s${i % 4}`));
    expect(store.count()).toBe(50);
    const perSession = [0, 1, 2, 3].reduce((n, i) => n + store.listBySession(`s${i}`).length, 0);
    expect(perSession).toBe(50);
    expect(store.all()[0]?.id).toBe("e450");
    expect(store.all().at(-1)?.id).toBe("e499");
  });

  it("holds a single event with a bound of one", () => {
    const store = new EventStore(1);
    store.append(ev("a", "s1"));
    store.append(ev("b", "s1"));
    expect(store.all().map((e) => e.id)).toEqual(["b"]);
    expect(store.listBySession("s1").map((e) => e.id)).toEqual(["b"]);
  });
});

describe("validation at the door", () => {
  it("refuses input that is not an event, and stores nothing", () => {
    const store = new EventStore();
    for (const bad of [{ id: "x" }, {}, null, "an event", 42, { ...ev("a", "s1"), severity: "fatal" }, { ...ev("a", "s1"), timestamp: "yesterday" }]) {
      expect(() => store.append(bad), JSON.stringify(bad)).toThrow();
    }
    expect(store.count()).toBe(0);
  });

  it("accepts every source a sensor can claim, and no invented one", () => {
    const store = new EventStore();
    const sources = ["user", "system", "application", "tool", "model", "sensor", "development", "external"];
    for (const source of sources) {
      expect(() => store.append(ev(`e-${source}`, "s1", { source, type: `${source}.thing` })), source).not.toThrow();
    }
    expect(store.count()).toBe(sources.length);
    for (const source of ["browser", "extension", "aliens", ""]) {
      expect(() => store.append(ev("bad", "s1", { source })), source).toThrow();
    }
  });

  it("accepts every severity, so a debug sensor line is still a real event", () => {
    const store = new EventStore();
    for (const severity of ["debug", "info", "notice", "warning", "critical"]) {
      expect(() => store.append(ev(`e-${severity}`, "s1", { severity })), severity).not.toThrow();
    }
    expect(store.count()).toBe(5);
  });
});

describe("subscribers", () => {
  it("notifies in order and stops on unsubscribe", () => {
    const store = new EventStore();
    const seen: string[] = [];
    const off = store.subscribe((e) => seen.push(e.id));
    store.append(ev("a", "s1"));
    store.append(ev("b", "s1"));
    off();
    store.append(ev("c", "s1"));
    expect(seen).toEqual(["a", "b"]);
    expect(store.count()).toBe(3); // the log kept all three regardless
  });

  it("does not let a handler that throws hide the event from the others", () => {
    // the bug: the first throwing handler ended the fan-out and failed the append
    const seen: string[] = [];
    const errors: string[] = [];
    const store = new EventStore(10, (err) => errors.push(String(err)));
    store.subscribe(() => {
      throw new Error("listener blew up");
    });
    store.subscribe((e) => seen.push(e.id));
    expect(() => store.append(ev("a", "s1"))).not.toThrow();
    expect(seen).toEqual(["a"]);
    expect(store.count()).toBe(1);
    expect(errors).toEqual(["Error: listener blew up"]);
  });

  it("survives a throwing handler with nobody watching for the error", () => {
    const store = new EventStore();
    store.subscribe(() => {
      throw new Error("nobody hears this");
    });
    expect(() => store.append(ev("a", "s1"))).not.toThrow();
    expect(store.count()).toBe(1);
  });

  it("keeps going when a handler throws something that is not an Error", () => {
    const errors: unknown[] = [];
    const store = new EventStore(10, (err) => errors.push(err));
    store.subscribe(() => {
      throw "a bare string";
    });
    store.append(ev("a", "s1"));
    expect(errors).toEqual(["a bare string"]);
  });

  it("registers the same handler once, and unsubscribing twice is harmless", () => {
    const store = new EventStore();
    const seen: string[] = [];
    const handler = (e: { id: string }) => seen.push(e.id);
    const off1 = store.subscribe(handler);
    store.subscribe(handler);
    store.append(ev("a", "s1"));
    expect(seen).toEqual(["a"]);
    off1();
    off1();
    store.append(ev("b", "s1"));
    expect(seen).toEqual(["a"]);
  });

  it("tells the error handler which event the failing subscriber was given", () => {
    const failures: string[] = [];
    const store = new EventStore(10, (_err, event) => failures.push(event.id));
    store.subscribe(() => {
      throw new Error("x");
    });
    store.append(ev("a", "s1"));
    store.append(ev("b", "s1"));
    expect(failures).toEqual(["a", "b"]);
  });
});

describe("createEvent", () => {
  it("validates rather than trusting the caller", () => {
    expect(() => createEvent({ id: "a", sessionId: "s1", timestamp: "not a time", source: "user", type: "user.action", severity: "info", payload: {} })).toThrow();
    expect(() => createEvent({ id: "", sessionId: "s1", timestamp: "2026-09-03T00:00:00Z", source: "user", type: "user.action", severity: "info", payload: {} })).toThrow();
  });

  it("takes no clock of its own — the caller supplies the instant", () => {
    const e = createEvent({ id: "a", sessionId: "s1", timestamp: "2026-09-03T12:34:56.789Z", source: "user", type: "user.action", severity: "info", payload: {} });
    expect(e.timestamp).toBe("2026-09-03T12:34:56.789Z");
  });
});
