import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server";
import { SIM_EVENTS } from "./sim";
import { MatterEvent, KNOWN_EVENT_TYPES } from "@particle/contracts";

/**
 * The simulation palette is how anyone without a broken service of their own sees the runtime
 * work: each key is a button. A key that does not answer is a dead button in the demo, and a
 * spec that is not a valid event is one the runtime would refuse — so every one of them is run
 * here, through the real endpoint.
 */
let app: FastifyInstance;

beforeAll(async () => {
  delete process.env.DM_INGEST_TOKEN;
  app = (await buildServer()).app;
});
afterAll(async () => {
  await app.close();
});

const keys = Object.keys(SIM_EVENTS);

describe("the palette itself", () => {
  it("offers something to simulate", () => {
    expect(keys.length).toBeGreaterThan(8);
  });

  it("gives every key a label, a type and a severity", () => {
    for (const [key, spec] of Object.entries(SIM_EVENTS)) {
      expect(spec.label.length, key).toBeGreaterThan(0);
      expect(spec.type.length, key).toBeGreaterThan(0);
      expect(["debug", "info", "notice", "warning", "critical"], key).toContain(spec.severity);
    }
  });

  it("uses keys that survive being put in a URL", () => {
    for (const key of keys) {
      expect(key, key).toMatch(/^[a-z0-9-]+$/);
      expect(encodeURIComponent(key), key).toBe(key);
    }
  });

  it("names event types the runtime actually knows", () => {
    const known = new Set<string>(KNOWN_EVENT_TYPES);
    for (const [key, spec] of Object.entries(SIM_EVENTS)) {
      expect(known.has(spec.type), `${key} -> ${spec.type}`).toBe(true);
    }
  });

  it("can tell a story: something breaks, and something recovers", () => {
    const types = Object.values(SIM_EVENTS).map((s) => s.type);
    expect(types).toContain("development.server_error");
    expect(types).toContain("development.server_recovered");
    expect(types).toContain("security.vulnerability_detected");
    expect(types).toContain("network.request");
  });
});

describe("every button in the palette works", () => {
  it("answers for each key, with an event the contract accepts", async () => {
    for (const key of keys) {
      const r = await app.inject({ method: "POST", url: `/api/sim/sim-${key}/${key}` });
      expect(r.statusCode, key).toBe(200);
      const body = JSON.parse(r.body);
      expect(MatterEvent.safeParse(body.event).success, key).toBe(true);
      expect(body.event.type, key).toBe(SIM_EVENTS[key]!.type);
      expect(body.worldState.sessionId, key).toBe(`sim-${key}`);
    }
  });

  it("refuses a key nobody defined, without touching the session", async () => {
    const r = await app.inject({ method: "POST", url: "/api/sim/sim-unknown/no-such-key" });
    expect(r.statusCode).toBe(404);
    expect(JSON.parse(r.body).error).toContain("no-such-key");
    const sessions = JSON.parse((await app.inject({ method: "GET", url: "/api/sessions" })).body).sessions;
    expect(sessions.some((s: { sessionId: string }) => s.sessionId === "sim-unknown")).toBe(false);
  });

  it("reshapes the body for the incident, and puts it back on recovery", async () => {
    const session = "sim-story";
    await app.inject({ method: "POST", url: `/api/sim/${session}/http-500` });
    const troubled = JSON.parse((await app.inject({ method: "GET", url: `/api/sessions/${session}/ui` })).body);
    expect(JSON.stringify(troubled)).toContain("incident");
    expect(JSON.parse((await app.inject({ method: "GET", url: `/api/sessions/${session}/state` })).body).activeProblems).toHaveLength(1);

    await app.inject({ method: "POST", url: `/api/sim/${session}/recovered` });
    const calm = JSON.parse((await app.inject({ method: "GET", url: `/api/sessions/${session}/ui` })).body);
    expect(JSON.stringify(calm)).not.toContain('"incident"');
    expect(JSON.parse((await app.inject({ method: "GET", url: `/api/sessions/${session}/state` })).body).activeProblems).toEqual([]);
  });

  it("gates the remediation the security story proposes", async () => {
    const session = "sim-security";
    const r = await app.inject({ method: "POST", url: `/api/sim/${session}/vuln` });
    const pending = JSON.parse(r.body).pendingApprovals;
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].risk).toBe("external_effect");
    expect(pending[0].sessionId).toBe(session);
  });

  it("reads failing traffic as shape, and clears it when the host answers again", async () => {
    const session = "sim-net";
    await app.inject({ method: "POST", url: `/api/sim/${session}/api-503` });
    const failing = JSON.parse((await app.inject({ method: "GET", url: `/api/sessions/${session}/state` })).body);
    expect(failing.behavior.network.failingHosts).toEqual(["api.example.com"]);

    await app.inject({ method: "POST", url: `/api/sim/${session}/api-ok` });
    const back = JSON.parse((await app.inject({ method: "GET", url: `/api/sessions/${session}/state` })).body);
    expect(back.behavior.network.failingHosts).toEqual([]);
  });

  it("keeps each simulated session apart from the others", async () => {
    await app.inject({ method: "POST", url: "/api/sim/sim-a/http-500" });
    await app.inject({ method: "POST", url: "/api/sim/sim-b/build-failed" });
    const a = JSON.parse((await app.inject({ method: "GET", url: "/api/sessions/sim-a/state" })).body);
    const b = JSON.parse((await app.inject({ method: "GET", url: "/api/sessions/sim-b/state" })).body);
    expect(a.activeProblems.map((p: { kind: string }) => p.kind)).toEqual(["runtime_error"]);
    expect(b.activeProblems.map((p: { kind: string }) => p.kind)).toEqual(["build_failure"]);
  });
});
