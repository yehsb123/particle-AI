import { describe, it, expect } from "vitest";
import { InMemoryEventLogStore, InMemorySnapshotStore, createPersistence, type Snapshot } from "./index";
import type { MatterEvent } from "@particle/contracts";

/**
 * Resume reads these stores back after a restart: it takes the newest snapshot of each kind by
 * walking the list from the end. It reads exactly one of each kind, and the store used to keep
 * every one ever written — three per ingest — so a single busy session filled it and pushed out
 * the snapshots of every quiet session beside it, which then resumed to nothing. What the store
 * keeps is now what a resume reads: the latest of each kind, per session. That contract, and the
 * bounds that keep a long run from growing forever, are what this file pins.
 */
const ev = (id: string, sessionId: string, over: Partial<MatterEvent> = {}): MatterEvent => ({
  id,
  sessionId,
  timestamp: "2026-09-03T00:00:00Z",
  source: "development",
  type: "development.build_started",
  severity: "info",
  payload: {},
  ...over,
});

const snap = (sessionId: string, kind: string, at: string, data: unknown = {}): Snapshot => ({ sessionId, kind, at, data });
const newest = (snaps: Snapshot[], kind: string) => [...snaps].reverse().find((s) => s.kind === kind);

describe("InMemoryEventLogStore", () => {
  it("keeps arrival order and separates sessions", async () => {
    const store = new InMemoryEventLogStore();
    for (const [id, s] of [["a", "s1"], ["b", "s2"], ["c", "s1"]] as const) await store.append(ev(id, s));
    expect((await store.all()).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect((await store.listBySession("s1")).map((e) => e.id)).toEqual(["a", "c"]);
    expect(await store.listBySession("s3")).toEqual([]);
  });

  it("drops the oldest events at its bound, in order", async () => {
    const store = new InMemoryEventLogStore(2);
    await store.append(ev("a", "s1"));
    await store.append(ev("b", "s1"));
    await store.append(ev("c", "s2"));
    expect((await store.all()).map((e) => e.id)).toEqual(["b", "c"]);
    expect((await store.listBySession("s1")).map((e) => e.id)).toEqual(["b"]);
  });

  it("stays at its bound over a long run", async () => {
    const store = new InMemoryEventLogStore(20);
    for (let i = 0; i < 200; i += 1) await store.append(ev(`e${i}`, "s1"));
    const all = await store.all();
    expect(all).toHaveLength(20);
    expect(all[0]?.id).toBe("e180");
    expect(all.at(-1)?.id).toBe("e199");
  });

  it("hands back a copy, so a reader cannot append through the returned list", async () => {
    const store = new InMemoryEventLogStore();
    await store.append(ev("a", "s1"));
    (await store.all()).push(ev("forged", "s1"));
    expect(await store.all()).toHaveLength(1);
  });

  it("takes a duplicate id without losing the earlier record", async () => {
    // the log is append-only; de-duplication is the durable backend's job, not a silent drop here
    const store = new InMemoryEventLogStore();
    await store.append(ev("a", "s1", { type: "first" }));
    await store.append(ev("a", "s1", { type: "second" }));
    expect((await store.listBySession("s1")).map((e) => e.type)).toEqual(["first", "second"]);
  });
});

describe("InMemorySnapshotStore", () => {
  it("keeps the latest of each kind, in the order they were taken", async () => {
    const store = new InMemorySnapshotStore();
    await store.save(snap("s1", "ui", "t1"));
    await store.save(snap("s1", "world", "t2"));
    await store.save(snap("s1", "ui", "t3"));
    // the first body snapshot is gone: a resume would never have read it
    expect((await store.list("s1")).map((s) => s.at)).toEqual(["t2", "t3"]);
    expect(newest(await store.list("s1"), "ui")?.at).toBe("t3");
    expect(newest(await store.list("s1"), "world")?.at).toBe("t2");
    expect(newest(await store.list("s1"), "memory")).toBeUndefined();
  });

  it("holds one snapshot per kind, however long a session runs", async () => {
    const store = new InMemorySnapshotStore();
    for (let i = 0; i < 500; i++) {
      for (const kind of ["ui", "world", "memory"]) await store.save(snap("s1", kind, `t${i}`));
    }
    const list = await store.list("s1");
    expect(list).toHaveLength(3);
    expect(new Set(list.map((s) => s.kind)).size).toBe(3);
    for (const kind of ["ui", "world", "memory"]) expect(newest(list, kind)?.at, kind).toBe("t499");
  });

  it("filters by kind, and a kind nobody saved is nothing", async () => {
    const store = new InMemorySnapshotStore();
    for (const at of ["t1", "t2", "t3"]) {
      await store.save(snap("s1", "ui", at));
      await store.save(snap("s1", "memory", at));
    }
    expect((await store.list("s1", "ui")).map((s) => s.at)).toEqual(["t3"]);
    expect(await store.list("s1", "memory")).toHaveLength(1);
    expect(await store.list("s1", "nothing-of-this-kind")).toEqual([]);
  });

  it("never shows one session's snapshots to another", async () => {
    const store = new InMemorySnapshotStore();
    await store.save(snap("mine", "ui", "t1", { secret: true }));
    await store.save(snap("theirs", "ui", "t1"));
    expect(await store.list("theirs")).toHaveLength(1);
    expect((await store.list("theirs"))[0]?.data).toEqual({});
    expect(await store.list("")).toEqual([]);
  });

  it("forgets the session that went quiet longest, never the one still being written to", async () => {
    // the bound counts sessions now, because writes no longer accumulate: a busy session used to
    // evict a quiet one entirely, and that session resumed to nothing having done nothing wrong
    const store = new InMemorySnapshotStore(3);
    for (const session of ["a", "b", "c"]) await store.save(snap(session, "ui", "t1"));
    await store.save(snap("a", "ui", "t2")); // a is written to again, so b is now the quietest
    await store.save(snap("d", "ui", "t1"));

    expect(await store.list("b")).toEqual([]);
    for (const session of ["a", "c", "d"]) expect((await store.list(session)).length, session).toBe(1);
    expect(newest(await store.list("a"), "ui")?.at).toBe("t2");
  });

  it("lets a busy session run without emptying a quiet one", async () => {
    const store = new InMemorySnapshotStore(500);
    for (const kind of ["ui", "world", "memory"]) await store.save(snap("quiet", kind, "t0"));
    for (let i = 0; i < 2_000; i++) {
      for (const kind of ["ui", "world", "memory"]) await store.save(snap("busy", kind, `t${i}`));
    }
    expect(await store.list("quiet")).toHaveLength(3);
    expect(newest(await store.list("quiet"), "ui")?.at).toBe("t0");
  });

  it("keeps whatever the runtime put in a snapshot, untouched", async () => {
    const store = new InMemorySnapshotStore();
    const blueprint = { schemaVersion: "1.0.0", root: { id: "root", type: "Stack", children: [] } };
    await store.save(snap("s1", "ui", "t1", blueprint));
    expect((await store.list("s1", "ui"))[0]?.data).toEqual(blueprint);
  });
});

describe("createPersistence", () => {
  it("uses the in-memory stores when there is no database url", async () => {
    const p = await createPersistence();
    expect(p.backend).toBe("memory");
    await p.events.append(ev("a", "s1"));
    await p.snapshots.save(snap("s1", "ui", "t1"));
    expect(await p.events.listBySession("s1")).toHaveLength(1);
    expect(await p.snapshots.list("s1")).toHaveLength(1);
    await expect(p.close()).resolves.toBeUndefined();
  });

  it("treats an empty url as no url, rather than trying to connect to nothing", async () => {
    expect((await createPersistence("")).backend).toBe("memory");
  });

  it("closes cleanly more than once", async () => {
    const p = await createPersistence();
    await p.close();
    await expect(p.close()).resolves.toBeUndefined();
  });

  it("gives each call its own stores, so two sessions cannot see each other's log", async () => {
    const a = await createPersistence();
    const b = await createPersistence();
    await a.events.append(ev("a", "s1"));
    expect(await b.events.all()).toEqual([]);
  });
});
