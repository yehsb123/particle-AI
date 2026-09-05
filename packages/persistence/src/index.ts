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

export class InMemoryEventLogStore implements EventLogStore {
  private events: MatterEvent[] = [];
  constructor(private readonly limit = 10_000) {}
  async append(event: MatterEvent): Promise<void> {
    this.events.push(event);
    if (this.events.length > this.limit) this.events.shift();
  }
  async listBySession(sessionId: string): Promise<MatterEvent[]> {
    return this.events.filter((e) => e.sessionId === sessionId);
  }
  async all(): Promise<MatterEvent[]> {
    return [...this.events];
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
