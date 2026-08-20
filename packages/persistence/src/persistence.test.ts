import { describe, it, expect } from "vitest";
import { InMemoryEventLogStore, InMemorySnapshotStore } from "./index";
import type { MatterEvent } from "@particle/contracts";

const ev: MatterEvent = {
  id: "e1", sessionId: "s1", timestamp: "2026-01-01T00:00:00Z",
  source: "development", type: "development.server_error", severity: "critical", payload: {},
};

describe("in-memory stores", () => {
  it("event log appends and filters by session", async () => {
    const store = new InMemoryEventLogStore();
    await store.append(ev);
    await store.append({ ...ev, id: "e2", sessionId: "s2" });
    expect((await store.listBySession("s1")).map((e) => e.id)).toEqual(["e1"]);
    expect(await store.all()).toHaveLength(2);
  });

  it("snapshot store saves and lists by kind", async () => {
    const store = new InMemorySnapshotStore();
    await store.save({ sessionId: "s1", kind: "ui", at: "t", data: { a: 1 } });
    await store.save({ sessionId: "s1", kind: "world", at: "t", data: { b: 2 } });
    expect(await store.list("s1")).toHaveLength(2);
    expect(await store.list("s1", "ui")).toHaveLength(1);
  });
});
