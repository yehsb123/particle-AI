import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { eq, and, asc, desc, lt } from "drizzle-orm";
import { MatterEvent as MatterEventSchema, type MatterEvent } from "@particle/contracts";
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

/**
 * The events among a set of stored rows. A row holds whatever build was running when it was
 * written, so what comes back out is outside data: casting it to a MatterEvent only promised it
 * was one, and a row from an older shape travelled on into the listing, the world state and the
 * prompt as though the schema had seen it. Snapshots are already read back this way (see
 * `RuntimeCore.hydrate`). A row that does not parse is left out and the rest still come back —
 * one unreadable row must not cost a session its whole trail.
 */
export function eventsFromRows(rows: readonly { data: unknown }[]): MatterEvent[] {
  const out: MatterEvent[] = [];
  for (const row of rows) {
    const parsed = MatterEventSchema.safeParse(row.data);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export class PgEventLogStore implements EventLogStore {
  /**
   * `limit` is what one session's listing may hand back at once, matching the in-memory log's
   * bound. A session running for months has no ceiling in this table, and a reader asking for its
   * events was handed every row it ever wrote — through a REST answer and into a browser.
   */
  constructor(
    private readonly db: PostgresJsDatabase,
    private readonly limit = 10_000,
  ) {}
  async append(event: MatterEvent): Promise<void> {
    await this.db
      .insert(events)
      .values({ id: event.id, sessionId: event.sessionId, timestamp: event.timestamp, data: event })
      .onConflictDoNothing();
  }
  /** The newest events of a session, up to the bound, oldest first (as the in-memory log reads). */
  async listBySession(sessionId: string): Promise<MatterEvent[]> {
    const rows = await this.db
      .select()
      .from(events)
      .where(eq(events.sessionId, sessionId))
      // newest first so the bound keeps the recent ones; id breaks a tie, since two events of one
      // session can carry the same timestamp and Postgres orders nothing on its own
      .orderBy(desc(events.timestamp), desc(events.id))
      .limit(this.limit);
    return eventsFromRows(rows.reverse());
  }
  async all(): Promise<MatterEvent[]> {
    const rows = await this.db.select().from(events);
    return eventsFromRows(rows);
  }
}

export class PgSnapshotStore implements SnapshotStore {
  constructor(private readonly db: PostgresJsDatabase) {}
  /**
   * Keep the latest of each kind for a session and drop what it replaces.
   *
   * A resume reads one snapshot per kind, and this table had no bound at all: three rows per
   * ingest, kept forever, and every one of them read back on every resume. Deleting by id rather
   * than by timestamp means two saves in the same instant still leave exactly one row.
   */
  async save(snapshot: Snapshot): Promise<void> {
    const [inserted] = await this.db
      .insert(snapshots)
      .values({
        sessionId: snapshot.sessionId,
        kind: snapshot.kind,
        at: snapshot.at,
        data: snapshot.data,
      })
      .returning({ id: snapshots.id });
    if (!inserted) return;
    await this.db
      .delete(snapshots)
      .where(and(eq(snapshots.sessionId, snapshot.sessionId), eq(snapshots.kind, snapshot.kind), lt(snapshots.id, inserted.id)));
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
