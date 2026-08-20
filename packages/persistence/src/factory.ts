import {
  InMemoryEventLogStore,
  InMemorySnapshotStore,
  type EventLogStore,
  type SnapshotStore,
} from "./index";
import { connect, ensureSchema, PgEventLogStore, PgSnapshotStore } from "./pg";

export type Persistence = {
  events: EventLogStore;
  snapshots: SnapshotStore;
  backend: "memory" | "postgres";
  close(): Promise<void>;
};

/**
 * Build persistence from an optional DATABASE_URL. With no URL, the runtime uses the
 * deterministic in-memory stores (replay covers durability for the demo). With a URL, it
 * connects to Postgres and ensures the schema — same interfaces either way.
 */
export async function createPersistence(databaseUrl?: string): Promise<Persistence> {
  if (!databaseUrl) {
    return {
      events: new InMemoryEventLogStore(),
      snapshots: new InMemorySnapshotStore(),
      backend: "memory",
      async close() {},
    };
  }
  const { sql, db } = connect(databaseUrl);
  await ensureSchema(sql);
  return {
    events: new PgEventLogStore(db),
    snapshots: new PgSnapshotStore(db),
    backend: "postgres",
    async close() {
      await sql.end();
    },
  };
}
