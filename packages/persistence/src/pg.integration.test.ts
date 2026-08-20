import { describe, it, expect } from "vitest";
import { createPersistence } from "./factory";
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
