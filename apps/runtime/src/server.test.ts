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

  it("emits a simulated incident and reflects it in GET state", async () => {
    const messages: RuntimeMessage[] = [];
    runtime.onMessage((m) => messages.push(m));

    const sim = await app.inject({ method: "POST", url: "/api/sim/s2/http-500" });
    expect(sim.statusCode).toBe(200);

    const state = await app.inject({ method: "GET", url: "/api/sessions/s2/state" });
    expect(state.json().activeProblems.some((p: { kind: string }) => p.kind === "runtime_error")).toBe(true);
    expect(messages.some((m) => m.kind === "world_state_changed")).toBe(true);
  });

  it("serves a seed development UI blueprint per session", async () => {
    const res = await app.inject({ method: "GET", url: "/api/sessions/s3/ui" });
    expect(res.statusCode).toBe(200);
    expect(res.json().mode).toBe("development");
  });

  it("returns 404 for an unknown sim key", async () => {
    const res = await app.inject({ method: "POST", url: "/api/sim/s1/nope" });
    expect(res.statusCode).toBe(404);
  });
});
