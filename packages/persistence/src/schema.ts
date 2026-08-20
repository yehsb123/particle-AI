import { pgTable, text, jsonb, serial, index } from "drizzle-orm/pg-core";

/** Append-only event log. `data` holds the full validated MatterEvent (JSONB). */
export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    timestamp: text("timestamp").notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => ({ bySession: index("events_session_idx").on(t.sessionId) }),
);

/** World/UI snapshots for inspection and fast resume. */
export const snapshots = pgTable(
  "snapshots",
  {
    id: serial("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    kind: text("kind").notNull(),
    at: text("at").notNull(),
    data: jsonb("data").notNull(),
  },
  (t) => ({ bySession: index("snapshots_session_idx").on(t.sessionId) }),
);
