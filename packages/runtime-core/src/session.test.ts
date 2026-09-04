import { describe, it, expect } from "vitest";
import { createRuntimeCore } from "./factory";
import { RuntimeCore, resolvePatchBindings } from "./index";
import type { MatterEvent, UIPatch } from "@particle/contracts";

/**
 * Anything can name a session id — a URL someone typed, a stale tab, a script. So the two rules
 * that keep the runtime safe under that are: a read never creates a session (or the cheapest GET
 * would evict live ones), and the table of sessions is bounded. The other half of this file is
 * data binding, where the model chooses both the capability field to read and the prop to write.
 */
function makeClock() {
  let n = 0;
  return { iso: () => `2026-09-04T00:00:${String(n % 60).padStart(2, "0")}Z`, ms: () => (++n) * 10_000 };
}

const ev = (sessionId: string, type = "development.server_error", severity: MatterEvent["severity"] = "critical", id = "e1"): MatterEvent => ({
  id, sessionId, timestamp: "2026-09-04T00:00:00Z", source: "development", type, severity, payload: {},
});

describe("reads never create a session", () => {
  it("answers every read for an id it has never seen without keeping it", () => {
    const core = createRuntimeCore(makeClock());
    expect(core.peekWorld("ghost").sessionId).toBe("ghost");
    expect(core.peekBlueprint("ghost").root.id).toBeDefined();
    expect(core.canUndo("ghost")).toBe(false);
    expect(core.canRedo("ghost")).toBe(false);
    expect(core.historyDepth("ghost")).toBe(0);
    expect(core.peekRedo("ghost")).toBeNull();
    expect(core.hasSession("ghost")).toBe(false);
    expect(core.undo("ghost")).toBeNull();
    expect(core.redo("ghost")).toBeNull();
    expect(core.listSessions()).toEqual([]);
  });

  it("does not move a session up the queue just for being read", () => {
    const core = createRuntimeCore(makeClock());
    core.getWorld("a");
    core.getWorld("b");
    core.peekWorld("a");
    core.canUndo("a");
    expect(core.listSessions().map((s) => s.sessionId)).toEqual(["a", "b"]);
  });

  it("gives a peek at an unknown session the same shape a real one starts with", () => {
    const core = createRuntimeCore(makeClock());
    const peeked = core.peekWorld("ghost");
    expect(peeked.activeProblems).toEqual([]);
    expect(peeked.autonomy.level).toBe(2);
    expect(core.peekBlueprint("ghost").mode).toBe("development");
    expect(core.hasSession("ghost")).toBe(false);
  });
});

describe("the session table is bounded", () => {
  it("holds at most MAX_SESSIONS and drops the least recently used", () => {
    const core = createRuntimeCore(makeClock());
    for (let i = 0; i < RuntimeCore.MAX_SESSIONS + 20; i += 1) core.getWorld(`s${i}`);
    expect(core.listSessions()).toHaveLength(RuntimeCore.MAX_SESSIONS);
    expect(core.hasSession("s0")).toBe(false);
    expect(core.hasSession(`s${RuntimeCore.MAX_SESSIONS + 19}`)).toBe(true);
  });

  it("spares a session that is still being used", () => {
    const core = createRuntimeCore(makeClock());
    for (let i = 0; i < RuntimeCore.MAX_SESSIONS; i += 1) core.getWorld(`s${i}`);
    core.getWorld("s0"); // touched, so it is no longer the oldest
    core.getWorld("newcomer");
    expect(core.hasSession("s0")).toBe(true);
    expect(core.hasSession("s1")).toBe(false);
    expect(core.listSessions()).toHaveLength(RuntimeCore.MAX_SESSIONS);
  });

  it("keeps each session's world and memory to itself", async () => {
    const core = createRuntimeCore(makeClock());
    await core.ingest(ev("mine"));
    expect(core.getWorld("mine").activeProblems.length).toBe(1);
    expect(core.peekWorld("theirs").activeProblems).toEqual([]);
    expect(core.exportMemory("theirs").preferences).toEqual([]);
  });

  it("summarises live sessions at the level of shape, and creates none while doing it", async () => {
    const core = createRuntimeCore(makeClock());
    await core.ingest(ev("a"));
    const listed = core.listSessions();
    expect(listed.map((s) => s.sessionId)).toEqual(["a"]);
    expect(listed[0]?.problems).toBe(1);
    expect(Array.isArray(listed[0]?.layers)).toBe(true);
    expect(core.listSessions()).toHaveLength(1);
  });
});

describe("hydrate and the history that belonged to the old tree", () => {
  it("drops undo, redo and the morph timers when a different body is loaded", async () => {
    const core = createRuntimeCore(makeClock());
    await core.ingest(ev("h"));
    expect(core.canUndo("h")).toBe(true);
    core.undo("h");
    expect(core.canRedo("h")).toBe(true);

    core.hydrate("h", { blueprint: core.getBlueprint("h") });
    expect(core.canUndo("h")).toBe(false);
    expect(core.canRedo("h")).toBe(false);
    expect(core.historyDepth("h")).toBe(0);
    expect(core.redo("h")).toBeNull();
    expect(core.undo("h")).toBeNull();
  });

  it("takes a world without touching the body, and a body without touching the world", async () => {
    const core = createRuntimeCore(makeClock());
    await core.ingest(ev("h2"));
    const world = core.getWorld("h2");
    const body = core.getBlueprint("h2");

    const fresh = createRuntimeCore(makeClock());
    fresh.hydrate("h2", { world });
    expect(fresh.getWorld("h2").activeProblems).toHaveLength(1);
    expect(fresh.canUndo("h2")).toBe(false);

    const other = createRuntimeCore(makeClock());
    other.hydrate("h2", { blueprint: body });
    expect(other.getBlueprint("h2")).toEqual(body);
    expect(other.getWorld("h2").activeProblems).toEqual([]);
  });

  it("takes an empty hydrate as nothing to do", async () => {
    const core = createRuntimeCore(makeClock());
    await core.ingest(ev("h3"));
    const before = core.getBlueprint("h3");
    core.hydrate("h3", {});
    expect(core.getBlueprint("h3")).toEqual(before);
    expect(core.canUndo("h3")).toBe(true);
  });
});

describe("importing what a previous run learned", () => {
  it("ignores an absent or empty snapshot instead of failing", () => {
    const core = createRuntimeCore(makeClock());
    for (const memory of [null, undefined, {}, { preferences: [] }, { patterns: [] }]) {
      expect(() => core.importMemory("m", memory)).not.toThrow();
    }
    expect(core.exportMemory("m").preferences).toEqual([]);
  });

  it("restores preferences and patterns, and hands them back on export", () => {
    const core = createRuntimeCore(makeClock());
    core.importMemory("m", {
      preferences: [{ key: "dismissed:augment:stuck", weight: 2 }],
      patterns: [{ key: "development.server_error->surface_incident", count: 4, firstSeen: "t", lastSeen: "t", suggested: true }],
    });
    const out = core.exportMemory("m");
    expect(out.preferences).toEqual([{ key: "dismissed:augment:stuck", weight: 2 }]);
    expect(out.patterns[0]).toMatchObject({ count: 4, suggested: true });
  });

  it("never lowers what this run already learned", async () => {
    const core = createRuntimeCore(makeClock());
    core.memoryFor("m").preferences.reinforce("dismissed:augment:stuck", 5);
    core.importMemory("m", { preferences: [{ key: "dismissed:augment:stuck", weight: 1 }] });
    expect(core.memoryFor("m").preferences.weightOf("dismissed:augment:stuck")).toBe(5);
  });
});

describe("ingests on one session take turns", () => {
  it("serialises concurrent events rather than interleaving shared state", async () => {
    const core = createRuntimeCore(makeClock());
    const results = await Promise.all([
      core.ingest(ev("c", "development.server_error", "critical", "a")),
      core.ingest(ev("c", "development.server_error", "critical", "b")),
      core.ingest(ev("c", "development.server_recovered", "info", "c")),
    ]);
    expect(results).toHaveLength(3);
    expect(core.getWorld("c").activeProblems).toEqual([]);
    expect(core.historyDepth("c")).toBeGreaterThan(0);
  });

  it("keeps taking events after one is refused", async () => {
    const core = createRuntimeCore(makeClock());
    await expect(core.ingest({ ...ev("q"), severity: "not a severity" } as unknown as MatterEvent)).rejects.toThrow();
    const after = await core.ingest(ev("q", "development.server_error", "critical", "ok"));
    expect(after.deliberated).toBe(true);
  });
});

describe("data bindings — the model picks the field and the prop", () => {
  const patch = (bindings: { prop: string; source: string }[]): UIPatch => ({
    patchId: "p",
    fromWorkspaceId: "ws",
    operations: [{ op: "add", parentId: "root", component: { id: "t", type: "Table", bindings } }],
  });
  const propsAfter = (bindings: { prop: string; source: string }[], lookup: Map<string, unknown>) => {
    const op = resolvePatchBindings(patch(bindings), lookup).operations[0];
    return op?.op === "add" ? op.component.props : undefined;
  };

  it("fills a bound prop from a capability's output", () => {
    expect(propsAfter([{ prop: "rows", source: "capability:dev.read_logs:lines" }], new Map([["dev.read_logs", { lines: [1, 2] }]]))).toEqual({ rows: [1, 2] });
  });

  it("binds a value that is falsy but real, and leaves the prop alone when the field is absent", () => {
    expect(propsAfter([{ prop: "rows", source: "capability:c:v" }], new Map([["c", { v: null }]]))).toEqual({ rows: null });
    expect(propsAfter([{ prop: "rows", source: "capability:c:v" }], new Map([["c", { v: false }]]))).toEqual({ rows: false });
    expect(propsAfter([{ prop: "rows", source: "capability:c:v" }], new Map([["c", { v: 0 }]]))).toEqual({ rows: 0 });
    expect(propsAfter([{ prop: "rows", source: "capability:c:v" }], new Map([["c", { v: undefined }]]))).toBeUndefined();
  });

  it("reads only the capability's own fields", () => {
    // asking for `toString` used to hand back a function off the prototype and put it in props
    for (const field of ["toString", "constructor", "hasOwnProperty", "valueOf"]) {
      expect(propsAfter([{ prop: "rows", source: `capability:c:${field}` }], new Map([["c", { v: 1 }]])), field).toBeUndefined();
    }
  });

  it("refuses to bind a prop named after a language feature", () => {
    for (const prop of ["__proto__", "constructor", "prototype"]) {
      expect(propsAfter([{ prop, source: "capability:c:v" }], new Map([["c", { v: "x" }]])), prop).toBeUndefined();
    }
  });

  it("says nothing when the capability did not run, or answered with something that is not a record", () => {
    expect(propsAfter([{ prop: "rows", source: "capability:missing:v" }], new Map())).toBeUndefined();
    expect(propsAfter([{ prop: "rows", source: "capability:c:length" }], new Map([["c", "a string"]]))).toBeUndefined();
    expect(propsAfter([{ prop: "rows", source: "capability:c:v" }], new Map([["c", null]]))).toBeUndefined();
    expect(propsAfter([{ prop: "rows", source: "capability:c:v" }], new Map([["c", 42]]))).toBeUndefined();
  });

  it("ignores a source that is not a capability reference", () => {
    for (const source of ["garbage", "capability:", "capability:c:", "http://elsewhere/x", ""]) {
      expect(propsAfter([{ prop: "rows", source }], new Map([["c", { v: 1 }]])), source).toBeUndefined();
    }
  });

  it("takes the rest of a source as the field, colons and all", () => {
    expect(propsAfter([{ prop: "rows", source: "capability:c:a:b" }], new Map([["c", { "a:b": "nested" }]]))).toEqual({ rows: "nested" });
  });

  it("reaches bound components nested anywhere in the added subtree", () => {
    const nested: UIPatch = {
      patchId: "p",
      fromWorkspaceId: "ws",
      operations: [{
        op: "add",
        parentId: "root",
        component: { id: "s", type: "Stack", children: [{ id: "deep", type: "Table", bindings: [{ prop: "rows", source: "capability:c:v" }] }] },
      }],
    };
    const op = resolvePatchBindings(nested, new Map([["c", { v: 7 }]])).operations[0];
    expect(op?.op === "add" ? op.component.children?.[0]?.props : undefined).toEqual({ rows: 7 });
  });

  it("leaves the patch it was given untouched", () => {
    const original = patch([{ prop: "rows", source: "capability:c:v" }]);
    const before = JSON.stringify(original);
    resolvePatchBindings(original, new Map([["c", { v: 1 }]]));
    expect(JSON.stringify(original)).toBe(before);
  });

  it("keeps props the patch already set, overwriting only the bound one", () => {
    const withProps: UIPatch = {
      patchId: "p",
      fromWorkspaceId: "ws",
      operations: [{ op: "add", parentId: "root", component: { id: "t", type: "Table", props: { title: "Logs", rows: [] }, bindings: [{ prop: "rows", source: "capability:c:v" }] } }],
    };
    const op = resolvePatchBindings(withProps, new Map([["c", { v: ["live"] }]])).operations[0];
    expect(op?.op === "add" ? op.component.props : undefined).toEqual({ title: "Logs", rows: ["live"] });
  });
});
