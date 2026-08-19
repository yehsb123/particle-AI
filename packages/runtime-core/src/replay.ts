import type { IngestResult, RuntimeClock, RuntimeCore } from "./index";
import type { MatterEvent } from "@dm/contracts";
import { createRuntimeCore } from "./factory";

export type ReplayResult = {
  core: RuntimeCore;
  steps: IngestResult[];
};

/**
 * Replay an event log through a fresh RuntimeCore. Because every stage is deterministic
 * given the clock and the mock brain, replaying the same events reproduces the exact same
 * world state, UI, and audit trail — the property that makes the runtime debuggable.
 */
export async function replay(events: MatterEvent[], clock: RuntimeClock): Promise<ReplayResult> {
  const core = createRuntimeCore(clock);
  const steps: IngestResult[] = [];
  for (const event of events) {
    steps.push(await core.ingest(event));
  }
  return { core, steps };
}
