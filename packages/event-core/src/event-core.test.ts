import { describe, it, expect } from "vitest";
import { EventStore, createEvent } from "./index";

function ev(id: string, sessionId: string, type = "development.build_started") {
  return createEvent({
    id, sessionId, timestamp: "2026-01-01T00:00:00Z",
    source: "development", type, severity: "info", payload: {},
  });
}

describe("EventStore", () => {
  it("appends, indexes by session, and notifies subscribers", () => {
    const store = new EventStore();
    const seen: string[] = [];
    const off = store.subscribe((e) => seen.push(e.id));
    store.append(ev("a", "s1"));
    store.append(ev("b", "s2"));
    store.append(ev("c", "s1"));
    expect(store.count()).toBe(3);
    expect(store.listBySession("s1").map((e) => e.id)).toEqual(["a", "c"]);
    expect(seen).toEqual(["a", "b", "c"]);
    off();
    store.append(ev("d", "s1"));
    expect(seen).toEqual(["a", "b", "c"]); // no longer notified
  });

  it("rejects malformed events on append", () => {
    const store = new EventStore();
    expect(() => store.append({ id: "x" })).toThrow();
  });
});
