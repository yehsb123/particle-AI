import { describe, it, expect } from "vitest";
import { MAX_FAILURE_MESSAGE, type CapabilityManifest } from "@particle/contracts";
import { CapabilityRegistry } from "./registry";
import { CapabilityExecutor } from "./executor";

/**
 * A capability that fails is often somebody else's process failing. An MCP tool is another
 * program: it can put anything in a message, at any length, escape sequences included. That
 * message is kept on the run record and handed to whoever approved the capability, so a third
 * party was deciding how much this system carries and sends.
 *
 * The executor is the one place a failure out there becomes a string in here, so it is the one
 * place this is settled — for a capability that returns a failure, one that throws, and one that
 * throws something that is not an error at all.
 */
const ESC = "\u001b";
const T = "2026-09-06T00:00:00Z";
const manifest = (id: string): CapabilityManifest => ({
  id, name: id, description: "", tags: [], risk: "read", latencyClass: "fast", costClass: "free", requiredPermissions: [],
});

const runFailing = async (id: string, fail: () => never | Promise<unknown>) => {
  const registry = new CapabilityRegistry();
  registry.register({ manifest: manifest(id), execute: fail as never });
  const executor = new CapabilityExecutor(registry, () => T);
  return executor.execute(id, undefined, { sessionId: "s", now: T });
};

describe("what a failing capability is allowed to say", () => {
  it("is what it said, when it said something a person can read", async () => {
    const outcome = await runFailing("c", async () => ({ ok: false, error: "the server refused the request" }));
    expect(outcome.result.error).toBe("the server refused the request");
    expect(outcome.run.error).toBe("the server refused the request");
  });

  it("is cut when it runs longer than an operator reads", async () => {
    const outcome = await runFailing("c", async () => ({ ok: false, error: "e".repeat(200_000) }));
    expect(outcome.result.error!.length).toBe(MAX_FAILURE_MESSAGE + 1);
    expect(outcome.result.error!.endsWith("…")).toBe(true);
    expect(outcome.run.error).toBe(outcome.result.error);
  });

  it("carries none of the characters that are not writing", async () => {
    const outcome = await runFailing("c", async () => ({ ok: false, error: `${ESC}[31mrefused${ESC}[0m` }));
    expect(outcome.result.error).toBe("[31mrefused[0m");
  });

  it("is the same whether it was returned or thrown", async () => {
    const returned = await runFailing("a", async () => ({ ok: false, error: "e".repeat(200_000) }));
    const thrown = await runFailing("b", () => { throw new Error("e".repeat(200_000)); });
    expect(thrown.result.error!.length).toBe(returned.result.error!.length);
  });

  it("is a message even when what was thrown is not an error", async () => {
    // a process that throws an object with an enormous toString is still a process that failed
    const outcome = await runFailing("c", () => { throw { toString: () => "y".repeat(200_000) }; });
    expect(outcome.result.error!.length).toBe(MAX_FAILURE_MESSAGE + 1);
    expect(outcome.result.ok).toBe(false);
  });

  it("says something rather than nothing when the failure was silent", async () => {
    for (const silent of [async () => ({ ok: false as const }), async () => ({ ok: false as const, error: "   " }), async () => ({ ok: false as const, error: ESC })]) {
      const outcome = await runFailing("c", silent);
      expect(outcome.result.error, "a failure with no reason tells the operator nothing").toContain("failed without saying why");
    }
  });

  it("leaves a capability that succeeded exactly as it was", async () => {
    const outcome = await runFailing("c", async () => ({ ok: true, output: { updated: "lodash@4.17.21" } }));
    expect(outcome.result).toEqual({ ok: true, output: { updated: "lodash@4.17.21" } });
    expect(outcome.run.ok).toBe(true);
    expect(outcome.run.error).toBeUndefined();
  });

  it("still says which capability did not answer at all", async () => {
    const outcome = await runFailing("c", async () => "not a result" as never);
    expect(outcome.result.error).toContain("did not return a result");
  });
});
