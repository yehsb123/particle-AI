import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, and, asc } from "drizzle-orm";
import type { MatterEvent } from "@particle/contracts";
import { events, snapshots } from "./schema";
import type { EventLogStore, Snapshot, SnapshotStore } from "./index";

export type PgHandle = { sql: postgres.Sql; db: PostgresJsDatabase };

export function connect(databaseUrl: string): PgHandle {
  const sql = postgres(databaseUrl, { max: 4 });
  return { sql, db: drizzle(sql) };
}

/** Create tables if they don't exist (lightweight; no drizzle-kit tooling required). */
export async function ensureSchema(sql: postgres.Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      timestamp text NOT NULL,
      data jsonb NOT NULL
    )`;
  await sql`CREATE INDEX IF NOT EXISTS events_session_idx ON events (session_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS snapshots (
      id serial PRIMARY KEY,
      session_id text NOT NULL,
      kind text NOT NULL,
      at text NOT NULL,
      data jsonb NOT NULL
    )`;
  await sql`CREATE INDEX IF NOT EXISTS snapshots_session_idx ON snapshots (session_id)`;
}

export class PgEventLogStore implements EventLogStore {
  constructor(private readonly db: PostgresJsDatabase) {}
  async append(event: MatterEvent): Promise<void> {
    await this.db
      .insert(events)
      .values({ id: event.id, sessionId: event.sessionId, timestamp: event.timestamp, data: event })
      .onConflictDoNothing();
  }
  async listBySession(sessionId: string): Promise<MatterEvent[]> {
    const rows = await this.db.select().from(events).where(eq(events.sessionId, sessionId));
    return rows.map((r) => r.data as MatterEvent);
  }
  async all(): Promise<MatterEvent[]> {
    const rows = await this.db.select().from(events);
    return rows.map((r) => r.data as MatterEvent);
  }
}

export class PgSnapshotStore implements SnapshotStore {
  constructor(private readonly db: PostgresJsDatabase) {}
  async save(snapshot: Snapshot): Promise<void> {
    await this.db.insert(snapshots).values({
      sessionId: snapshot.sessionId,
      kind: snapshot.kind,
      at: snapshot.at,
      data: snapshot.data,
    });
  }
  async list(sessionId: string, kind?: string): Promise<Snapshot[]> {
    const where = kind
      ? and(eq(snapshots.sessionId, sessionId), eq(snapshots.kind, kind))
      : eq(snapshots.sessionId, sessionId);
    // Order by the monotonic serial id so callers relying on insertion order (resume picks the
    // LATEST snapshot via reverse().find) are correct — Postgres gives no order without this.
    const rows = await this.db.select().from(snapshots).where(where).orderBy(asc(snapshots.id));
    return rows.map((r) => ({ sessionId: r.sessionId, kind: r.kind, at: r.at, data: r.data }));
  }
}
