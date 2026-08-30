import type { IngestResult, RuntimeClock, RuntimeCore } from "./index";
import type { MatterEvent } from "@particle/contracts";
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
export async function replay(
  events: MatterEvent[],
  clock?: RuntimeClock,
  opts: { memory?: { preferences?: { key: string; weight: number }[] } | null } = {},
): Promise<ReplayResult> {
  // Event-sourced clock: "now" is the timestamp of the event being replayed, so cooldown/dwell
  // guards see the same gaps they saw live. A wall clock would collapse minutes into microseconds
  // and reject morphs that were allowed the first time.
  let current = events[0]?.timestamp ?? new Date(0).toISOString();
  const eventClock: RuntimeClock = { iso: () => current, ms: () => Date.parse(current) };
  const core = createRuntimeCore(clock ?? eventClock);
  // learned preferences are not events — seed them so a verify run judges the log the same way
  if (opts.memory && events[0]) core.importMemory(events[0].sessionId, opts.memory);
  const steps: IngestResult[] = [];
  for (const event of events) {
    current = event.timestamp;
    steps.push(await core.ingest(event));
  }
  return { core, steps };
}
