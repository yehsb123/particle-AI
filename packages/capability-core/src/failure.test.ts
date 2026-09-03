import { describe, it, expect } from "vitest";
import type { CapabilityManifest } from "@particle/contracts";
import { CapabilityRegistry } from "./registry";
import { CapabilityExecutor } from "./executor";
import { builtinCapabilities } from "./builtins";
import type { Capability, CapabilityContext } from "./types";

/**
 * Capabilities are the AI's hands, and they run unattended. What matters most is what happens
 * when one of them misbehaves: a throwing, hanging or missing capability must become an audited
 * failure, never an exception that takes the runtime down or a plan that silently stops halfway.
 */
const NOW = "2026-09-03T00:00:00Z";
const ctx = (over: Partial<CapabilityContext> = {}): CapabilityContext => ({ sessionId: "s", now: NOW, ...over });

const manifest = (id: string): CapabilityManifest => ({
  id, name: id, description: "", risk: "read", tags: [], latencyClass: "instant", costClass: "free", requiredPermissions: [],
});
const cap = (id: string, run: (input: unknown, c: CapabilityContext) => unknown): Capability => ({
  manifest: manifest(id),
  async execute(input, c) {
    return { ok: true, output: run(input, c) };
  },
});

function setup(...caps: Capability[]) {
  const registry = new CapabilityRegistry();
  registry.registerAll(caps);
  return { registry, executor: new CapabilityExecutor(registry, () => NOW) };
}

describe("capability failures become audited results, not crashes", () => {
  it("turns a thrown error into ok:false with the message, and records the run", async () => {
    const { executor } = setup({
      manifest: manifest("boom"),
      async execute() {
        throw new Error("disk on fire");
      },
    });
    const out = await executor.execute("boom", {}, ctx());
    expect(out.result).toEqual({ ok: false, error: "disk on fire" });
    expect(out.run.ok).toBe(false);
    expect(out.run.error).toBe("disk on fire");
    expect(out.run.startedAt).toBe(NOW);
    expect(out.run.finishedAt).toBe(NOW);
  });

  it("turns a rejected promise and a non-Error throw into a failure too", async () => {
    const { executor } = setup(
      { manifest: manifest("reject"), execute: () => Promise.reject(new Error("nope")) },
      { manifest: manifest("weird"), async execute() { throw "just a string"; } },
    );
    expect((await executor.execute("reject", {}, ctx())).result.ok).toBe(false);
    const weird = await executor.execute("weird", {}, ctx());
    expect(weird.result.ok).toBe(false); // a non-Error throw still becomes a result
    expect(weird.run.ok).toBe(false);
  });

  it("reports a missing capability without touching the registry's other entries", async () => {
    const { registry, executor } = setup(cap("known", () => 1));
    const out = await executor.execute("does.not.exist", {}, ctx());
    expect(out.result.ok).toBe(false);
    expect(out.result.error).toContain("does.not.exist");
    expect(out.run.error).toBe("unknown_capability");
    expect(registry.has("known")).toBe(true);
    expect(registry.riskOf("does.not.exist")).toBeUndefined();
  });

  it("gives every run its own id, so the audit trail can tell two failures apart", async () => {
    const { executor } = setup();
    const a = await executor.execute("x", {}, ctx());
    const b = await executor.execute("x", {}, ctx());
    expect(a.run.id).not.toBe(b.run.id);
  });
});

describe("plans keep going and stay in order", () => {
  it("runs every step in order even when one fails in the middle", async () => {
    const order: string[] = [];
    const { executor } = setup(
      cap("first", () => { order.push("first"); return 1; }),
      { manifest: manifest("middle"), async execute() { order.push("middle"); throw new Error("x"); } },
      cap("last", () => { order.push("last"); return 3; }),
    );
    const out = await executor.executeMany(
      [{ capabilityId: "first" }, { capabilityId: "middle" }, { capabilityId: "missing" }, { capabilityId: "last" }],
      ctx(),
    );
    expect(order).toEqual(["first", "middle", "last"]); // the failure did not abort the plan
    expect(out.map((o) => o.result.ok)).toEqual([true, false, false, true]);
    expect(out.map((o) => o.capabilityId)).toEqual(["first", "middle", "missing", "last"]);
  });

  it("an empty plan runs nothing and returns nothing", async () => {
    const { executor } = setup(cap("a", () => 1));
    expect(await executor.executeMany([], ctx())).toEqual([]);
  });

  it("passes the input through untouched, and undefined when a step has none", async () => {
    const seen: unknown[] = [];
    const { executor } = setup(cap("echo", (input) => { seen.push(input); return input; }));
    await executor.executeMany([{ capabilityId: "echo", input: { a: 1 } }, { capabilityId: "echo" }], ctx());
    expect(seen).toEqual([{ a: 1 }, undefined]);
  });
});

describe("built-ins survive a thin context", () => {
  it("answers without a world state instead of throwing", async () => {
    const { executor } = setup(...builtinCapabilities());
    for (const id of ["system.get_status", "workspace.get_state", "development.read_logs", "development.read_build_state", "data.inspect", "network.inspect_shape", "security.scan_dependencies"]) {
      const out = await executor.execute(id, {}, ctx()); // no worldState at all
      expect(out.result.ok, id).toBe(true);
      expect(out.result.output, id).toBeDefined();
    }
  });

  it("keeps memory per store instance — two runtimes do not share what they remember", async () => {
    const a = setup(...builtinCapabilities(new Map()));
    const b = setup(...builtinCapabilities(new Map()));
    await a.executor.execute("memory.store", { key: "k", value: "from a" }, ctx());
    expect((await a.executor.execute("memory.search", { key: "k" }, ctx())).result.output).toBeDefined();
    const fromB = await b.executor.execute("memory.search", { key: "k" }, ctx());
    expect(JSON.stringify(fromB.result.output)).not.toContain("from a");
  });

  it("declares a risk for every built-in, so nothing slips past the permission engine", () => {
    const { registry } = setup(...builtinCapabilities());
    const manifests = registry.manifests();
    expect(manifests.length).toBeGreaterThan(5);
    for (const m of manifests) {
      expect(["read", "safe_write", "external_effect", "destructive"], m.id).toContain(m.risk);
      expect(registry.riskOf(m.id)).toBe(m.risk);
    }
  });
});
