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
      const result = await cap.execute(input, ctx);
      return {
        capabilityId,
        result,
        run: { id: runId, capabilityId, startedAt, finishedAt: this.now(), ok: result.ok, error: result.error },
      };
    } catch (err) {
      const error = (err as Error).message;
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
