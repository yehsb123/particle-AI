import { describe, it, expect } from "vitest";
import { emptyWorldState, type WorldState } from "@particle/contracts";
import { builtinCapabilities } from "./builtins";
import type { Capability, CapabilityContext } from "./types";

/**
 * These are the runtime's own hands. What each one returns is bound straight into components, so
 * the shape of the output is a contract with the renderer: a table binding needs rows, a template
 * binding needs an id and params. And every one of them has to answer sensibly with no world
 * state at all, which is what a fresh session looks like.
 */
const T = "2026-09-04T00:00:00Z";
const ctx = (worldState?: WorldState): CapabilityContext => ({ sessionId: "s", now: T, worldState });

const byId = (memory?: Map<string, unknown>) => new Map<string, Capability>(builtinCapabilities(memory).map((c) => [c.manifest.id, c]));
const caps = byId();
const run = async (id: string, input?: unknown, worldState?: WorldState) => {
  const out = await caps.get(id)!.execute(input, ctx(worldState));
  return out.ok ? (out.output as Record<string, unknown>) : undefined;
};

const troubled: WorldState = {
  ...emptyWorldState("s", T),
  activeProblems: [{ id: "p", kind: "runtime_error", summary: "Service returned a runtime error", severity: "critical", openedByEventId: "e", openedAt: T }],
  environment: { processes: [{ name: "API", state: "failed" }], files: ["a.ts", "b.ts", "c.ts", "d.ts"] },
  behavior: {
    ...emptyWorldState("s", T).behavior,
    recentKeys: ["file:a", "file:b", "file:a"],
    recentEntities: ["a.ts", "b.ts"],
    lastActionKey: "file:a",
    repeatCount: 3,
    network: { requests: 10, failures: 2, slow: 1, failingHosts: ["api.example.com"] },
  },
};

describe("every built-in", () => {
  it("declares a risk the permission engine understands", () => {
    for (const c of builtinCapabilities()) {
      expect(["read", "safe_write", "external_effect", "destructive"], c.manifest.id).toContain(c.manifest.risk);
    }
  });

  it("keeps anything that changes the world outside the runtime behind approval", () => {
    const risky = builtinCapabilities().filter((c) => c.manifest.risk !== "read" && c.manifest.risk !== "safe_write");
    expect(risky.map((c) => c.manifest.id).sort()).toEqual(["development.revert_diff", "security.update_dependency"]);
  });

  it("answers without a world state — with a result, or a reason, never an exception", async () => {
    for (const c of builtinCapabilities()) {
      const out = await c.execute(undefined, ctx(undefined));
      if (out.ok) expect(out.output, c.manifest.id).toBeDefined();
      else expect((out.error ?? "").length, c.manifest.id).toBeGreaterThan(0); // memory.store needs a key
    }
  });

  it("answers with input that is the wrong shape entirely", async () => {
    for (const c of builtinCapabilities()) {
      for (const input of ["a string", 42, null, [], true]) {
        const out = await c.execute(input, ctx(troubled));
        expect(typeof out.ok, `${c.manifest.id} ${JSON.stringify(input)}`).toBe("boolean");
      }
    }
  });
});

describe("workspace.get_state — what the context cards are built from", () => {
  it("counts the open problems and names their kinds, never their prose", async () => {
    const out = await run("workspace.get_state", undefined, troubled);
    expect(out?.summary).toContain("1 open problem");
    expect(out?.summaryTpl).toEqual({ id: "tpl_problems_open", params: { n: 1, list: "runtime_error" } });
  });

  it("says the workspace is calm when nothing is open, naming the recent files", async () => {
    const calm: WorldState = { ...emptyWorldState("s", T), environment: { processes: [], files: ["a.ts", "b.ts", "c.ts", "d.ts"] } };
    const out = await run("workspace.get_state", undefined, calm);
    expect(out?.summary).toContain("Nothing broke");
    expect(out?.summaryTpl).toEqual({ id: "tpl_calm_files", params: { files: "b.ts, c.ts, d.ts" } }); // the last three
  });

  it("has a template for the case where there is nothing at all to say", async () => {
    const out = await run("workspace.get_state", undefined, emptyWorldState("s", T));
    expect(out?.summaryTpl).toEqual({ id: "tpl_calm", params: {} });
  });

  it("gives the stuck card the facts behind the inference, as rows", async () => {
    const rows = (await run("workspace.get_state", undefined, troubled))?.stuckRows as string[][];
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.length === 2)).toBe(true);
    expect(rows[0]?.[1]).toContain("file:a");
    expect(rows[0]?.[1]).toContain("3");
    expect(rows[1]?.[1]).toBe("runtime_error");
    expect(rows[2]?.[1]).toBe("a.ts, b.ts");
  });

  it("fills those rows with a dash rather than nothing when there is no history", async () => {
    const rows = (await run("workspace.get_state", undefined, emptyWorldState("s", T)))?.stuckRows as string[][];
    expect(rows[0]?.[1]).toBe("—");
    expect(rows[1]?.[1]).toBe("none");
    expect(rows[2]?.[1]).toBe("—");
  });

  it("lists the places someone keeps moving between, without repeating one", async () => {
    const out = await run("workspace.get_state", undefined, troubled);
    expect(out?.jugglingTpl).toEqual({ id: "tpl_juggling", params: { places: "`file:a` · `file:b`" } });
    expect(String(out?.juggling)).toContain("file:a");
  });

  it("has something to say even when nobody has moved anywhere", async () => {
    const out = await run("workspace.get_state", undefined, emptyWorldState("s", T));
    expect(out?.jugglingTpl).toEqual({ id: "tpl_juggling_none", params: {} });
  });
});

describe("reading the state of things", () => {
  it("reports the processes the world knows about", async () => {
    expect(await run("system.get_status", undefined, troubled)).toEqual({ processes: [{ name: "API", state: "failed" }] });
    expect(await run("system.get_status", undefined, emptyWorldState("s", T))).toEqual({ processes: [] });
  });

  it("shows log lines while something is open, and says so plainly when nothing is", async () => {
    expect(String((await run("development.read_logs", undefined, troubled))?.lines)).toContain("500");
    expect(await run("development.read_logs", undefined, emptyWorldState("s", T))).toEqual({ lines: ["no recent errors"] });
  });

  it("reads build and test state from the problems that are open", async () => {
    const build: WorldState = { ...troubled, activeProblems: [{ ...troubled.activeProblems[0]!, kind: "build_failure" }] };
    const tests: WorldState = { ...troubled, activeProblems: [{ ...troubled.activeProblems[0]!, kind: "test_failure" }] };
    expect(await run("development.read_build_state", undefined, build)).toEqual({ state: "failing" });
    expect(await run("development.read_build_state", undefined, tests)).toEqual({ state: "passing" });
    expect(await run("development.read_test_state", undefined, tests)).toEqual({ state: "failing" });
    expect(await run("development.read_test_state", undefined, build)).toEqual({ state: "passing" });
  });

  it("reports traffic as counts and hosts, with a table the UI can bind to", async () => {
    expect(await run("network.inspect_shape", undefined, troubled)).toEqual({
      requests: 10,
      failures: 2,
      slow: 1,
      failingHosts: ["api.example.com"],
      rows: [["api.example.com", "failing"]],
    });
  });

  it("reports empty traffic rather than nothing when there is no world state", async () => {
    expect(await run("network.inspect_shape", undefined, undefined)).toEqual({ requests: 0, failures: 0, slow: 0, failingHosts: [], rows: [] });
  });

  it("returns the dependency scan as both a list and a table", async () => {
    const out = await run("security.scan_dependencies", undefined, troubled);
    expect((out?.vulnerable as unknown[]).length).toBe(1);
    expect((out?.rows as string[][])[0]).toHaveLength(3);
  });

  it("echoes what it was asked to inspect, and null when it was asked nothing", async () => {
    expect(await run("data.inspect", { a: 1 }, troubled)).toEqual({ inspected: { a: 1 } });
    expect(await run("data.inspect", undefined, troubled)).toEqual({ inspected: null });
  });

  it("takes a component to focus, and shrugs at input that has none", async () => {
    expect(await run("ui.focus_component", { componentId: "incident" }, troubled)).toEqual({ focus: "incident" });
    expect(await run("ui.focus_component", "nonsense", troubled)).toEqual({ focus: null });
    expect(await run("ui.focus_component", undefined, troubled)).toEqual({ focus: null });
  });
});

describe("the two that change something outside", () => {
  it("names what it reverted, falling back to a description rather than a guess", async () => {
    expect(await run("development.revert_diff", { target: "abc123" }, troubled)).toEqual({ reverted: true, target: "abc123" });
    expect(await run("development.revert_diff", undefined, troubled)).toEqual({ reverted: true, target: "recent diff" });
  });

  it("names the package and version it updated", async () => {
    expect(await run("security.update_dependency", { pkg: "left-pad", to: "1.3.0" }, troubled)).toEqual({ updated: "left-pad@1.3.0" });
    expect(await run("security.update_dependency", undefined, troubled)).toEqual({ updated: "lodash@4.17.21" });
  });
});

describe("memory", () => {
  it("stores under a key and finds it again", async () => {
    const memory = new Map<string, unknown>();
    const m = byId(memory);
    expect(await m.get("memory.store")!.execute({ key: "note", value: 42 }, ctx())).toEqual({ ok: true, output: { stored: "note" } });
    expect(memory.get("note")).toBe(42);
    expect(await m.get("memory.search")!.execute({ query: "not" }, ctx())).toEqual({ ok: true, output: { hits: [{ key: "note", value: 42 }] } });
  });

  it("refuses to store without a key, as a failure rather than an exception", async () => {
    const m = byId(new Map());
    const out = await m.get("memory.store")!.execute({ value: 1 }, ctx());
    expect(out).toEqual({ ok: false, error: "memory.store requires a key" });
  });

  it("finds nothing for a query that matches nothing, and everything for no query", async () => {
    const memory = new Map<string, unknown>([["a", 1], ["b", 2]]);
    const m = byId(memory);
    expect(await m.get("memory.search")!.execute({ query: "zzz" }, ctx())).toEqual({ ok: true, output: { hits: [] } });
    const all = await m.get("memory.search")!.execute({ query: "" }, ctx());
    expect(all.ok).toBe(true);
    expect((all.output as { hits: unknown[] }).hits).toHaveLength(2);
  });

  it("does not care about case when searching", async () => {
    const m = byId(new Map<string, unknown>([["MixedCase", 1]]));
    const out = await m.get("memory.search")!.execute({ query: "mixedcase" }, ctx());
    expect(out.ok && (out.output as { hits: unknown[] }).hits).toHaveLength(1);
  });

  it("keeps a key named after a language feature in the map, where it cannot do harm", async () => {
    const memory = new Map<string, unknown>();
    const m = byId(memory);
    await m.get("memory.store")!.execute({ key: "__proto__", value: "x" }, ctx());
    expect(memory.get("__proto__")).toBe("x");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
