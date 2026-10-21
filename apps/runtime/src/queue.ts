import { envNumber } from "@particle/contracts";

/**
 * How many events may be WAITING for one session before the oldest of them is let go.
 *
 * A hundred is a long backlog for a loop that answers in milliseconds and a short one for a loop
 * waiting on a model: it is the point past which the body would be reshaping itself around
 * something the person has already moved on from.
 */
export const DEFAULT_EVENT_QUEUE_MAX = 100;

export function eventQueueMax(env: NodeJS.ProcessEnv): number {
  return envNumber(env.DM_EVENT_QUEUE_MAX, DEFAULT_EVENT_QUEUE_MAX, "DM_EVENT_QUEUE_MAX", 1, 1_000_000);
}

/**
 * How many sessions' losses are remembered at once.
 *
 * A session name arrives from outside, so a count kept per name is a map somebody else decides the
 * size of. Only a session that actually lost an event is ever entered here, and the least recently
 * affected is forgotten first — so the sessions a person is looking at keep their number, and a
 * flood of invented names costs a bounded amount of memory rather than all of it.
 */
export const MAX_REMEMBERED_DROPPING_SESSIONS = 1_000;

/** One event the queue let go: which session it belonged to, which event, and how many that makes. */
export type DroppedEvent = { sessionId: string; eventId: string; droppedForSession: number };

/**
 * What a caller is told when its event was let go rather than run. The queue is best-effort under
 * load, but "best-effort" has to reach whoever was waiting: a promise that never settles, or one
 * that resolves as though the work had happened, is the silent failure this exists to avoid.
 */
export class EventDropped extends Error {
  constructor(
    readonly sessionId: string,
    readonly eventId: string,
  ) {
    super("the session queue was full, so this event was dropped");
    this.name = "EventDropped";
  }
}

type Job = { eventId: string; run: () => Promise<void>; drop: () => void };
type Lane = { waiting: Job[]; running: boolean };

/**
 * One serial lane per session.
 *
 * Events describe a situation unfolding — a build fails, then passes; a file is saved on a branch
 * somebody just switched to — and the loop folds each into the belief the one before it left
 * behind. Run two of a session's events at once and the belief depends on which model call
 * answered first, which is the end of replaying a session and getting the same body back. So a
 * session runs one at a time, in the order it was handed them.
 *
 * Sessions do not wait on each other: the lanes are separate, and a session stuck on a slow model
 * holds up nothing but itself.
 *
 * Session names come from outside, so both maps here are Maps rather than objects, and a lane is
 * forgotten as soon as it has nothing left to run. What a session LOST outlives its lane: the lane
 * is about work in hand, and the count is about observations that never reached anybody.
 */
export class SessionQueues {
  private readonly lanes = new Map<string, Lane>();
  private readonly lossesBySession = new Map<string, number>();
  private droppedTotal = 0;

  constructor(
    readonly limit: number = DEFAULT_EVENT_QUEUE_MAX,
    private readonly onDrop?: (dropped: DroppedEvent) => void,
  ) {}

  /** Queue one event's work for a session; resolves with whatever the work answered. */
  run<T>(sessionId: string, eventId: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const lane = this.lanes.get(sessionId) ?? { waiting: [], running: false };
      this.lanes.set(sessionId, lane);
      if (lane.waiting.length >= this.limit) {
        const oldest = lane.waiting.shift();
        this.droppedTotal += 1;
        const droppedForSession = this.remember(sessionId);
        oldest?.drop();
        if (oldest) this.onDrop?.({ sessionId, eventId: oldest.eventId, droppedForSession });
      }
      lane.waiting.push({
        eventId,
        // `task()` may throw rather than reject — a synchronous failure before it ever returns a
        // promise. Left to escape it would take `pump` down with it and leave the lane marked
        // running with nobody running in it, which is this session stopping for good.
        run: async () => {
          try {
            resolve(await task());
          } catch (err) {
            reject(err);
          }
        },
        drop: () => reject(new EventDropped(sessionId, eventId)),
      });
      this.pump(sessionId);
    });
  }

  /** How many are queued behind the ones currently running, across every session. */
  waiting(): number {
    let n = 0;
    for (const lane of this.lanes.values()) n += lane.waiting.length;
    return n;
  }

  /** How many were let go at the ceiling, so an indicator and the trail can say so. */
  dropped(): number {
    return this.droppedTotal;
  }

  /** How many this session has lost since the runtime started, lane or no lane. */
  droppedFor(sessionId: string): number {
    return this.lossesBySession.get(sessionId) ?? 0;
  }

  /** How many sessions still have work in hand — a leak in this is a leak in the process. */
  sessions(): number {
    return this.lanes.size;
  }

  /** How many sessions' losses are still remembered; bounded on purpose. */
  remembered(): number {
    return this.lossesBySession.size;
  }

  /** Count one more loss for a session, keeping the most recently affected ones. */
  private remember(sessionId: string): number {
    const next = (this.lossesBySession.get(sessionId) ?? 0) + 1;
    // Re-inserting moves it to the end of the Map's order, which is what makes the eviction below
    // reach for the session that has gone longest without losing anything.
    this.lossesBySession.delete(sessionId);
    this.lossesBySession.set(sessionId, next);
    if (this.lossesBySession.size > MAX_REMEMBERED_DROPPING_SESSIONS) {
      const oldest = this.lossesBySession.keys().next();
      if (!oldest.done) this.lossesBySession.delete(oldest.value);
    }
    return next;
  }

  private pump(sessionId: string): void {
    const lane = this.lanes.get(sessionId);
    if (!lane || lane.running) return;
    const next = lane.waiting.shift();
    if (!next) {
      // Nothing left and nothing running. The lane held only work in hand, so it is thrown away;
      // what this session lost is counted elsewhere and survives.
      this.lanes.delete(sessionId);
      return;
    }
    lane.running = true;
    // `run` settles the caller's promise itself and swallows a synchronous throw, so this cannot
    // leave a lane stuck with `running` true.
    void next.run().finally(() => {
      lane.running = false;
      this.pump(sessionId);
    });
  }
}
