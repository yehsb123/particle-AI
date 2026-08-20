import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { createPersistence, type Persistence } from "@particle/persistence";
import { describeProviders } from "@particle/intelligence";
import { SessionRuntime } from "./runtime";
import { SIM_EVENTS } from "./sim";

export type BuildResult = { app: FastifyInstance; runtime: SessionRuntime; persistence: Persistence };

function isoNow(): string {
  return new Date().toISOString();
}

export async function buildServer(): Promise<BuildResult> {
  const app = Fastify({ logger: false });
  const persistence = await createPersistence(process.env.DATABASE_URL);
  const runtime = new SessionRuntime(isoNow, persistence.events, persistence.snapshots);
  app.addHook("onClose", async () => {
    await persistence.close();
  });

  app.addHook("onRequest", async (req, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-headers", "content-type");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    // MUST return the reply to short-circuit the OPTIONS lifecycle (else double-send error).
    if (req.method === "OPTIONS") return reply.code(204).send();
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

  await app.register(websocket);

  app.get("/health", async () => ({ ok: true, events: runtime.store.count(), backend: persistence.backend }));

  app.get("/api/brain", async () => ({ providers: await describeProviders(process.env) }));

  app.post("/api/events", async (req, reply) => {
    try {
      const { event, result } = await runtime.ingest(req.body);
      return { event, worldState: result.worldState, morph: result.morph, decision: result.decision, deliberated: result.deliberated, pendingApprovals: result.pendingApprovals };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/state", async (req) => runtime.getWorld(req.params.id));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/events", async (req) => ({ events: runtime.store.listBySession(req.params.id) }));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/ui", async (req) => runtime.getUI(req.params.id));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/decisions", async (req) => ({ audit: runtime.audit.list(req.params.id) }));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/traces", async (req) => ({ traces: runtime.traces.list(req.params.id) }));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/approvals", async () => ({ approvals: runtime.approvals.list() }));
  app.get<{ Params: { id: string } }>("/api/sessions/:id/snapshots", async (req) => ({ snapshots: await persistence.snapshots.list(req.params.id) }));

  app.get("/api/sim", async () => ({
    events: Object.entries(SIM_EVENTS).map(([key, s]) => ({ key, label: s.label, type: s.type })),
  }));

  app.post<{ Params: { id: string; key: string } }>("/api/sim/:id/:key", async (req, reply) => {
    const spec = SIM_EVENTS[req.params.key];
    if (!spec) {
      reply.code(404);
      return { error: `unknown sim event: ${req.params.key}` };
    }
    const { event, result } = await runtime.ingest({
      id: crypto.randomUUID(),
      sessionId: req.params.id,
      timestamp: isoNow(),
      source: spec.source,
      type: spec.type,
      severity: spec.severity,
      payload: spec.payload ?? {},
    });
    return { event, worldState: result.worldState, morph: result.morph, deliberated: result.deliberated, pendingApprovals: result.pendingApprovals };
  });

  app.post<{ Params: { id: string } }>("/api/morph/:id/undo", async (req) => {
    const blueprint = runtime.undo(req.params.id);
    return { undone: !!blueprint, blueprint };
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
    socket.send(JSON.stringify({ kind: "world_state_changed", sessionId, worldState: runtime.getWorld(sessionId) }));
    const off = runtime.onMessage((msg) => {
      if (msg.sessionId === sessionId) {
        try { socket.send(JSON.stringify(msg)); } catch { /* closing */ }
      }
    });
    socket.on("close", off);
  });

  return { app, runtime, persistence };
}
