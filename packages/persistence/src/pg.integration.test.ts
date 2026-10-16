import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { createPersistence } from "./factory";
import { connect, ensureSchema, eventsFromRows, PgEventLogStore } from "./pg";
import { events } from "./schema";
import type { MatterEvent } from "@particle/contracts";

const url = process.env.DATABASE_URL;

// Only runs when a database is configured; otherwise skipped (keeps `pnpm test` green offline).
describe.skipIf(!url)("postgres persistence (DATABASE_URL)", () => {
  it("persists and reads back events and snapshots", async () => {
    const p = await createPersistence(url);
    expect(p.backend).toBe("postgres");

    const session = `it-${Date.now()}`;
    const ev: MatterEvent = {
      id: `${session}-e1`, sessionId: session, timestamp: "2026-08-19T00:00:00Z",
      source: "development", type: "development.server_error", severity: "critical", payload: {},
    };
    await p.events.append(ev);
    await p.events.append(ev); // idempotent (onConflictDoNothing)
    const rows = await p.events.listBySession(session);
    expect(rows.filter((r) => r.id === ev.id)).toHaveLength(1);

    await p.snapshots.save({ sessionId: session, kind: "ui", at: "t", data: { a: 1 } });
    await p.snapshots.save({ sessionId: session, kind: "world", at: "t", data: { b: 2 } });
    expect(await p.snapshots.list(session)).toHaveLength(2);
    expect(await p.snapshots.list(session, "ui")).toHaveLength(1);

    await p.close();
  });
});

/**
 * A row in this table was written by whichever build was running then, and comes back as the
 * outside data it is. Casting it to a MatterEvent only promised it was one: a row from an older
 * shape travelled on into the listing, the world state and the prompt as though the schema had
 * seen it. And a session that had been running for months handed back every row it ever wrote.
 */
describe.skipIf(!url)("what the postgres event log hands back", () => {
  const ev = (session: string, n: number): MatterEvent => ({
    id: `${session}-e${n}`,
    sessionId: session,
    timestamp: `2026-10-16T00:00:0${n}.000Z`,
    source: "development",
    type: "development.server_error",
    severity: "critical",
    payload: {},
  });

  it("leaves out a row that is not an event, and keeps the rest", async () => {
    const { sql, db } = connect(url!);
    await ensureSchema(sql);
    const session = `junk-${Date.now()}`;
    const store = new PgEventLogStore(db);
    await store.append(ev(session, 1));
    await db.insert(events).values({
      id: `${session}-older-build`,
      sessionId: session,
      timestamp: "2026-10-16T00:00:02.000Z",
      data: { id: `${session}-older-build`, sessionId: session, kind: "what an older build called an event" },
    });
    await store.append(ev(session, 3));

    expect((await store.listBySession(session)).map((e) => e.id)).toEqual([`${session}-e1`, `${session}-e3`]);
    await db.delete(events).where(eq(events.sessionId, session));
    await sql.end();
  });

  it("hands back the newest events up to its bound, oldest first", async () => {
    const { sql, db } = connect(url!);
    await ensureSchema(sql);
    const session = `bound-${Date.now()}`;
    const store = new PgEventLogStore(db, 3);
    for (let n = 1; n <= 5; n++) await store.append(ev(session, n));

    expect((await store.listBySession(session)).map((e) => e.id)).toEqual([
      `${session}-e3`,
      `${session}-e4`,
      `${session}-e5`,
    ]);
    await db.delete(events).where(eq(events.sessionId, session));
    await sql.end();
  });
});

// Needs no database: this is the rule every stored row is read back under.
describe("reading stored rows back as events", () => {
  const stored = (over: Record<string, unknown> = {}) => ({
    data: {
      id: "e1", sessionId: "s1", timestamp: "2026-10-16T00:00:00.000Z",
      source: "development", type: "development.server_error", severity: "critical", payload: {},
      ...over,
    },
  });

  it("keeps the rows that parse and leaves out the ones that do not", () => {
    const kept = eventsFromRows([
      stored({ id: "keep-1" }),
      stored({ id: "drop-older-build", severity: "catastrophic" }),
      { data: { note: "whatever a build long gone called an event" } },
      { data: null },
      stored({ id: "keep-2" }),
    ]);
    expect(kept.map((e) => e.id)).toEqual(["keep-1", "keep-2"]);
  });

  it("hands back parsed events rather than the rows themselves", () => {
    const [event] = eventsFromRows([stored({ metadata: { host: "example.test" } })]);
    expect(event?.type).toBe("development.server_error");
    expect(event?.metadata).toEqual({ host: "example.test" });
  });
});

describe("createPersistence (no url)", () => {
  it("falls back to the in-memory backend", async () => {
    const p = await createPersistence(undefined);
    expect(p.backend).toBe("memory");
    await p.events.append({
      id: "m1", sessionId: "s", timestamp: "t", source: "system", type: "x", severity: "info", payload: {},
    });
    expect(await p.events.all()).toHaveLength(1);
    await p.close();
  });
});
