import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server";
import type { SessionRuntime } from "./runtime";
import { InMemorySnapshotStore, InMemoryEventLogStore } from "@particle/persistence";
import { SessionRuntime as Runtime } from "./runtime";

/**
 * Every ingest writes three snapshots — world, body, memory — and a resume reads exactly one of
 * each: the most recent. The store kept every one ever written, so a single busy session filled
 * it and pushed out the snapshots of every quiet session beside it. Those sessions then resumed
 * to nothing, silently, having done nothing wrong.
 *
 * This is the end of that path, through the real endpoints: what is written, what survives a
 * neighbour, and what comes back.
 */
let app: FastifyInstance;
let runtime: SessionRuntime;

beforeEach(async () => {
  ({ app, runtime } = await buildServer());
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

const ingest = (session: string, key = "http-500") => app.inject({ method: "POST", url: `/api/sim/${session}/${key}` });
const resume = (session: string) => app.inject({ method: "POST", url: `/api/sessions/${session}/resume` });

describe("a session that has been running", () => {
  it("comes back from where it was", async () => {
    await ingest("back");
    const r = await resume("back");
    expect(r.statusCode).toBe(200);
    expect(r.json().resumed).toBe(true);
    expect(JSON.stringify(r.json().blueprint)).toContain("incident");
  });

  it("comes back after a neighbour has been busy", async () => {
    // The whole point: a quiet session used to lose its snapshots to a busy one's traffic. The
    // volume does not have to be large to show it, because the store now keeps the latest of each
    // kind per session rather than a shared ring — how many a neighbour writes stops mattering at
    // one. The store's own test carries the volume, two thousand writes in memory, for nothing.
    //
    // This one ran three hundred ingests and timed out on CI at 5.08s against a real Postgres,
    // where every ingest is six round trips. It is the walk through the real endpoints that has
    // value here, not the count.
    await ingest("quiet");
    for (let i = 0; i < 30; i++) await ingest("busy", i % 2 ? "http-500" : "recovered");

    const r = await resume("quiet");
    expect(r.json().resumed).toBe(true);
    expect(runtime.audit.list("quiet").map((x) => x.kind)).toContain("session_resumed");
  }, 30_000);

  it("comes back to its own state, never a neighbour's", async () => {
    await ingest("mine", "http-500");
    await ingest("theirs", "vuln");

    const mine = await resume("mine");
    expect(JSON.stringify(mine.json().blueprint)).toContain("incident");
    const state = (await app.inject({ method: "GET", url: "/api/sessions/mine/state" })).json();
    expect(state.activeProblems.map((p: { kind: string }) => p.kind)).toEqual(["runtime_error"]);
  });

  it("keeps the latest of each kind and nothing older", async () => {
    const snaps = new InMemorySnapshotStore();
    const rt = new Runtime(() => new Date().toISOString(), new InMemoryEventLogStore(), snaps);
    for (let i = 0; i < 50; i++) {
      await rt.ingest({
        id: `e${i}`, sessionId: "keep", timestamp: "2026-09-05T00:00:00Z",
        source: "development", type: "development.server_error", severity: "critical", payload: {},
      });
    }
    const kept = await snaps.list("keep");
    expect(kept.length).toBeLessThanOrEqual(3);
    expect(new Set(kept.map((s) => s.kind))).toEqual(new Set(["world", "ui", "memory"]));
  });
});

describe("a session with nothing behind it", () => {
  it("says it was not resumed rather than handing back a fresh body", async () => {
    const r = await resume("never-ran");
    expect(r.statusCode).toBe(200);
    expect(r.json().resumed).toBe(false);
    expect(r.json().blueprint).toBeNull();
  });

  it("is not brought into being by asking", async () => {
    await resume("never-ran");
    const sessions = (await app.inject({ method: "GET", url: "/api/sessions" })).json().sessions ?? [];
    expect(sessions.some((s: { sessionId: string }) => s.sessionId === "never-ran")).toBe(false);
  });
});
