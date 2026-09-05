import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { createPersistence, type Persistence } from "@particle/persistence";
import { describeProviders } from "@particle/intelligence";
import { SessionRuntime } from "./runtime";
import { SIM_EVENTS, simEvent, buildSimEvent, SessionId, MAX_IDENTIFIER, MAX_FAILURE_MESSAGE } from "@particle/contracts";

export type BuildResult = { app: FastifyInstance; runtime: SessionRuntime; persistence: Persistence };

function isoNow(): string {
  return new Date().toISOString();
}

/**
 * What to answer when an ingest fails. A malformed event is the caller's to fix, so it is told
 * which fields were wrong and why. Anything else — storage down, a bug — is ours: the caller gets
 * a 500 and nothing about our insides, since those messages carry hostnames, ports and query text.
 *
 * It used to hand back the validator's own message, and that message quotes the value it refused.
 * So a two-hundred-kilobyte field came back as a four-hundred-kilobyte error, control characters
 * and all: the failure path answered a bad request by repeating it, larger. What a caller needs in
 * order to fix an event is where it was wrong and what was expected there — never its own content
 * read back to it.
 */
type ZodIssue = { path?: unknown[]; code?: string; expected?: string };
export function ingestFailure(err: unknown): { code: number; body: { error: string } } {
  const name = (err as { name?: string })?.name;
  if (name !== "ZodError") return { code: 500, body: { error: "internal error" } };
  const issues = (err as { issues?: ZodIssue[] }).issues ?? [];
  const said = issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const where = (issue.path ?? []).map((p) => String(p)).join(".").slice(0, MAX_IDENTIFIER) || "(event)";
    const why = typeof issue.expected === "string" ? `expected ${issue.expected.slice(0, MAX_IDENTIFIER)}` : String(issue.code ?? "invalid");
    return `${where}: ${why}`;
  });
  if (!said.length) return { code: 400, body: { error: "the event did not match the schema" } };
  const more = issues.length > said.length ? ` (and ${issues.length - said.length} more)` : "";
  return { code: 400, body: { error: `${said.join("; ")}${more}`.slice(0, MAX_FAILURE_MESSAGE) } };
}

/** Enough for a caller to see the shape of what is wrong without reading a wall of them. */
const MAX_REPORTED_ISSUES = 10;

/**
 * A session name arriving in a URL never passes through an event schema, so this is where it is
 * held to the same rule the schema holds it to — one hook rather than a check at each of the
 * dozen routes that take one, so a route added later cannot forget it.
 *
 * Refusing is not extra caution: a name that could never have been created has no belief, trail or
 * snapshot to read, and one carrying control characters was being written into the world state a
 * body draws and into every log line and trace that names the session.
 *
 * Every `:id` this server routes on is a session name; the approval routes use `:aid` and the
 * autonomy route `:level`, and neither is one. The answer says nothing about what was sent.
 */
export function badSessionParam(params: unknown): boolean {
  const id = (params as { id?: unknown } | null)?.id;
  return id !== undefined && !SessionId.safeParse(id).success;
}

export async function buildServer(): Promise<BuildResult> {
  // The router refuses a path parameter longer than this before any handler sees it. Left at the
  // framework default it was a hundred, below what a session name may be — so a session that could
  // be created could not be read back, and the answer for one too long came from Fastify rather
  // than from the rule. One limit, named once.
  const app = Fastify({ logger: false, routerOptions: { maxParamLength: MAX_IDENTIFIER } });
  const persistence = await createPersistence(process.env.DATABASE_URL);
  const runtime = new SessionRuntime(isoNow, persistence.events, persistence.snapshots);
  app.addHook("onClose", async () => {
    await persistence.close();
  });

  // Browser access is allow-listed: the body (web) and the extension. Any other page's fetch gets
  // no CORS grant AND an explicit 403 on writes, so a random site cannot inject events into your
  // runtime. Non-browser clients (agent, curl) carry no Origin and are governed by the token.
  const allowedOrigins = new Set(
    (process.env.DM_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const originAllowed = (o: string | undefined): boolean => !!o && (allowedOrigins.has(o) || o.startsWith("chrome-extension://"));
  const token = process.env.DM_INGEST_TOKEN;
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (originAllowed(origin)) {
      reply.header("access-control-allow-origin", origin!);
      reply.header("vary", "origin");
    }
    reply.header("access-control-allow-headers", "content-type, x-particle-token");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    // MUST return the reply to short-circuit the OPTIONS lifecycle (else double-send error).
    if (req.method === "OPTIONS") return reply.code(204).send();
    // A browser page that is not the body/extension gets nothing — reads included (WebSocket
    // upgrades are not covered by CORS, and world state lists every host you visited).
    if (origin && !originAllowed(origin)) return reply.code(403).send({ error: "origin not allowed" });
    // Shared secret (when configured) guards every read and write except the health probe.
    // WebSocket clients cannot set headers → `?token=` is accepted for the upgrade.
    if (token && req.url !== "/health") {
      // ?token= only for the WS upgrade (browsers cannot set headers there); everything else uses the header
      const q = req.url.startsWith("/ws/") ? new URL(req.url, "http://local").searchParams.get("token") : null;
      if (req.headers["x-particle-token"] !== token && q !== token) return reply.code(401).send({ error: "token required" });
    }
  });

  // Never leak internal/DB error messages; map validation to 400, everything else to 500.
  app.setErrorHandler((err, _req, reply) => {
    const e = err as { name?: string; statusCode?: number };
    if (e.name === "ZodError" || e.statusCode === 400) {
      reply.code(400).send({ error: "invalid request" });
      return;
    }
    reply.code(e.statusCode && e.statusCode >= 400 && e.statusCode < 500 ? e.statusCode : 500)
      .send({ error: "internal error" });
  });

  // The default 404 body echoes the path and names the framework; say only what happened.
  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: "not found" });
  });

  await app.register(websocket);

  app.addHook("preHandler", async (req, reply) => {
    if (badSessionParam(req.params)) {
      reply.code(400);
      return reply.send({ error: "not a session name" });
    }
  });

  app.get("/health", async () => ({ ok: true, events: runtime.store.count(), backend: persistence.backend }));

  app.get("/api/brain", async () => ({ providers: await describeProviders(process.env) }));

  app.get("/api/autonomy", async () => ({ level: runtime.getAutonomy() }));
  app.post<{ Params: { level: string } }>("/api/autonomy/:level", async (req, reply) => {
    const n = Number(req.params.level);
    if (![0, 1, 2, 3, 4].includes(n)) { reply.code(400); return { error: "level must be 0-4" }; }
    runtime.setAutonomy(n as 0 | 1 | 2 | 3 | 4);
    return { level: n };
  });

  app.post("/api/events", async (req, reply) => {
    try {
      const { event, result } = await runtime.ingest(req.body);
      return { event, worldState: result.worldState, morph: result.morph, decision: result.decision, deliberated: result.deliberated, pendingApprovals: result.pendingApprovals, patternSuggestions: result.patternSuggestions, learned: result.learned, retryAfterMs: result.retryAfterMs };
    } catch (err) {
      const { code, body } = ingestFailure(err);
      reply.code(code);
      return body;
    }
  });

  // multi-session view: what THIS runtime currently senses, per session (shape only, read-only)
  app.get("/api/sessions", async () => ({ sessions: runtime.core.listSessions() }));

  app.get<{ Params: { id: string } }>("/api/sessions/:id/state", async (req) => runtime.peekWorld(req.params.id));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/events", async (req) => ({ events: runtime.store.listBySession(req.params.id) }));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/ui", async (req) => runtime.peekUI(req.params.id));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/decisions", async (req) => ({ audit: runtime.audit.list(req.params.id) }));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/traces", async (req) => ({ traces: runtime.traces.list(req.params.id) }));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/approvals", async (req) => ({
    approvals: runtime.core.approvalsFor(req.params.id), // by the session on the record, not by its id
  }));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/snapshots", async (req) => ({ snapshots: await persistence.snapshots.list(req.params.id) }));

  app.get("/api/sim", async () => ({
    events: SIM_EVENTS.map((s) => ({ key: s.key, label: s.label, type: s.type })),
  }));

  app.post<{ Params: { id: string; key: string } }>("/api/sim/:id/:key", async (req, reply) => {
    const spec = simEvent(req.params.key);
    if (!spec) {
      reply.code(404);
      return { error: `unknown sim event: ${String(req.params.key).slice(0, 40)}` };
    }
    const { event, result } = await runtime.ingest(
      buildSimEvent(spec, req.params.id, crypto.randomUUID(), isoNow()),
    );
    return { event, worldState: result.worldState, morph: result.morph, deliberated: result.deliberated, pendingApprovals: result.pendingApprovals, patternSuggestions: result.patternSuggestions, learned: result.learned, retryAfterMs: result.retryAfterMs };
  });

  app.post<{ Params: { id: string }; Body: { componentId?: unknown; learn?: unknown } | null }>("/api/morph/:id/undo", async (req) => {
    // attribution travels with the gesture: which card was dismissed, and whether it should teach
    const body = (req.body ?? {}) as { componentId?: unknown; learn?: unknown };
    const blueprint = runtime.undo(req.params.id, {
      componentId: typeof body.componentId === "string" ? body.componentId : undefined,
      learn: typeof body.learn === "boolean" ? body.learn : undefined,
    });
    return { undone: !!blueprint, blueprint };
  });

  app.post<{ Params: { id: string } }>("/api/morph/:id/redo", async (req) => {
    const blueprint = runtime.redo(req.params.id);
    return { redone: !!blueprint, blueprint };
  });

  app.post<{ Params: { id: string } }>("/api/sessions/:id/resume", async (req) => {
    const blueprint = await runtime.resume(req.params.id);
    return { resumed: !!blueprint, blueprint };
  });

  app.post<{ Params: { aid: string } }>("/api/approvals/:aid/approve", async (req, reply) => {
    const outcome = await runtime.approve(req.params.aid);
    if (!outcome) { reply.code(404); return { error: "not found or already decided" }; }
    return { approved: true, capabilityId: outcome.capabilityId, result: outcome.result };
  });
  app.post<{ Params: { aid: string } }>("/api/approvals/:aid/reject", async (req, reply) => {
    const r = runtime.reject(req.params.aid);
    if (!r) { reply.code(404); return { error: "not found" }; }
    return r;
  });

  app.get<{ Params: { id: string } }>("/ws/sessions/:id", { websocket: true }, (socket, req) => {
    const sessionId = req.params.id;
    socket.send(JSON.stringify({ kind: "world_state_changed", sessionId, worldState: runtime.peekWorld(sessionId) }));
    const off = runtime.onMessage((msg) => {
      if (msg.sessionId === sessionId) {
        try { socket.send(JSON.stringify(msg)); } catch { /* closing */ }
      }
    });
    socket.on("close", off);
  });

  return { app, runtime, persistence };
}
