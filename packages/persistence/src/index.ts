import type { MatterEvent } from "@dm/contracts";

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
  async append(event: MatterEvent): Promise<void> {
    this.events.push(event);
  }
  async listBySession(sessionId: string): Promise<MatterEvent[]> {
    return this.events.filter((e) => e.sessionId === sessionId);
  }
  async all(): Promise<MatterEvent[]> {
    return [...this.events];
  }
}

export class InMemorySnapshotStore implements SnapshotStore {
  private snaps: Snapshot[] = [];
  async save(snapshot: Snapshot): Promise<void> {
    this.snaps.push(snapshot);
  }
  async list(sessionId: string, kind?: string): Promise<Snapshot[]> {
    return this.snaps.filter((s) => s.sessionId === sessionId && (!kind || s.kind === kind));
  }
}

// Postgres backend + factory (loaded lazily by consumers that need durability).
export * from "./pg";
export * from "./schema";
export * from "./factory";
