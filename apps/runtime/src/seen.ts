/**
 * What this runtime has already folded, so a second copy of it is not folded again.
 *
 * Inside one process an event reached the loop exactly once: publishing it WAS calling the loop.
 * A broker promises less than that. It delivers at least once, so a consumer that restarts or a
 * group that rebalances is handed messages it has already run, and a belief folded twice counts
 * one observation as two — the behaviour numbers climb at twice the rate the person moved, a
 * repetition reaches its threshold a step early, and the same event id is written to the trail
 * under two rows.
 *
 * Both the session name and the event id come from outside this process, so neither is ever a key
 * on an object: a session called `__proto__` is an ordinary entry in a Map, and an event id of the
 * same name is an ordinary member of a Set.
 *
 * What is remembered is bounded twice over, because anything that can reach the topic decides how
 * many sessions and how many ids there are. The session that went longest without an event is
 * forgotten first, and within a session the oldest id; a runtime handed an event older than its
 * memory folds it again rather than growing without end, which is the trade this bound is.
 */

/** How many event ids one session remembers having folded. */
export const MAX_REMEMBERED_EVENT_IDS = 1_000;

/**
 * How many sessions keep such a memory. The same ceiling the runtime core puts on live sessions:
 * remembering for more sessions than can exist at once would cost memory and catch nothing.
 */
export const MAX_REMEMBERED_SESSIONS = 500;

export class SeenEvents {
  private readonly bySession = new Map<string, Set<string>>();

  constructor(
    private readonly idsPerSession: number = MAX_REMEMBERED_EVENT_IDS,
    private readonly sessions: number = MAX_REMEMBERED_SESSIONS,
  ) {}

  /**
   * True the first time this session is handed this event id, false every time after.
   *
   * Asking is also remembering: the caller is about to fold it.
   */
  firstTime(sessionId: string, eventId: string): boolean {
    const ids = this.bySession.get(sessionId);
    if (!ids) {
      this.evictSessions();
      this.bySession.set(sessionId, new Set([eventId]));
      return true;
    }
    // Re-inserting moves the session to the end of the Map's order, which is what makes the
    // eviction above reach for the one that has gone longest without an event.
    this.bySession.delete(sessionId);
    this.bySession.set(sessionId, ids);
    if (ids.has(eventId)) return false;
    ids.add(eventId);
    if (ids.size > this.idsPerSession) {
      const oldest = ids.values().next();
      if (!oldest.done) ids.delete(oldest.value);
    }
    return true;
  }

  /**
   * Forget one id again: the fold it was remembered for never happened.
   *
   * An event the queue let go at the ceiling was never folded into anything, so a broker handing
   * it back is not a duplicate — it is the only copy left, and refusing it here would turn one
   * loss into a permanent one.
   */
  forget(sessionId: string, eventId: string): void {
    const ids = this.bySession.get(sessionId);
    if (!ids) return;
    ids.delete(eventId);
    if (ids.size === 0) this.bySession.delete(sessionId);
  }

  /** How many sessions are remembered; bounded on purpose. */
  remembered(): number {
    return this.bySession.size;
  }

  /** How many ids are remembered for one session; bounded on purpose. */
  rememberedFor(sessionId: string): number {
    return this.bySession.get(sessionId)?.size ?? 0;
  }

  private evictSessions(): void {
    while (this.bySession.size >= this.sessions) {
      const oldest = this.bySession.keys().next();
      if (oldest.done) return;
      this.bySession.delete(oldest.value);
    }
  }
}
