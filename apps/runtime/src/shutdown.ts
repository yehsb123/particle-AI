/**
 * What this process does when somebody stops it.
 *
 * Everything that has to be let go of on the way out is already written: `buildServer` hangs an
 * onClose hook on the app that closes the event channel and then the store. Nothing called it.
 * A runtime stopped with `docker stop` or Ctrl+C died where it stood, so the Kafka consumer never
 * left its group and never committed what it had already folded, and the broker handed those
 * messages to the next process. The guard against folding one observation twice is `seen`, which
 * lives in this process's memory and starts empty — so a redelivered event is folded a second
 * time and the belief counts one thing that happened as two.
 *
 * WHAT IS NOT WAITED FOR: the session lanes. An event still waiting in a lane was accepted with
 * a 202 and its sender has long gone, and the lane may be waiting on a model, so draining would
 * make stopping take as long as the slowest decision — past the ten seconds a container gives
 * before it sends SIGKILL, which would end the process in exactly the unclean way this exists to
 * prevent. What is waited for is the close itself, which is where the consumer finishes the fold
 * it is in the middle of and commits it. The backlog is let go, and said out loud on the way out:
 * a count in the log beats a silent gap in the trail.
 */
export const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;
export type ShutdownSignal = (typeof SHUTDOWN_SIGNALS)[number];

/**
 * Everything this touches outside itself, so it can be held against a test without signalling a
 * real process or ending the test runner.
 */
export type ShutdownDeps = {
  /** `app.close()`: stops listening, then runs the onClose hook (channel, then store). */
  close: () => Promise<void>;
  /** How many events are still queued behind the ones being folded. */
  waiting: () => number;
  say: (line: string) => void;
  exit: (code: number) => void;
  on: (signal: ShutdownSignal, handler: () => void) => void;
  /** How long closing may take before this process ends anyway. */
  graceMs?: number;
};

/** A container sends SIGKILL ten seconds after SIGTERM; this has to be over well before that. */
export const DEFAULT_GRACE_MS = 5_000;

export function installShutdown(deps: ShutdownDeps): void {
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;
  let stopping = false;
  let ended = false;
  const end = (code: number, line?: string): void => {
    if (ended) return;
    ended = true;
    if (line) deps.say(line);
    deps.exit(code);
  };

  const stop = (signal: ShutdownSignal): void => {
    if (stopping) {
      // Pressing it twice means "now", and whoever did it is owed an honest exit code: what was
      // still being folded was not finished and the group was not left cleanly.
      end(1, `[digital-matter] ${signal} again — ending without finishing the close`);
      return;
    }
    stopping = true;
    const left = deps.waiting();
    deps.say(
      `[digital-matter] ${signal} — closing the event channel and the store` +
        (left > 0 ? `; ${left} queued event(s) are let go unfolded` : ""),
    );
    const deadline = setTimeout(
      () => end(1, `[digital-matter] closing did not finish within ${graceMs}ms — ending anyway`),
      graceMs,
    );
    // The deadline must not be the reason this process stays alive once everything else is shut.
    deadline.unref?.();
    void deps.close().then(
      () => {
        clearTimeout(deadline);
        end(0);
      },
      (err: unknown) => {
        clearTimeout(deadline);
        end(1, `[digital-matter] did not close cleanly: ${err instanceof Error ? err.message : String(err)}`);
      },
    );
  };

  for (const signal of SHUTDOWN_SIGNALS) deps.on(signal, () => stop(signal));
}
