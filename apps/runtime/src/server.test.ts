import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server";
import { SessionRuntime, type RuntimeMessage } from "./runtime";

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
    expect(Array.isArray(sim.json().patternSuggestions)).toBe(true); // connected-mode parity

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
    expect(kinds).toEqual(["memory", "ui", "world"]);
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

  it("sets and reports the autonomy level", async () => {
    expect((await app.inject({ method: "GET", url: "/api/autonomy" })).json().level).toBe(2);
    const set = await app.inject({ method: "POST", url: "/api/autonomy/4" });
    expect(set.json().level).toBe(4);
    expect((await app.inject({ method: "GET", url: "/api/autonomy" })).json().level).toBe(4);
    expect((await app.inject({ method: "POST", url: "/api/autonomy/9" })).statusCode).toBe(400);
  });

  it("returns 404 for an unknown sim key", async () => {
    const res = await app.inject({ method: "POST", url: "/api/sim/s1/nope" });
    expect(res.statusCode).toBe(404);
  });
});

describe("runtime access control", () => {
  const valid = {
    id: "c1", sessionId: "cors", timestamp: "2026-08-31T00:00:00Z",
    source: "sensor", type: "network.request", severity: "info", payload: { host: "h", status: 200 },
  };
  it("grants CORS only to allow-listed origins and refuses writes from any other page", async () => {
    const bad = await app.inject({ method: "POST", url: "/api/events", headers: { origin: "https://evil.example" }, payload: valid });
    expect(bad.statusCode).toBe(403);
    const pre = await app.inject({ method: "OPTIONS", url: "/api/events", headers: { origin: "https://evil.example" } });
    expect(pre.headers["access-control-allow-origin"]).toBeUndefined();
    const ok = await app.inject({ method: "POST", url: "/api/events", headers: { origin: "http://localhost:3000" }, payload: valid });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const ext = await app.inject({ method: "POST", url: "/api/events", headers: { origin: "chrome-extension://abcdefgh" }, payload: { ...valid, id: "c2" } });
    expect(ext.statusCode).toBe(200);
    const noOrigin = await app.inject({ method: "POST", url: "/api/events", payload: { ...valid, id: "c3" } });
    expect(noOrigin.statusCode).toBe(200); // agent / curl: no Origin header, no token configured
  });
  it("scopes the approvals listing to the session in the URL", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions/other/approvals" });
    expect(res.json().approvals).toEqual([]);
  });
});

describe("runtime access control — reads are protected too", () => {
  it("refuses reads from a non-allow-listed browser origin and requires the token on reads when configured", async () => {
    const bad = await app.inject({ method: "GET", url: "/api/sessions/s1/state", headers: { origin: "https://evil.example" } });
    expect(bad.statusCode).toBe(403);
    process.env.DM_INGEST_TOKEN = "t0k";
    try {
      const { app: secured } = await buildServer();
      await secured.ready();
      try {
        expect((await secured.inject({ method: "GET", url: "/api/sessions/s1/state" })).statusCode).toBe(401);
        expect((await secured.inject({ method: "GET", url: "/api/sessions/s1/state", headers: { "x-particle-token": "t0k" } })).statusCode).toBe(200);
        // ?token= is honoured ONLY on the WS upgrade path (browsers cannot set headers there) — not on REST
        expect((await secured.inject({ method: "GET", url: "/api/sessions/s1/state?token=t0k" })).statusCode).toBe(401);
        expect((await secured.inject({ method: "GET", url: "/health" })).statusCode).toBe(200); // probe stays open
      } finally {
        await secured.close();
      }
    } finally {
      delete process.env.DM_INGEST_TOKEN;
    }
  });
  it("reading an unknown session does not create it (no eviction by junk ids)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions/ghost/state" });
    expect(res.statusCode).toBe(200);
    expect(res.json().sessionId).toBe("ghost");
    expect(runtime.core.hasSession("ghost")).toBe(false);
  });
  it("undo carries attribution (componentId / learn) to the core", async () => {
    // surface an incident, then dismiss with learn:false — nothing must be learned
    await app.inject({ method: "POST", url: "/api/sim/u1/http-500" });
    const res = await app.inject({ method: "POST", url: "/api/morph/u1/undo", payload: { componentId: "incident", learn: false } });
    expect(res.json().undone).toBe(true);
    // morph:* reinforcement is normal; no dismissal may have been learned
    expect(runtime.core.exportMemory("u1").preferences.filter((p) => p.key.startsWith("dismissed:"))).toEqual([]);
  });
});

describe("runtime reconcile timer", () => {
  it("a pending reconcile survives unrelated events and surfaces the open problem (fake timers)", async () => {
    // isolated runtime WITHOUT persistence: fake timers must never touch the Postgres driver's
    // internal timers (that hangs every await on CI, where DATABASE_URL is set)
    const rt = new SessionRuntime(() => new Date().toISOString());
    vi.useFakeTimers();
    try {
      const mk = (id: string, type: string, sev: string, source = "development", payload: Record<string, unknown> = {}) => ({
        id, sessionId: "rt1", timestamp: new Date().toISOString(), source, type, severity: sev, payload,
      });
      await rt.ingest(mk("b1", "development.build_failed", "warning"));
      await rt.ingest(mk("b2", "development.build_succeeded", "info"));
      const held = await rt.ingest(mk("b3", "development.build_failed", "warning"));
      expect(held.result.morph.applied).toBe(false);
      expect(held.result.retryAfterMs).toBeGreaterThan(0);
      // an unrelated, insignificant event must NOT cancel the pending tick
      await rt.ingest(mk("i1", "user.interaction", "debug", "user", { count: 3 }));
      await vi.advanceTimersByTimeAsync((held.result.retryAfterMs ?? 5_000) + 250);
      const types = rt.store.listBySession("rt1").map((e) => e.type);
      expect(types).toContain("runtime.reconcile");
      expect(JSON.stringify(rt.getUI("rt1"))).toContain("Build failure");
    } finally {
      vi.useRealTimers();
    }
  });
});
