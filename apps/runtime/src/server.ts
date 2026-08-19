import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { SessionRuntime } from "./runtime";
import { SIM_EVENTS } from "./sim";

export type BuildResult = { app: FastifyInstance; runtime: SessionRuntime };

function isoNow(): string {
  return new Date().toISOString();
}

export async function buildServer(): Promise<BuildResult> {
  const app = Fastify({ logger: false });
  const runtime = new SessionRuntime(isoNow);

  // Minimal permissive CORS for the local web app.
  app.addHook("onRequest", async (req, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-headers", "content-type");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    if (req.method === "OPTIONS") reply.code(204).send();
  });

  await app.register(websocket);

  app.get("/health", async () => ({ ok: true, events: runtime.store.count() }));

  app.post("/api/events", async (req, reply) => {
    try {
      const { event, worldState } = runtime.ingest(req.body);
      return { event, worldState };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/state", async (req) => {
    return runtime.getWorld(req.params.id);
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/events", async (req) => {
    return { events: runtime.store.listBySession(req.params.id) };
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id/ui", async (req) => {
    return runtime.getUI(req.params.id);
  });

  app.get("/api/sim", async () => ({
    events: Object.entries(SIM_EVENTS).map(([key, s]) => ({ key, label: s.label, type: s.type })),
  }));

  app.post<{ Params: { id: string; key: string } }>("/api/sim/:id/:key", async (req, reply) => {
    const spec = SIM_EVENTS[req.params.key];
    if (!spec) {
      reply.code(404);
      return { error: `unknown sim event: ${req.params.key}` };
    }
    const { event, worldState } = runtime.ingest({
      id: crypto.randomUUID(),
      sessionId: req.params.id,
      timestamp: isoNow(),
      source: spec.source,
      type: spec.type,
      severity: spec.severity,
      payload: spec.payload ?? {},
    });
    return { event, worldState };
  });

  // WebSocket: push current state, then live world/ui updates for this session.
  app.get<{ Params: { id: string } }>("/ws/sessions/:id", { websocket: true }, (socket, req) => {
    const sessionId = req.params.id;
    socket.send(JSON.stringify({ kind: "world_state_changed", sessionId, worldState: runtime.getWorld(sessionId) }));
    const off = runtime.onMessage((msg) => {
      if (msg.sessionId === sessionId) {
        try {
          socket.send(JSON.stringify(msg));
        } catch {
          /* socket closing */
        }
      }
    });
    socket.on("close", off);
  });

  return { app, runtime };
}
