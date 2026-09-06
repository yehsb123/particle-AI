import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer } from "./server";
import type { SessionRuntime } from "./runtime";

/**
 * An event's own name and its type are things the runtime acts on: it routes on the type, and the
 * id names the decision and the trace behind it. They are not captions, and they had no bound and
 * no rule about characters.
 *
 * What that cost, measured on the real server: a two-hundred-thousand character type made the
 * trace behind that event four hundred kilobytes, and the same again in the world-state broadcast
 * every watching body receives, in the events listing, in the snapshot and in the prompt — the
 * belief keeps a recent event whole apart from its payload. An escape sequence in a type reached
 * the inspector row a person reads to find out why their body changed.
 *
 * They are refused rather than trimmed, for the reason a session name is: two types cut to the
 * same length would be one type. A payload value is the opposite case and stays trimmed — it is
 * something shown, not something acted on.
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

const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);
const NEWLINE = String.fromCharCode(10);

const event = (over: Record<string, unknown>) => ({
  id: crypto.randomUUID(),
  sessionId: "s1",
  timestamp: new Date().toISOString(),
  source: "user",
  type: "user.interaction",
  severity: "info",
  payload: { kind: "click" },
  ...over,
});
const post = (over: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/events", payload: event(over) });
const get = (url: string) => app.inject({ method: "GET", url });

describe("what may be an event's name and type", () => {
  it("is every type and id this repo actually sends", async () => {
    // the longest type the runtime knows is 31 characters; the ids are timestamps and uuids
    for (const over of [
      { type: "security.vulnerability_detected" },
      { type: "development.server_error" },
      { type: "sensor.layers_changed" },
      { type: "runtime.reconcile", id: "reconcile" + Date.now() },
      { type: "user.action", id: "u12-" + Date.now() },
      { type: "user.interaction", id: "agent-" + Date.now() + "-ab12cd" },
      { type: "user.interaction", id: crypto.randomUUID() },
    ]) {
      expect((await post(over)).statusCode, JSON.stringify(over)).toBe(200);
    }
  });

  it("is not long enough to be a payload of its own", async () => {
    for (const len of [121, 200_000]) {
      expect((await post({ type: "t".repeat(len) })).statusCode, "type of " + len).toBe(400);
      expect((await post({ id: "i".repeat(len) })).statusCode, "id of " + len).toBe(400);
    }
  });

  it("carries none of the characters that are not writing", async () => {
    for (const type of ["user" + ESC + "[31m.click", "user.click" + NEWLINE + "forged", "user" + NUL + ".click"]) {
      expect((await post({ type })).statusCode).toBe(400);
    }
    expect((await post({ id: "e" + NUL + "1" })).statusCode).toBe(400);
  });

  it("says which of the two was wrong", async () => {
    expect((await post({ type: "t".repeat(200_000) })).json().error).toContain("type");
    expect((await post({ id: "i".repeat(200_000) })).json().error).toContain("id");
  });
});

describe("what one event weighs on the way out", () => {
  it("is a row, not a payload, in everything it travels through", async () => {
    // one event used to make each of these four hundred kilobytes
    expect((await post({ sessionId: "big", type: "development.server_error" })).statusCode).toBe(200);
    const traces = JSON.stringify((await get("/api/sessions/big/traces")).json());
    const events = JSON.stringify((await get("/api/sessions/big/events")).json());
    const broadcast = JSON.stringify({ kind: "world_state_changed", sessionId: "big", worldState: runtime.peekWorld("big") });
    for (const [what, body] of [["traces", traces], ["events", events], ["broadcast", broadcast]] as const) {
      expect(body.length, what).toBeLessThan(4_000);
    }
  });

  it("still names the event it is the trace of", async () => {
    const id = crypto.randomUUID();
    await post({ sessionId: "named", id, type: "development.server_error" });
    const row = (await get("/api/sessions/named/traces")).json().traces[0];
    expect(row.eventId).toBe(id);
    expect(row.eventType).toBe("development.server_error");
  });
});

describe("a payload is shown, so it is trimmed rather than refused", () => {
  it("keeps an event whose payload is long, and cuts the payload down", async () => {
    // the opposite call from a name: losing the event would lose the signal, and two payloads cut
    // to the same length are still two events
    const res = await post({ sessionId: "pay", payload: { path: "p".repeat(5_000) } });
    expect(res.statusCode).toBe(200);
    const kept = (runtime.peekWorld("pay").recentEvents ?? [])[0] as { payload: { path: string } } | undefined;
    expect(kept?.payload.path.length).toBeLessThan(200);
    expect(kept?.payload.path.startsWith("ppp")).toBe(true);
  });
});
