import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server";
import type { SessionRuntime, RuntimeMessage } from "./runtime";

let app: FastifyInstance;
let runtime: SessionRuntime;

beforeEach(async () => {
  ({ app, runtime } = await buildServer());
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

describe("runtime REST", () => {
  it("health reports ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("ingests a valid event and updates world state", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/events",
      payload: {
        id: "e1", sessionId: "s1", timestamp: "2026-08-19T00:00:00Z",
        source: "development", type: "development.server_error", severity: "critical", payload: {},
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().worldState.activeProblems[0].kind).toBe("runtime_error");
  });

  it("rejects a malformed event with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/events", payload: { id: "x" } });
    expect(res.statusCode).toBe(400);
  });

  it("emits a simulated incident, morphs the UI, records audit, and reflects it in GET state", async () => {
    const messages: RuntimeMessage[] = [];
    runtime.onMessage((m) => messages.push(m));

    const sim = await app.inject({ method: "POST", url: "/api/sim/s2/http-500" });
    expect(sim.statusCode).toBe(200);
    expect(sim.json().morph.applied).toBe(true);

    const state = await app.inject({ method: "GET", url: "/api/sessions/s2/state" });
    expect(state.json().activeProblems.some((p: { kind: string }) => p.kind === "runtime_error")).toBe(true);

    const ui = await app.inject({ method: "GET", url: "/api/sessions/s2/ui" });
    expect(JSON.stringify(ui.json())).toContain("incident");

    const decisions = await app.inject({ method: "GET", url: "/api/sessions/s2/decisions" });
    expect(decisions.json().audit.some((a: { kind: string }) => a.kind === "ui_morph")).toBe(true);

    expect(messages.some((m) => m.kind === "world_state_changed")).toBe(true);
    expect(messages.some((m) => m.kind === "ui_patch")).toBe(true);
  });

  it("undoes the last morph via REST", async () => {
    await app.inject({ method: "POST", url: "/api/sim/s5/http-500" });
    const undo = await app.inject({ method: "POST", url: "/api/morph/s5/undo" });
    expect(undo.json().undone).toBe(true);
    const ui = await app.inject({ method: "GET", url: "/api/sessions/s5/ui" });
    expect(JSON.stringify(ui.json())).not.toContain('"id":"incident"');
  });

  it("surfaces a pending approval for the risky remediation and executes it on approve", async () => {
    const sim = await app.inject({ method: "POST", url: "/api/sim/s6/http-500" });
    const pending = sim.json().pendingApprovals as { id: string; capabilityId: string }[];
    const revert = pending.find((p) => p.capabilityId === "development.revert_diff");
    expect(revert).toBeTruthy();

    const approve = await app.inject({ method: "POST", url: `/api/approvals/${revert!.id}/approve` });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().result.ok).toBe(true);

    const list = await app.inject({ method: "GET", url: "/api/sessions/s6/approvals" });
    expect(list.json().approvals.some((a: { status: string }) => a.status === "approved")).toBe(true);
  });

  it("persists world + ui snapshots when the UI morphs", async () => {
    // unique session so a reused Postgres instance doesn't accumulate across runs
    const sess = `s7-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await app.inject({ method: "POST", url: `/api/sim/${sess}/http-500` });
    const snaps = await app.inject({ method: "GET", url: `/api/sessions/${sess}/snapshots` });
    const kinds = (snaps.json().snapshots as { kind: string }[]).map((s) => s.kind).sort();
    expect(kinds).toEqual(["ui", "world"]);
  });

  it("serves a seed development UI blueprint per session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions/s3/ui" });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe("development");
  });

  it("records observability traces for ingested events", async () => {
    await app.inject({ method: "POST", url: "/api/sim/s8/http-500" });
    const res = await app.inject({ method: "GET", url: "/api/sessions/s8/traces" });
    const traces = res.json().traces as { eventType: string; morphApplied: boolean }[];
    expect(traces.length).toBeGreaterThan(0);
    expect(traces[traces.length - 1]!.eventType).toBe("development.server_error");
    expect(traces[traces.length - 1]!.morphApplied).toBe(true);
  });

  it("returns 404 for an unknown sim key", async () => {
    const res = await app.inject({ method: "POST", url: "/api/sim/s1/nope" });
    expect(res.statusCode).toBe(404);
  });
});
