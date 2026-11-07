/**
 * Particle AI desktop agent — what leaves this machine (Concept v2 rule #1: shape, never content).
 *
 * Every byte the agent sends is built here: the envelope an event travels in, the payload a
 * reading becomes, the address it is posted to, and the queues that decide what goes and what is
 * let go. Reviewing this file is still reviewing what can possibly leave the machine — nothing is
 * sent from anywhere else, and the modules below it only make shapes and read switches:
 *
 *   ./names    the names and paths this sensor is allowed to say
 *   ./signals  streams of readings turned into the moments something changed
 *   ./config   what somebody asked this machine to sense, and which senses run
 *
 * They are re-exported here so there is still one door into this agent's vocabulary.
 *
 * The agent takes no dependency on the monorepo on purpose — somebody runs it on their own
 * machine — apart from a type, which compiles to nothing and lets it speak the same vocabulary
 * as the runtime.
 */
import type { ScreenReading } from "@particle/contracts";
import { identifier } from "./names";
import type { Severity, Source } from "./signals";

export { relPath, isIgnored, MAX_NAME, identifier, branchFromHead, MAX_PATH, gitDirFrom } from "./names";
export {
  type Severity,
  type Source,
  type Outcome,
  classifyLine,
  type Signal,
  OutputTracker,
  type WindowShape,
  parseWindowLine,
  windowShape,
  sameWindow,
  WindowTracker,
  windowScript,
} from "./signals";
export {
  envNumber,
  envFlag,
  type WindowSensorDecision,
  windowSensor,
  MAX_CAPTURE_APPS,
  captureApps,
  screenLayers,
  CaptureSchedule,
  type ScreenSensorDecision,
  screenSensor,
  type ScreenReaderDecision,
  screenReader,
} from "./config";

/**
 * Where an event is handed over — and the fact that this sensor is not waiting for the answer.
 *
 * The runtime runs a whole loop per event (world, significance, intent, a model call, permissions,
 * capabilities, the morph) before it answers, and this sensor held the connection open through all
 * of it for a result it never reads. `wait=0` gets an acknowledgement instead; the event is still
 * run, in the order this sensor sent it. The runtime answers the old way when nobody says this,
 * which is what the body wants and what every caller written before this did.
 */
export function ingestUrl(runtimeUrl: string): string {
  return `${runtimeUrl}/api/events?wait=0`;
}

/**
 * How many of this session's events the runtime has let go, read out of its acknowledgement.
 *
 * Since this sensor stopped waiting for the loop, every answer is a 202 whether the event ran or
 * was thrown away under load, so `res.ok` says nothing about either. The count is the one thing
 * that still comes back, and it is read strictly rather than trusted: the body of an answer is
 * outside data like any other, and a proxy's error page or an older runtime is not a count.
 *
 * This module takes no runtime dependencies on purpose - reviewing it is reviewing what can leave
 * the machine - so the check is spelled out here instead of being handed to a schema library.
 */
export function droppedFromAck(body: unknown): number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const n = (body as { dropped?: unknown }).dropped;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * One line, the moment the count goes up, and silence otherwise.
 *
 * A count that went DOWN is a runtime that restarted, not events coming back, so it is followed
 * without a word rather than reported as a recovery.
 */
export function dropNotice(seen: number, reported: number | null): { seen: number; note: string | null } {
  if (reported === null) return { seen, note: null };
  if (reported <= seen) return { seen: reported, note: null };
  const now = reported - seen;
  return {
    seen: reported,
    note: `[particle-agent] the runtime let go of ${now} more of this session's events (${reported} in total): it is behind, and what they observed is gone`,
  };
}

/** One-line startup warning when the runtime is unreachable (sensing stays best-effort). */
export function healthWarning(runtimeUrl: string, reachable: boolean): string | null {
  return reachable ? null : `[particle-agent] runtime not reachable at ${runtimeUrl} — events are dropped until it is up (pnpm runtime)`;
}

/**
 * A queue that sends one thing at a time, in the order it was handed them. Transitions only mean
 * something in order — a recovery must never overtake the failure it recovers from — so a second
 * send waits for the first rather than racing it.
 *
 * When the far end is hung or slow the queue fills, and at the ceiling the NEWEST item is dropped
 * rather than the oldest: what is already queued is the earlier part of the story, and a story
 * with its beginning is worth more than one with its end.
 */
export function createSendQueue(
  post: (payload: unknown) => Promise<void>,
  options: { maxPending?: number; onError?: (err: unknown) => void } = {},
) {
  const maxPending = options.maxPending ?? 500;
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;
  let dropped = 0;

  return {
    send(payload: unknown): Promise<void> {
      if (pending >= maxPending) {
        dropped += 1;
        return chain;
      }
      pending += 1;
      chain = chain.then(async () => {
        try {
          await post(payload);
        } catch (err) {
          // A file save that did not arrive is gone whether the queue refused it or the send
          // failed on the way; the count is what this agent lost, not how it lost it. The send
          // behind this carries a five second timeout, so a runtime busy with a model call was
          // enough to lose a save or a branch switch while dropped() still read zero.
          dropped += 1;
          try {
            options.onError?.(err); // best-effort: the far end being down is not our problem to solve
          } catch {
            // A handler that throws used to reject this link of the chain, so no later send ever
            // ran: every event after the first failure went the same way, with an unhandled
            // rejection as the only sign. Nothing called from a failure path may end the queue.
          }
        } finally {
          pending -= 1;
        }
      });
      return chain;
    },
    /** How many sends are queued or in flight. */
    pending: () => pending,
    /** How many this agent did not deliver: refused at the ceiling, or failed on the way. */
    dropped: () => dropped,
  };
}

/** MatterEvent-shaped object without importing the monorepo (the agent is standalone). */
export function matterEvent(
  sessionId: string,
  source: Source,
  type: string,
  severity: Severity,
  payload: Record<string, unknown>,
  now = new Date(),
) {
  return {
    id: `agent-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    timestamp: now.toISOString(),
    source,
    type,
    severity,
    payload,
  };
}

/**
 * How many taken-but-unread pictures are held while a model is answering about another.
 *
 * Two, because the window in front is read every second and a reading takes as long as a model
 * takes: a deeper queue would not catch up, it would read windows somebody left minutes ago and
 * report them as what they are doing now. A backlog of screens is worth less the older it gets,
 * which is the opposite of the transitions `createSendQueue` carries.
 */
export const MAX_PENDING_READS = 2;

/**
 * Pictures waiting for a model, one reading at a time, newest kept.
 *
 * Reading used to happen inside the capture lock, so the next picture of ANY app waited for a
 * model to answer about the last one — the camera stopped taking pictures because a model was
 * thinking. The lock was never there to protect the model: it was there so two readings of one
 * window could not race each other to the runtime and arrive in the wrong order. That is what
 * this keeps, and nothing else.
 *
 * At the ceiling the OLDEST frames go, and every one of them is counted: a sense that quietly
 * stops reporting is the one failure this layer cannot afford, since nobody is watching a
 * daemon's output waiting for a reading that is never coming.
 */
export function createReadQueue<T>(
  read: (item: T) => Promise<void>,
  options: { max?: number; onDrop?: (item: T, dropped: number) => void; onError?: (err: unknown) => void } = {},
) {
  const max = options.max ?? MAX_PENDING_READS;
  const waiting: T[] = [];
  let running = false;
  let dropped = 0;

  function pump(): void {
    if (running || waiting.length === 0) return;
    const next = waiting.shift() as T;
    running = true;
    // `read` may throw rather than reject - a synchronous failure before it ever returns a
    // promise. Left to escape, it would take `pump` down with it and leave the worker marked busy
    // with nobody reading, so every frame after it would queue behind work that had already
    // failed and this layer would stop for good without saying anything.
    void (async () => await read(next))()
      .catch((err: unknown) => options.onError?.(err))
      .finally(() => {
        running = false;
        pump();
      });
  }

  return {
    push(item: T): void {
      if (waiting.length >= max) {
        const oldest = waiting.shift() as T;
        dropped += 1;
        options.onDrop?.(oldest, dropped);
      }
      waiting.push(item);
      pump();
    },
    /** Frames taken and not yet read, including the one a model is looking at. */
    pending: () => waiting.length + (running ? 1 : 0),
    /** How many were taken and never read, for an honest count rather than a silence. */
    dropped: () => dropped,
  };
}

/** The window a reading is of, and the brain that read it. */
export type ReadSource = { app: string; window: string; path: string; providerId: string; modelId?: string };

/**
 * What the runtime is told about a window a model read.
 *
 * Flat on purpose: the belief keeps a payload's scalar fields and leaves anything nested behind,
 * so topics travel as one line rather than as a list that would arrive as nothing. What the
 * model wrote is held to the same length and the same characters as every other name this sensor
 * sends — it is the one payload here whose words were written by a model rather than observed,
 * and it is printed in a terminal like all the others.
 *
 * The pixels are not in it. What travels is the situation, which app, where the file is, and
 * which brain read it, so that the record says who saw the picture.
 */
export function screenReadPayload(reading: ScreenReading, source: ReadSource): Record<string, unknown> {
  const model = identifier(source.modelId);
  return {
    app: identifier(source.app),
    window: identifier(source.window),
    path: source.path,
    provider: identifier(source.providerId),
    ...(model ? { model } : {}),
    activity: reading.activity,
    summary: identifier(reading.summary),
    topics: identifier(reading.topics.join(", ")),
    needsAttention: reading.needsAttention,
    confidence: reading.confidence,
  };
}
