import { describe, it, expect } from "vitest";
import { MatterEvent, shapeOfEvent, MAX_PAYLOAD_DEPTH, MAX_PAYLOAD_NODES } from "./index";

/**
 * A payload was cleaned on the way into the belief and nowhere else, so one posted event became
 * three different events: the belief held "src/a.ts", the durable log was handed "src/a<NUL>.ts",
 * and the caller was answered with the second.
 *
 * On Postgres the stored one is worse than merely different — a NUL cannot go into a jsonb value
 * at all, so the append throws, and because that append is deliberately best-effort the event is
 * dropped from durable storage with nothing but a warn line. Six such events in a row, six lost,
 * and not one ingest failed. (Nothing reads that log back today, so nothing has yet missed them;
 * it is the record a replay would be built from.)
 *
 * It is cleaned once now, at the door every path comes through: the REST route, the socket, and
 * the body's own in-browser core all parse this same schema. Cleaned, not shortened and not
 * dropped — the log is meant to keep what a sensor reported. Reducing an event to a shape is
 * still shapeOfEvent's separate job, further in.
 */
const NUL = String.fromCharCode(0);
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const DEL = String.fromCharCode(127);
const AT = "2026-09-07T00:00:00.000Z";
const JSON_NUL = String.fromCharCode(92) + "u0000";

const event = (payload: unknown, over: Record<string, unknown> = {}) => ({
  id: "e1",
  sessionId: "s1",
  timestamp: AT,
  source: "user",
  type: "user.opened_file",
  severity: "info",
  payload,
  ...over,
});
const parse = (payload: unknown, over?: Record<string, unknown>) => MatterEvent.safeParse(event(payload, over));

describe("what a payload carries past the door", () => {
  it("is every payload this repo actually sends, unchanged", () => {
    for (const payload of [
      { kind: "click" },
      { reason: "guard_hold_expired" },
      { sensor: "web", layers: ["interactions", "idle"] },
      { visible: true, awaySeconds: 12 },
      { count: 3 },
      { seconds: 40 },
      { host: "api.example.com", status: 503, latencyMs: 120 },
    ]) {
      const parsed = parse(payload);
      expect(parsed.success, JSON.stringify(payload)).toBe(true);
      if (parsed.success) expect(parsed.data.payload).toEqual(payload);
    }
  });

  it("carries none of the characters that are not writing", () => {
    const parsed = parse({ path: "src/a" + NUL + ".ts", note: "clean" + ESC + "[31m", bell: BEL + "x", del: "y" + DEL });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.payload).toEqual({ path: "src/a.ts", note: "clean[31m", bell: "x", del: "y" });
    // this is the one that mattered: with it in there, Postgres refuses the whole row
    expect(JSON.stringify(parsed.data)).not.toContain(JSON_NUL);
  });

  it("cleans a string however deep it sits, and leaves the shape it sat in", () => {
    const parsed = parse({ nested: { host: "api" + NUL + ".example.com", list: ["a" + NUL, "b"], deeper: { n: 1 } } });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const nested = parsed.data.payload.nested as { host: string; list: unknown; deeper: unknown };
    expect(nested.host).toBe("api.example.com");
    expect(Array.isArray(nested.list)).toBe(true);
    expect(nested.list).toEqual(["a", "b"]);
    expect(nested.deeper).toEqual({ n: 1 });
  });

  it("shortens nothing and drops nothing, because a log keeps what was reported", () => {
    const long = "p".repeat(5_000);
    const parsed = parse({ path: long, count: 7, ok: true, nothing: null });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect((parsed.data.payload.path as string).length).toBe(5_000);
    expect(parsed.data.payload.count).toBe(7);
    expect(parsed.data.payload.ok).toBe(true);
    expect(parsed.data.payload.nothing).toBe(null);
  });

  it("is refused when it is past being a shape at all", () => {
    let deep: unknown = { end: "x" };
    for (let i = 0; i < MAX_PAYLOAD_DEPTH + 5; i++) deep = { down: deep };
    expect(parse(deep as Record<string, unknown>).success).toBe(false);

    const wide: Record<string, unknown> = {};
    for (let i = 0; i < MAX_PAYLOAD_NODES + 10; i++) wide["k" + i] = "v";
    expect(parse(wide).success).toBe(false);
  });

  it("takes a payload that is deep but still a shape", () => {
    let ok: unknown = { end: "x" };
    for (let i = 0; i < MAX_PAYLOAD_DEPTH - 3; i++) ok = { down: ok };
    expect(parse(ok as Record<string, unknown>).success).toBe(true);
  });

  it("holds metadata to the same rule as the payload", () => {
    const parsed = parse({ kind: "click" }, { metadata: { origin: "ext" + NUL, trace: { id: "t" + ESC } } });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.metadata).toEqual({ origin: "ext", trace: { id: "t" } });
    expect(JSON.stringify(parsed.data)).not.toContain(JSON_NUL);
  });

  it("leaves the prototype alone whatever a payload key is called", () => {
    // a payload arrives as JSON, the only way __proto__ is a key rather than a prototype
    const payload = JSON.parse('{"__proto__": {"host": "api"}, "path": "src/a.ts"}') as Record<string, unknown>;
    const parsed = parse(payload);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(Object.getPrototypeOf(parsed.data.payload)).toBe(Object.prototype);
    expect(parsed.data.payload.path).toBe("src/a.ts");
  });

  it("is still reduced to a shape further in, which is a different job", () => {
    // the door cleans; the belief shapes. A five thousand character path is kept in the log and
    // cut for the belief, and that is the intended difference rather than an inconsistency
    const parsed = parse({ path: "p".repeat(5_000), nested: { a: 1 } });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const shaped = shapeOfEvent(parsed.data);
    expect((shaped.payload.path as string).length).toBeLessThan(200);
    expect(shaped.payload.nested).toBeUndefined();
    expect((parsed.data.payload.path as string).length).toBe(5_000);
  });
});
