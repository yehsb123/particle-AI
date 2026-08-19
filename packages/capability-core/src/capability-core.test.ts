import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "./registry";
import { CapabilityExecutor } from "./executor";
import { builtinCapabilities } from "./builtins";
import { emptyWorldState, type WorldState } from "@dm/contracts";

const T = "2026-08-19T00:00:00Z";
let clockN = 0;
const clock = () => `2026-08-19T00:00:0${clockN++}Z`;

function setup(memory?: Map<string, unknown>) {
  const registry = new CapabilityRegistry();
  registry.registerAll(builtinCapabilities(memory));
  const executor = new CapabilityExecutor(registry, clock);
  return { registry, executor };
}

const worldWithProblem: WorldState = {
  ...emptyWorldState("s", T),
  activeProblems: [{ id: "p", kind: "runtime_error", summary: "x", severity: "critical", openedByEventId: "e", openedAt: T }],
  environment: { processes: [{ name: "API", state: "failed" }] },
};

describe("CapabilityRegistry", () => {
  it("registers built-ins and exposes manifests + risk", () => {
    const { registry } = setup();
    expect(registry.has("development.read_logs")).toBe(true);
    expect(registry.riskOf("memory.store")).toBe("safe_write");
    expect(registry.manifests().length).toBeGreaterThanOrEqual(9);
  });
});

describe("CapabilityExecutor", () => {
  it("reads logs from the world state", async () => {
    const { executor } = setup();
    const out = await executor.execute("development.read_logs", {}, { sessionId: "s", worldState: worldWithProblem, now: T });
    expect(out.result.ok).toBe(true);
    expect((out.result.output as { lines: string[] }).lines[0]).toContain("500");
    expect(out.run.ok).toBe(true);
  });

  it("returns a failed result + run for an unknown capability", async () => {
    const { executor } = setup();
    const out = await executor.execute("nope.nope", {}, { sessionId: "s", now: T });
    expect(out.result.ok).toBe(false);
    expect(out.run.error).toBe("unknown_capability");
  });

  it("stores and searches memory (safe_write then read)", async () => {
    const mem = new Map<string, unknown>();
    const { executor } = setup(mem);
    const store = await executor.execute("memory.store", { key: "prefers-logs-visible", value: true }, { sessionId: "s", now: T });
    expect(store.result.ok).toBe(true);
    const search = await executor.execute("memory.search", { query: "logs" }, { sessionId: "s", now: T });
    expect((search.result.output as { hits: unknown[] }).hits).toHaveLength(1);
  });

  it("executes a multi-capability plan in order", async () => {
    const { executor } = setup();
    const outs = await executor.executeMany(
      [{ capabilityId: "development.read_logs" }, { capabilityId: "development.read_build_state" }, { capabilityId: "data.inspect", input: { a: 1 } }],
      { sessionId: "s", worldState: worldWithProblem, now: T },
    );
    expect(outs).toHaveLength(3);
    expect(outs.every((o) => o.result.ok)).toBe(true);
  });
});
