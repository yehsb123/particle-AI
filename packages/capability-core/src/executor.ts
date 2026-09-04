import type { CapabilityResult, CapabilityRun } from "@particle/contracts";
import type { CapabilityRegistry } from "./registry";
import type { CapabilityContext } from "./types";

export type ExecutionOutcome = {
  capabilityId: string;
  result: CapabilityResult;
  run: CapabilityRun;
};

/** Runs authorized capabilities and records an auditable run for each. */
export class CapabilityExecutor {
  private seq = 0;
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly now: () => string,
  ) {}

  async execute(capabilityId: string, input: unknown, ctx: CapabilityContext): Promise<ExecutionOutcome> {
    const startedAt = this.now();
    const runId = `run-${++this.seq}`;
    const cap = this.registry.get(capabilityId);
    if (!cap) {
      const finishedAt = this.now();
      return {
        capabilityId,
        result: { ok: false, error: `unknown capability: ${capabilityId}` },
        run: { id: runId, capabilityId, startedAt, finishedAt, ok: false, error: "unknown_capability" },
      };
    }
    try {
      const answer = await cap.execute(input, ctx);
      // A capability that returned nothing recognisable is a broken capability, not a mystery:
      // reading `ok` off undefined used to put our own type error in the audit as if the
      // capability had said it.
      const result: CapabilityResult =
        answer && typeof answer === "object" && typeof answer.ok === "boolean"
          ? answer
          : { ok: false, error: `capability ${capabilityId} did not return a result` };
      return {
        capabilityId,
        result,
        run: { id: runId, capabilityId, startedAt, finishedAt: this.now(), ok: result.ok, error: result.error },
      };
    } catch (err) {
      // it may throw anything at all; a failure with no reason tells the operator nothing
      const error = (err instanceof Error ? err.message : String(err)) || `capability ${capabilityId} failed without saying why`;
      return {
        capabilityId,
        result: { ok: false, error },
        run: { id: runId, capabilityId, startedAt, finishedAt: this.now(), ok: false, error },
      };
    }
  }

  async executeMany(
    plan: { capabilityId: string; input?: unknown }[],
    ctx: CapabilityContext,
  ): Promise<ExecutionOutcome[]> {
    const out: ExecutionOutcome[] = [];
    for (const item of plan) {
      out.push(await this.execute(item.capabilityId, item.input, ctx));
    }
    return out;
  }
}
