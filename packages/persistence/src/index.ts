import type { MatterEvent } from "@particle/contracts";

/**
 * Storage seam. The MVP uses in-memory implementations; a Drizzle/Postgres implementation can
 * be dropped in behind these same interfaces without touching the runtime (see DATA_MODEL.md).
 */
export interface EventLogStore {
  append(event: MatterEvent): Promise<void>;
  listBySession(sessionId: string): Promise<MatterEvent[]>;
  all(): Promise<MatterEvent[]>;
}

export type Snapshot = { sessionId: string; kind: string; at: string; data: unknown };

export interface SnapshotStore {
  save(snapshot: Snapshot): Promise<void>;
  list(sessionId: string, kind?: string): Promise<Snapshot[]>;
}

/**
 * The events one session can be read back from, bounded without reaching into another session.
 *
 * This kept one array for every session at once and dropped the oldest event in it, so a session
 * busy enough to fill the bound on its own emptied the trail of every quiet session beside it —
 * the same way the snapshot store below used to, and for the same reason. The bound on events is
 * now per session, and a second bound counts sessions, so a long run with a fresh session id each
 * time cannot grow without limit either. The session written to most recently is the last one
 * forgotten.
 *
 * Sessions are held in a map rather than filtered out of one list, so no session id can be
 * spelled to reach another's events. The order events arrived in is kept across sessions, since
 * `all()` is read as the trail of the whole process.
 */
export class InMemoryEventLogStore implements EventLogStore {
  private bySession = new Map<string, { seq: number; event: MatterEvent }[]>();
  private nextSeq = 0;
  constructor(
    private readonly limitPerSession = 10_000,
    private readonly maxSessions = 500,
  ) {}
  async append(event: MatterEvent): Promise<void> {
    const existing = this.bySession.get(event.sessionId);
    // re-inserting moves this session to the end: what is written to stays, what went quiet goes
    if (existing) this.bySession.delete(event.sessionId);
    const events = existing ?? [];
    events.push({ seq: this.nextSeq++, event });
    while (events.length > this.limitPerSession) events.shift();
    this.bySession.set(event.sessionId, events);
    while (this.bySession.size > this.maxSessions) {
      const oldest = this.bySession.keys().next().value;
      if (oldest === undefined) break;
      this.bySession.delete(oldest);
    }
  }
  async listBySession(sessionId: string): Promise<MatterEvent[]> {
    return (this.bySession.get(sessionId) ?? []).map((e) => e.event);
  }
  async all(): Promise<MatterEvent[]> {
    return [...this.bySession.values()]
      .flat()
      .sort((a, z) => a.seq - z.seq)
      .map((e) => e.event);
  }
}

/**
 * The snapshots one session can be brought back from: the latest of each kind, and no more.
 *
 * A resume reads exactly one snapshot per kind — the most recent world, the most recent body, the
 * most recent memory — and this kept every one ever written. Every ingest writes three, so a
 * single busy session filled the whole store and pushed out the snapshots of every quiet session
 * beside it: those sessions then resumed to nothing, silently, having done nothing wrong. The
 * ceiling now counts sessions rather than writes, and the session written to most recently is the
 * last one forgotten.
 *
 * Sessions and kinds are held in nested maps rather than under a composed key, so no session id
 * can be spelled to reach another's snapshots.
 */
export class InMemorySnapshotStore implements SnapshotStore {
  private bySession = new Map<string, Map<string, Snapshot>>();
  constructor(private readonly maxSessions = 500) {}

  async save(snapshot: Snapshot): Promise<void> {
    const existing = this.bySession.get(snapshot.sessionId);
    // re-inserting moves this session to the end: what is written to stays, what went quiet goes
    if (existing) this.bySession.delete(snapshot.sessionId);
    const kinds = existing ?? new Map<string, Snapshot>();
    kinds.set(snapshot.kind, snapshot);
    this.bySession.set(snapshot.sessionId, kinds);
    while (this.bySession.size > this.maxSessions) {
      const oldest = this.bySession.keys().next().value;
      if (oldest === undefined) break;
      this.bySession.delete(oldest);
    }
  }

  async list(sessionId: string, kind?: string): Promise<Snapshot[]> {
    const kinds = this.bySession.get(sessionId);
    if (!kinds) return [];
    // ordered by when each was taken, so a caller walking from the end still finds the latest
    const all = [...kinds.values()].sort((a, z) => (a.at < z.at ? -1 : a.at > z.at ? 1 : 0));
    return kind ? all.filter((s) => s.kind === kind) : all;
  }
}

// Postgres backend + factory (loaded lazily by consumers that need durability).
export * from "./pg";
export * from "./schema";
export * from "./factory";
