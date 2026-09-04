/**
 * The clock a restored log is replayed on.
 *
 * While restoring, "now" is the replayed event's own timestamp — otherwise the morph guard would
 * see minutes of history collapse into microseconds and block morphs it allowed live. It only
 * ever moves forward, though: a saved log is in the order events were recorded, while their
 * timestamps come from whatever the clock said at the time, and a clock can be stepped backwards
 * (a correction, a machine waking up). Letting the replay follow it back would measure negative
 * elapsed time and refuse a morph that had gone through, so the restored body would not match
 * the one that was saved.
 */
export function createReplayClock(wallIso: () => string = () => new Date().toISOString(), wallMs: () => number = () => Date.now()) {
  let at: string | null = null;
  let atMs = 0;

  return {
    /** Replay the next event at its own instant, unless that is older than where we already are. */
    advanceTo(timestamp: string): void {
      const ms = Date.parse(timestamp);
      if (!Number.isFinite(ms) || ms < atMs) return;
      at = timestamp;
      atMs = ms;
    },
    /** Back to real time — the restore is over. */
    release(): void {
      at = null;
      atMs = 0;
    },
    replaying: () => at !== null,
    iso: () => at ?? wallIso(),
    ms: () => (at ? atMs : wallMs()),
  };
}

export type ReplayClock = ReturnType<typeof createReplayClock>;
