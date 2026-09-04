import { describe, it, expect, vi } from "vitest";
import { SessionRuntime } from "./runtime";
import { InMemoryEventLogStore, InMemorySnapshotStore, type EventLogStore, type Snapshot, type SnapshotStore } from "@particle/persistence";
import type { MatterEvent } from "@particle/contracts";

/**
 * This is the server-side composition: it validates the event, stores it, runs the loop, writes
 * snapshots and tells every connected client. Storage and clients are the two things it does not
 * control, so what matters is that neither can stop the runtime from doing its job — the body
 * still reshapes when the database is down, and one broken client does not silence the rest.
 */
const NOW = "2026-09-04T00:00:00Z";
const now = () => NOW;

const ev = (id: string, sessionId = "s", type = "development.server_error", severity: MatterEvent["severity"] = "critical"): MatterEvent => ({
  id, sessionId, timestamp: NOW, source: "development", type, severity, payload: {},
});

const failingLog = (): EventLogStore => ({
  append: async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
  },
  listBySession: async () => [],
  all: async () => [],
});

const failingSnapshots = (): SnapshotStore => ({
  save: async () => {
    throw new Error("no space left on device");
  },
  list: async () => [],
});

describe("storage that is not answering", () => {
  it("keeps reshaping the body when the durable log is down, and says so in the log", async () => {
    // the event is already in the in-memory log by then; throwing here would abort the ingest
    // and leave the two logs disagreeing
    const rt = new SessionRuntime(now, failingLog(), new InMemorySnapshotStore());
    const { result } = await rt.ingest(ev("e1"));
    expect(result.morph.applied).toBe(true);
    expect(rt.store.count()).toBe(1);
    expect(rt.peekWorld("s").activeProblems).toHaveLength(1);
    expect(rt.core.hasSession("s")).toBe(true);
  });

  it("keeps going when snapshots cannot be written", async () => {
    const rt = new SessionRuntime(now, new InMemoryEventLogStore(), failingSnapshots());
    const { result } = await rt.ingest(ev("e1"));
    expect(result.morph.applied).toBe(true);
    expect(rt.peekUI("s")).toBeDefined();
  });

  it("still refuses an event that is not an event", async () => {
    const rt = new SessionRuntime(now, new InMemoryEventLogStore(), new InMemorySnapshotStore());
    await expect(rt.ingest({ id: "x" })).rejects.toThrow();
    await expect(rt.ingest(null)).rejects.toThrow();
    await expect(rt.ingest({ ...ev("e"), timestamp: "yesterday" })).rejects.toThrow();
    expect(rt.store.count()).toBe(0);
  });

  it("works with no persistence configured at all", async () => {
    const rt = new SessionRuntime(now);
    const { result } = await rt.ingest(ev("e1"));
    expect(result.morph.applied).toBe(true);
  });
});

describe("clients that misbehave", () => {
  it("tells every listener even when one of them throws", async () => {
    const rt = new SessionRuntime(now);
    rt.onMessage(() => {
      throw new Error("a socket that blew up");
    });
    const seen: string[] = [];
    rt.onMessage((m) => seen.push(m.kind));

    const { result } = await rt.ingest(ev("e1"));
    expect(result.morph.applied).toBe(true);
    expect(seen).toContain("world_state_changed");
    expect(seen).toContain("ui_patch");
  });

  it("stops talking to a listener that unsubscribed", async () => {
    const rt = new SessionRuntime(now);
    const seen: string[] = [];
    const off = rt.onMessage((m) => seen.push(m.sessionId));
    await rt.ingest(ev("e1", "a"));
    off();
    await rt.ingest(ev("e2", "b"));
    expect(seen.every((id) => id === "a")).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("says what changed, in the order a client needs to hear it", async () => {
    const rt = new SessionRuntime(now);
    const kinds: string[] = [];
    rt.onMessage((m) => kinds.push(m.kind));
    await rt.ingest(ev("e1"));
    expect(kinds[0]).toBe("world_state_changed");
    expect(kinds).toContain("ai_presence_changed");
    expect(kinds).toContain("ui_patch");
    expect(kinds).toContain("decision_created");
  });

  it("does not announce a morph that did not happen", async () => {
    const rt = new SessionRuntime(now);
    const kinds: string[] = [];
    rt.onMessage((m) => kinds.push(m.kind));
    await rt.ingest(ev("quiet", "s", "development.build_started", "info"));
    expect(kinds).toContain("world_state_changed");
    expect(kinds).not.toContain("ui_patch");
  });
});

describe("what gets written down", () => {
  it("stores the world, the body and what was learned when the body changes", async () => {
    const snaps = new InMemorySnapshotStore();
    const rt = new SessionRuntime(now, new InMemoryEventLogStore(), snaps);
    await rt.ingest(ev("e1"));
    const kinds = (await snaps.list("s")).map((x: Snapshot) => x.kind);
    expect(kinds).toEqual(["world", "ui", "memory"]);
  });

  it("writes nothing when nothing changed", async () => {
    const snaps = new InMemorySnapshotStore();
    const rt = new SessionRuntime(now, new InMemoryEventLogStore(), snaps);
    await rt.ingest(ev("quiet", "s", "development.build_started", "info"));
    expect(await snaps.list("s")).toEqual([]);
  });

  it("keeps a trace of every event, morph or no morph", async () => {
    const rt = new SessionRuntime(now, new InMemoryEventLogStore(), new InMemorySnapshotStore());
    await rt.ingest(ev("e1"));
    await rt.ingest(ev("e2", "s", "development.build_started", "info"));
    const traces = rt.traces.list("s");
    expect(traces).toHaveLength(2);
    expect(traces[0]).toMatchObject({ eventId: "e1", morphApplied: true, deliberated: true });
    expect(traces[1]).toMatchObject({ eventId: "e2", morphApplied: false });
    expect(traces[0]?.capabilityIds.length).toBeGreaterThan(0);
  });

  it("keeps one session's events and traces out of another's", async () => {
    const rt = new SessionRuntime(now, new InMemoryEventLogStore(), new InMemorySnapshotStore());
    await rt.ingest(ev("e1", "mine"));
    await rt.ingest(ev("e2", "theirs"));
    expect(rt.store.listBySession("mine").map((e) => e.id)).toEqual(["e1"]);
    expect(rt.traces.list("theirs").map((t) => t.eventId)).toEqual(["e2"]);
    expect(rt.audit.list("mine").every((a) => a.sessionId === "mine")).toBe(true);
  });
});

describe("picking a session back up", () => {
  it("has nothing to restore for a session nobody ever ran, and does not invent one", async () => {
    const rt = new SessionRuntime(now, new InMemoryEventLogStore(), new InMemorySnapshotStore());
    expect(await rt.resume("never-existed")).toBeNull();
    expect(rt.core.hasSession("never-existed")).toBe(false);
  });

  it("has nothing to restore when there is no snapshot store", async () => {
    expect(await new SessionRuntime(now).resume("s")).toBeNull();
  });

  it("brings back the body and the world, and tells the client both", async () => {
    const snaps = new InMemorySnapshotStore();
    await new SessionRuntime(now, new InMemoryEventLogStore(), snaps).ingest(ev("e1", "real"));

    const restarted = new SessionRuntime(now, new InMemoryEventLogStore(), snaps);
    const kinds: string[] = [];
    restarted.onMessage((m) => kinds.push(m.kind));

    const blueprint = await restarted.resume("real");
    expect(blueprint).not.toBeNull();
    expect(JSON.stringify(blueprint)).toContain("incident");
    expect(restarted.peekWorld("real").activeProblems).toHaveLength(1);
    expect(kinds).toEqual(["world_state_changed", "ui_patch"]);
  });

  it("does not offer an undo that would target a tree from before the restart", async () => {
    const snaps = new InMemorySnapshotStore();
    await new SessionRuntime(now, new InMemoryEventLogStore(), snaps).ingest(ev("e1", "real"));
    const restarted = new SessionRuntime(now, new InMemoryEventLogStore(), snaps);
    await restarted.resume("real");
    expect(restarted.core.canUndo("real")).toBe(false);
    expect(restarted.undo("real")).toBeNull();
  });

  it("brings back what was learned even when there is no body to restore", async () => {
    const snaps = new InMemorySnapshotStore();
    await snaps.save({ sessionId: "mem", kind: "memory", at: NOW, data: { preferences: [{ key: "dismissed:augment:stuck", weight: 3 }] } });
    const rt = new SessionRuntime(now, new InMemoryEventLogStore(), snaps);
    expect(await rt.resume("mem")).toBeNull();
    expect(rt.core.exportMemory("mem").preferences).toEqual([{ key: "dismissed:augment:stuck", weight: 3 }]);
  });
});

describe("undo and redo over the same runtime", () => {
  it("hands the change back and tells the client", async () => {
    const rt = new SessionRuntime(now, new InMemoryEventLogStore(), new InMemorySnapshotStore());
    await rt.ingest(ev("e1", "u"));
    const kinds: string[] = [];
    rt.onMessage((m) => kinds.push(m.kind));

    expect(rt.undo("u")).not.toBeNull();
    expect(kinds).toContain("ui_patch");
    expect(JSON.stringify(rt.peekUI("u"))).not.toContain('"incident"');

    expect(rt.redo("u")).not.toBeNull();
    expect(JSON.stringify(rt.peekUI("u"))).toContain('"incident"');
  });

  it("says no for a session it does not have, without creating one", () => {
    const rt = new SessionRuntime(now);
    expect(rt.undo("nobody")).toBeNull();
    expect(rt.redo("nobody")).toBeNull();
    expect(rt.core.hasSession("nobody")).toBe(false);
  });
});

describe("the clock the runtime runs on", () => {
  it("falls back to real time rather than freezing cooldowns on an unreadable clock", async () => {
    // every guard comparison is against the ms clock; NaN would make all of them false
    const spy = vi.spyOn(Date, "now");
    const rt = new SessionRuntime(() => "not a timestamp at all");
    const { result } = await rt.ingest(ev("e1")); // the event carries its own valid timestamp
    expect(result.morph.applied).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("reports the autonomy level it was set to", () => {
    const rt = new SessionRuntime(now);
    expect(rt.getAutonomy()).toBe(2);
    rt.setAutonomy(4);
    expect(rt.getAutonomy()).toBe(4);
    rt.setAutonomy(0);
    expect(rt.getAutonomy()).toBe(0);
  });
});
