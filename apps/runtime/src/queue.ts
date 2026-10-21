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
 * What a caller is told when its event was let go rather than run. The queue is best-effort under
 * load, but "best-effort" has to reach whoever was waiting: a promise that never settles, or one
 * that resolves as though the work had happened, is the silent failure this exists to avoid.
 */
export class EventDropped extends Error {
  constructor(readonly sessionId: string) {
    super("the session queue was full, so this event was dropped");
    this.name = "EventDropped";
  }
}

type Job = { run: () => Promise<void>; drop: () => void };
type Lane = { waiting: Job[]; running: boolean; dropped: number };

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
 * Session names come from outside, so the lanes live in a Map rather than on an object, and a
 * lane is forgotten as soon as it has nothing left to run — otherwise every name anybody ever
 * posted would be remembered for as long as the process lives.
 */
export class SessionQueues {
  private readonly lanes = new Map<string, Lane>();
  private droppedTotal = 0;

  constructor(
    readonly limit: number = DEFAULT_EVENT_QUEUE_MAX,
    private readonly onDrop?: (sessionId: string, droppedForSession: number) => void,
  ) {}

  /** Queue one piece of work for a session; resolves with whatever the work answered. */
  run<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const lane = this.lanes.get(sessionId) ?? { waiting: [], running: false, dropped: 0 };
      this.lanes.set(sessionId, lane);
      if (lane.waiting.length >= this.limit) {
        const oldest = lane.waiting.shift();
        lane.dropped += 1;
        this.droppedTotal += 1;
        oldest?.drop();
        this.onDrop?.(sessionId, lane.dropped);
      }
      lane.waiting.push({
        run: () => task().then(resolve, reject),
        drop: () => reject(new EventDropped(sessionId)),
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

  droppedFor(sessionId: string): number {
    return this.lanes.get(sessionId)?.dropped ?? 0;
  }

  /** How many sessions still have work in hand — a leak in this is a leak in the process. */
  sessions(): number {
    return this.lanes.size;
  }

  private pump(sessionId: string): void {
    const lane = this.lanes.get(sessionId);
    if (!lane || lane.running) return;
    const next = lane.waiting.shift();
    if (!next) {
      // Nothing left and nothing running: the lane only held a count of drops, and a session that
      // overflowed once and then went quiet is not worth remembering forever.
      this.lanes.delete(sessionId);
      return;
    }
    lane.running = true;
    // `run` settles the caller's promise itself and never rejects, so this cannot leave a lane
    // stuck with `running` true.
    void next.run().finally(() => {
      lane.running = false;
      this.pump(sessionId);
    });
  }
}
