import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildServer, ingestFailure } from "./server";

/**
 * A session name is a key, not a caption. It selects a belief, a map entry, an audit trail, a
 * snapshot row and a broadcast, and anything at all can choose one: the body takes it from its own
 * query string, and any process that can reach the runtime may name one in an event it posts.
 *
 * It had no bound and no rule about characters. Two hundred thousand characters were accepted, and
 * every world-state broadcast for that session then carried six hundred kilobytes of nothing but
 * its own name. An escape sequence was accepted too, and went into the world state a body draws,
 * into the session listing, into every trace and every log line naming that session.
 *
 * So it is refused rather than trimmed: two names cut to the same length would be one session.
 *
 * The URL is the other door and never passes through the event schema at all, so the same rule is
 * applied there in one hook rather than at each of the dozen routes that take a name.
 */
let app: FastifyInstance;
beforeEach(async () => {
  ({ app } = await buildServer());
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);
const NEWLINE = String.fromCharCode(10);
const DEL = String.fromCharCode(127);

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
const read = (id: string, path: string) => app.inject({ method: "GET", url: "/api/sessions/" + encodeURIComponent(id) + "/" + path });

const READS = ["state", "events", "decisions", "traces", "approvals", "snapshots", "ui"];

describe("what may be a session name", () => {
  it("is every name this system actually uses", async () => {
    // the bodies that exist: the extension, the desktop agent, the web app's default, an E2E run,
    // and a name someone typed into the query string right up to the limit
    for (const id of ["ext", "desktop", "session-local", "two-bodies-1757000000000", "a".repeat(120)]) {
      expect((await post({ sessionId: id })).statusCode, id.length + " chars").toBe(200);
      // a session that can be created is one that can be read back: both doors hold one limit
      expect((await read(id, "state")).statusCode, id.length + " chars, read back").toBe(200);
    }
  });

  it("is not long enough to be a payload of its own", async () => {
    for (const len of [121, 5_000, 200_000]) {
      expect((await post({ sessionId: "a".repeat(len) })).statusCode, len + " chars").toBe(400);
    }
  });

  it("carries none of the characters that are not writing", async () => {
    for (const id of ["s" + ESC + "[31m", "s" + NUL + "x", "one" + NEWLINE + "two", "t" + DEL + "x"]) {
      expect((await post({ sessionId: id })).statusCode).toBe(400);
    }
  });

  it("is refused at the URL too, which never sees the event schema", async () => {
    const id = "only" + ESC + NUL + "read";
    for (const path of READS) {
      const res = await read(id, path);
      expect(res.statusCode, path).toBe(400);
      // and the answer does not repeat what was sent
      expect(JSON.stringify(res.json()), path).not.toContain("only");
    }
  });

  it("is refused on the routes that change something, and on the socket", async () => {
    const id = encodeURIComponent("x" + NUL + "y");
    for (const url of ["/api/morph/" + id + "/undo", "/api/morph/" + id + "/redo", "/api/sessions/" + id + "/resume", "/api/sim/" + id + "/error_burst"]) {
      expect((await app.inject({ method: "POST", url, payload: {} })).statusCode, url).toBe(400);
    }
    // the websocket upgrade runs the same hook — a body cannot subscribe under a name like this
    const ws = await app.inject({
      method: "GET",
      url: "/ws/sessions/" + id,
      headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" },
    });
    expect(ws.statusCode).toBe(400);
  });

  it("leaves the routes whose parameter is not a session name alone", async () => {
    // :level and :aid are not names; the hook reads :id only
    expect((await app.inject({ method: "POST", url: "/api/autonomy/3" })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/approvals/nope/reject", payload: {} })).statusCode).toBe(404);
  });

  it("keeps a real session readable while a refused one changes nothing", async () => {
    await post({ sessionId: "session-local" });
    const before = (await app.inject({ method: "GET", url: "/api/sessions" })).json().sessions.length;
    await post({ sessionId: "s" + NUL + "x" });
    await read("s" + NUL + "x", "state");
    const after = (await app.inject({ method: "GET", url: "/api/sessions" })).json().sessions as { sessionId: string }[];
    expect(after.length).toBe(before);
    expect(after.some((s) => s.sessionId.includes(NUL))).toBe(false);
  });
});

describe("what a caller is told when its event is refused", () => {
  it("is where the event was wrong and what was expected there", async () => {
    const res = await post({ severity: "nope" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("severity");
  });

  it("names each field that was wrong, not only the first", async () => {
    const error = (await post({ severity: "nope", source: "nope", timestamp: "not a time" })).json().error as string;
    for (const field of ["severity", "source", "timestamp"]) expect(error, field).toContain(field);
  });

  it("is not the event read back to whoever sent it", async () => {
    // the validator's own message quotes the value it refused, so a 200,000-character field came
    // back as a 400,000-character error: the failure path answered a bad request by repeating it
    const res = await post({ severity: "Q".repeat(200_000) });
    const body = JSON.stringify(res.json());
    expect(body).not.toContain("QQQQQQQQQQ");
    expect(body.length).toBeLessThan(1_000);
  });

  it("carries no control characters out of a value it refused", async () => {
    const body = JSON.stringify((await post({ source: "x" + ESC + "[31m" + NUL + "y", severity: "nope" })).json());
    expect(body).not.toContain("u001b");
    expect(body).not.toContain("u0000");
  });

  it("says nothing about our insides when the failure is ours", async () => {
    // not a Zod failure: the caller learns that it failed and nothing else
    expect(ingestFailure(new Error("connect ECONNREFUSED 10.0.0.4:5432"))).toEqual({ code: 500, body: { error: "internal error" } });
  });

  it("still answers when the failure carries no issues at all", async () => {
    const empty = Object.assign(new Error("x"), { name: "ZodError", issues: [] });
    expect(ingestFailure(empty).body.error.length).toBeGreaterThan(0);
  });
});
