import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, ingestFailure } from "./server";
import { MatterEvent } from "@particle/contracts";

/**
 * The runtime holds a picture of what someone is doing — which hosts answered slowly, which
 * files were saved, what the interface currently shows. The two things standing between that and
 * any page in the browser are the origin allow-list and, when configured, a shared token. Reads
 * matter as much as writes here, and a WebSocket upgrade is not covered by CORS at all, so the
 * refusal has to happen in the request hook rather than in a header.
 */
const event = (id: string, sessionId = "acl") => ({
  id,
  sessionId,
  timestamp: new Date().toISOString(),
  source: "development" as const,
  type: "development.server_error",
  severity: "critical" as const,
  payload: {},
});

describe("origins", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.DM_ALLOWED_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000";
    delete process.env.DM_INGEST_TOKEN;
    app = (await buildServer()).app;
  });
  afterAll(async () => {
    await app.close();
  });

  it("grants an allow-listed page CORS and lets it write", async () => {
    const r = await app.inject({ method: "POST", url: "/api/events", payload: event("e1"), headers: { origin: "http://localhost:3000" } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(r.headers["vary"]).toBe("origin");
  });

  it("honours both spellings of the same page", async () => {
    const r = await app.inject({ method: "GET", url: "/api/sessions", headers: { origin: "http://127.0.0.1:3000" } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:3000");
  });

  it("refuses any other page — reads included", async () => {
    for (const url of ["/api/sessions", "/api/sessions/acl/state", "/api/sessions/acl/ui", "/api/sessions/acl/events", "/api/sessions/acl/traces", "/api/sessions/acl/decisions", "/health"]) {
      const r = await app.inject({ method: "GET", url, headers: { origin: "https://evil.example" } });
      expect(r.statusCode, url).toBe(403);
      expect(r.headers["access-control-allow-origin"], url).toBeUndefined();
      expect(JSON.parse(r.body).error).toBe("origin not allowed");
    }
  });

  it("refuses a WebSocket upgrade from another page, which CORS would not have stopped", async () => {
    const r = await app.inject({ method: "GET", url: "/ws/sessions/acl", headers: { origin: "https://evil.example", connection: "upgrade", upgrade: "websocket" } });
    expect(r.statusCode).toBe(403);
  });

  it("refuses a near-miss origin — no prefix, port or scheme sloppiness", async () => {
    for (const origin of ["http://localhost:3001", "https://localhost:3000", "http://localhost:3000.evil.example", "http://localhost", "null", "http://localhost:3000/"]) {
      const r = await app.inject({ method: "GET", url: "/api/sessions", headers: { origin } });
      expect(r.statusCode, origin).toBe(403);
    }
  });

  it("lets the extension in, whichever id the browser gave it", async () => {
    // an unpacked extension's id differs per machine, so the scheme is what can be checked
    const r = await app.inject({ method: "GET", url: "/api/sessions", headers: { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdefghijklmnopabcdefghijklmnop");
  });

  it("answers a preflight without running the route, and grants nothing to a page it does not know", async () => {
    const allowed = await app.inject({ method: "OPTIONS", url: "/api/events", headers: { origin: "http://localhost:3000" } });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(allowed.headers["access-control-allow-headers"]).toContain("x-particle-token");
    expect(allowed.headers["access-control-allow-methods"]).toContain("POST");

    const refused = await app.inject({ method: "OPTIONS", url: "/api/events", headers: { origin: "https://evil.example" } });
    expect(refused.statusCode).toBe(204);
    expect(refused.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("serves a client that sends no origin at all — the agent, curl, a test", async () => {
    const r = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("the shared token, when one is configured", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    process.env.DM_INGEST_TOKEN = "s3cret";
    process.env.DM_ALLOWED_ORIGINS = "http://localhost:3000";
    app = (await buildServer()).app;
  });
  afterAll(async () => {
    delete process.env.DM_INGEST_TOKEN;
    await app.close();
  });

  it("guards every read and write", async () => {
    for (const [method, url] of [["GET", "/api/sessions"], ["GET", "/api/sessions/acl/state"], ["POST", "/api/events"], ["POST", "/api/morph/acl/undo"], ["GET", "/api/brain"], ["GET", "/api/autonomy"]] as const) {
      const r = await app.inject({ method, url, payload: method === "POST" ? {} : undefined });
      expect(r.statusCode, url).toBe(401);
      expect(JSON.parse(r.body).error).toBe("token required");
    }
  });

  it("accepts the right token in the header and refuses a wrong one", async () => {
    expect((await app.inject({ method: "GET", url: "/api/sessions", headers: { "x-particle-token": "s3cret" } })).statusCode).toBe(200);
    for (const bad of ["", "wrong", "s3cre", "s3cret ", "S3CRET"]) {
      expect((await app.inject({ method: "GET", url: "/api/sessions", headers: { "x-particle-token": bad } })).statusCode, bad).toBe(401);
    }
  });

  it("takes the token in the query only for the socket, where headers cannot be set", async () => {
    expect((await app.inject({ method: "GET", url: "/api/sessions?token=s3cret" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/sessions/acl/state?token=s3cret" })).statusCode).toBe(401);
    // the upgrade itself passes the token check (inject cannot complete an upgrade, so 404 here
    // means it got past the hook and reached routing, while a wrong token stops at 401)
    expect((await app.inject({ method: "GET", url: "/ws/sessions/acl?token=wrong" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/ws/sessions/acl?token=s3cret" })).statusCode).not.toBe(401);
  });

  it("does not let a path that merely mentions the socket carry a query token", async () => {
    for (const url of ["/ws/../api/sessions?token=s3cret", "/api/ws/sessions?token=s3cret", "/api/sessions/ws/?token=s3cret"]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
  });

  it("leaves the health probe open, and only the health probe", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    for (const url of ["/health?x=1", "/health/", "//health"]) {
      expect((await app.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
  });

  it("checks the origin before the token, so an unknown page learns nothing about either", async () => {
    const r = await app.inject({ method: "GET", url: "/api/sessions", headers: { origin: "https://evil.example", "x-particle-token": "s3cret" } });
    expect(r.statusCode).toBe(403);
  });
});

describe("what a failure tells the caller", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    delete process.env.DM_INGEST_TOKEN;
    app = (await buildServer()).app;
  });
  afterAll(async () => {
    await app.close();
  });

  it("explains a malformed event, since that is the caller's to fix", async () => {
    const r = await app.inject({ method: "POST", url: "/api/events", payload: { nonsense: true } });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("sessionId");
  });

  it("keeps our own failures to ourselves", () => {
    // a storage error carries hostnames, ports and query text, and is not a bad request
    expect(ingestFailure(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toEqual({ code: 500, body: { error: "internal error" } });
    expect(ingestFailure("a bare string")).toEqual({ code: 500, body: { error: "internal error" } });
    expect(ingestFailure(undefined)).toEqual({ code: 500, body: { error: "internal error" } });
  });

  it("passes validation detail through, and only validation detail", () => {
    let zodError: unknown;
    try {
      MatterEvent.parse({});
    } catch (err) {
      zodError = err;
    }
    const mapped = ingestFailure(zodError);
    expect(mapped.code).toBe(400);
    expect(mapped.body.error).toContain("sessionId");
  });

  it("answers an unknown route without echoing the path back", async () => {
    const r = await app.inject({ method: "GET", url: "/definitely/not/a/route" });
    expect(r.statusCode).toBe(404);
    expect(JSON.parse(r.body)).toEqual({ error: "not found" });
    expect(r.body).not.toContain("definitely");
  });

  it("says what is wrong with an autonomy level without accepting it", async () => {
    for (const level of ["9", "-1", "notanumber", "2.5"]) {
      const r = await app.inject({ method: "POST", url: `/api/autonomy/${level}` });
      expect(r.statusCode, level).toBe(400);
    }
    expect((await app.inject({ method: "POST", url: "/api/autonomy/4" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/autonomy/2" })).statusCode).toBe(200);
  });

  it("refuses a simulation nobody defined, and an approval nobody is waiting for", async () => {
    expect((await app.inject({ method: "POST", url: "/api/sim/acl/no-such-scenario" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/approvals/appr-nope/approve" })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/approvals/appr-nope/reject" })).statusCode).toBe(404);
  });

  it("never creates a session for a read, however the id is spelled", async () => {
    for (const id of ["never-seen", "..", "%20", "a".repeat(200)]) {
      await app.inject({ method: "GET", url: `/api/sessions/${id}/state` });
    }
    expect(JSON.parse((await app.inject({ method: "GET", url: "/api/sessions" })).body).sessions).toEqual([]);
  });
});
