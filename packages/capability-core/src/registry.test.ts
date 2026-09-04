import { describe, it, expect } from "vitest";
import type { RiskLevel } from "@particle/contracts";
import { CapabilityExecutor, CapabilityRegistry, builtinCapabilities } from "./index";
import type { Capability, CapabilityContext } from "./types";

/**
 * A capability id is what a decision plans, what the permission engine judges and what an
 * approval answers for. Everything downstream reads it as a name for one particular ability at
 * one particular risk, so the registry's job is to keep that true — and the executor's job is to
 * turn whatever a capability does, including misbehaving, into an auditable run.
 */
const ctx: CapabilityContext = { sessionId: "s", now: "2026-09-04T00:00:00Z" };
const clock = () => "2026-09-04T00:00:00Z";

const cap = (id: string, risk: RiskLevel, run: Capability["execute"]): Capability => ({
  manifest: { id, name: id, description: "", tags: [], risk, latencyClass: "instant", costClass: "free", requiredPermissions: [] },
  execute: run,
});

const ok = (output: unknown): Capability["execute"] => async () => ({ ok: true, output });

describe("an id names one ability", () => {
  it("registers a capability and answers about it", () => {
    const registry = new CapabilityRegistry();
    expect(registry.register(cap("a.read", "read", ok(1)))).toBe(true);
    expect(registry.has("a.read")).toBe(true);
    expect(registry.riskOf("a.read")).toBe("read");
    expect(registry.manifests().map((m) => m.id)).toEqual(["a.read"]);
  });

  it("refuses a second claim on an id rather than replacing what it means", async () => {
    // an id is what an approval answers for; swapping the ability and its risk underneath would
    // change what a person consented to
    const registry = new CapabilityRegistry();
    registry.register(cap("x", "read", ok("first")));
    expect(registry.register(cap("x", "destructive", ok("second")))).toBe(false);
    expect(registry.riskOf("x")).toBe("read");
    expect(await registry.get("x")!.execute({}, ctx)).toEqual({ ok: true, output: "first" });
    expect(registry.manifests()).toHaveLength(1);
  });

  it("says which ids it could not take", () => {
    const registry = new CapabilityRegistry();
    expect(registry.registerAll([cap("a", "read", ok(1)), cap("b", "read", ok(2))])).toEqual([]);
    expect(registry.registerAll([cap("b", "read", ok(3)), cap("c", "read", ok(4))])).toEqual(["b"]);
    expect(registry.manifests().map((m) => m.id)).toEqual(["a", "b", "c"]);
  });

  it("says nothing about an id nobody registered", () => {
    const registry = new CapabilityRegistry();
    expect(registry.get("nope")).toBeUndefined();
    expect(registry.has("nope")).toBe(false);
    expect(registry.riskOf("nope")).toBeUndefined();
    expect(registry.manifests()).toEqual([]);
  });

  it("takes the built-ins as they come, each id once", () => {
    const registry = new CapabilityRegistry();
    expect(registry.registerAll(builtinCapabilities())).toEqual([]);
    const ids = registry.manifests().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(registry.riskOf("development.revert_diff")).toBe("external_effect");
  });
});

describe("every run is auditable", () => {
  const registry = new CapabilityRegistry();
  registry.registerAll([
    cap("works", "read", ok({ lines: [] })),
    cap("fails", "read", async () => ({ ok: false, error: "nothing to read" })),
    cap("throws", "read", async () => {
      throw new Error("boom");
    }),
    cap("throws-bare", "read", async () => {
      throw "a bare string";
    }),
    cap("throws-blank", "read", async () => {
      throw new Error("");
    }),
    cap("rejects", "read", () => Promise.reject(new Error("rejected"))),
    cap("returns-nothing", "read", (async () => undefined) as unknown as Capability["execute"]),
    cap("returns-junk", "read", (async () => "not a result") as unknown as Capability["execute"]),
  ]);
  const executor = new CapabilityExecutor(registry, clock);

  it("records what happened, when, and under which id", async () => {
    const out = await executor.execute("works", { a: 1 }, ctx);
    expect(out.capabilityId).toBe("works");
    expect(out.result).toEqual({ ok: true, output: { lines: [] } });
    expect(out.run).toMatchObject({ capabilityId: "works", ok: true, startedAt: clock(), finishedAt: clock() });
    expect(out.run.id.length).toBeGreaterThan(0);
  });

  it("carries a capability's own refusal through as it is", async () => {
    const out = await executor.execute("fails", {}, ctx);
    expect(out.result).toEqual({ ok: false, error: "nothing to read" });
    expect(out.run.ok).toBe(false);
    expect(out.run.error).toBe("nothing to read");
  });

  it("turns a thrown error into a failed run rather than an exception", async () => {
    for (const [id, error] of [["throws", "boom"], ["rejects", "rejected"], ["throws-bare", "a bare string"]] as [string, string][]) {
      const out = await executor.execute(id, {}, ctx);
      expect(out.result, id).toEqual({ ok: false, error });
      expect(out.run.error, id).toBe(error);
    }
  });

  it("never leaves a failure without a reason", async () => {
    const out = await executor.execute("throws-blank", {}, ctx);
    expect(out.result.ok).toBe(false);
    expect((out.result.error ?? "").length).toBeGreaterThan(0);
    expect(out.result.error).toContain("throws-blank");
  });

  it("names a capability that did not answer, instead of quoting our own type error", async () => {
    for (const id of ["returns-nothing", "returns-junk"]) {
      const out = await executor.execute(id, {}, ctx);
      expect(out.result.ok, id).toBe(false);
      expect(out.result.error, id).toBe(`capability ${id} did not return a result`);
      expect(out.result.error, id).not.toContain("Cannot read");
    }
  });

  it("answers for an id nobody registered without pretending it ran", async () => {
    const out = await executor.execute("nope", {}, ctx);
    expect(out.result).toEqual({ ok: false, error: "unknown capability: nope" });
    expect(out.run.ok).toBe(false);
    expect(out.run.error).toBe("unknown_capability");
  });

  it("gives every run its own id, in order", async () => {
    const fresh = new CapabilityExecutor(registry, clock);
    const runs = await fresh.executeMany([{ capabilityId: "works" }, { capabilityId: "throws" }, { capabilityId: "works" }], ctx);
    expect(runs.map((r) => r.capabilityId)).toEqual(["works", "throws", "works"]);
    expect(new Set(runs.map((r) => r.run.id)).size).toBe(3);
  });

  it("runs a plan in the order it was given, and finishes it despite a failure in the middle", async () => {
    const order: string[] = [];
    const tracking = new CapabilityRegistry();
    tracking.registerAll([
      cap("one", "read", async () => {
        order.push("one");
        return { ok: true };
      }),
      cap("two", "read", async () => {
        order.push("two");
        throw new Error("no");
      }),
      cap("three", "read", async () => {
        order.push("three");
        return { ok: true };
      }),
    ]);
    const out = await new CapabilityExecutor(tracking, clock).executeMany(
      [{ capabilityId: "one" }, { capabilityId: "two" }, { capabilityId: "three" }],
      ctx,
    );
    expect(order).toEqual(["one", "two", "three"]);
    expect(out.map((o) => o.result.ok)).toEqual([true, false, true]);
  });

  it("has nothing to do with an empty plan", async () => {
    expect(await executor.executeMany([], ctx)).toEqual([]);
  });

  it("passes the input and the context through untouched", async () => {
    const seen: { input: unknown; ctx: CapabilityContext }[] = [];
    const spy = new CapabilityRegistry();
    spy.register(cap("spy", "read", async (input, c) => {
      seen.push({ input, ctx: c });
      return { ok: true };
    }));
    await new CapabilityExecutor(spy, clock).execute("spy", { city: "Seoul" }, ctx);
    expect(seen[0]?.input).toEqual({ city: "Seoul" });
    expect(seen[0]?.ctx.sessionId).toBe("s");
  });
});
