import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { emptyWorldState, UI_SCHEMA_VERSION } from "@particle/contracts";
import { RuntimeClient, parseServerMessage, type ServerMessage } from "./runtimeClient";

/**
 * A frame off the socket is data from another process, and everything the body does with one —
 * replacing the interface, replacing its belief about what is happening — it does immediately.
 * So the frame is checked before the body believes it: for this session, of a kind the body
 * knows, carrying what that kind is supposed to carry.
 */
const T = "2026-09-04T00:00:00Z";
const blueprint = {
  schemaVersion: UI_SCHEMA_VERSION,
  workspaceId: "ws",
  mode: "development",
  root: { id: "root", type: "Stack", children: [] },
  metadata: { generatedAt: T, decisionId: "d", confidence: 1 },
};
const world = emptyWorldState("s", T);
const auditRecord = { id: "a1", at: T, sessionId: "s", kind: "decision", detail: { why: "significant" } };
const ok = (data: unknown) => parseServerMessage(data, "s") !== null;

describe("frames the body acts on", () => {
  it("takes each kind it knows, carrying what that kind carries", () => {
    expect(ok({ kind: "ui_patch", sessionId: "s", blueprint })).toBe(true);
    expect(ok({ kind: "world_state_changed", sessionId: "s", worldState: world })).toBe(true);
    expect(ok({ kind: "ai_presence_changed", sessionId: "s", state: "acting" })).toBe(true);
    // an empty list was accepted here when the door only checked that a list was present. The
    // records are the whole of what this kind carries, and the runtime only sends the frame when
    // there are some — so a frame with none of them is nothing this body can draw.
    expect(ok({ kind: "decision_created", sessionId: "s", audit: [auditRecord] })).toBe(true);
    expect(ok({ kind: "decision_created", sessionId: "s", audit: [] })).toBe(false);
    expect(ok({ kind: "learned", sessionId: "s", learned: { suppressed: "augment:stuck", dismissals: 2 } })).toBe(true);
    expect(ok({ kind: "pattern_suggestions", sessionId: "s", suggestions: [{ key: "k", count: 3 }] })).toBe(true);
  });

  it("hands the frame through unchanged when it accepts it", () => {
    const frame = { kind: "ai_presence_changed", sessionId: "s", state: "acting" };
    expect(parseServerMessage(frame, "s")).toEqual(frame);
  });
});

describe("frames it refuses", () => {
  it("refuses anything that is not a frame at all", () => {
    for (const data of [null, undefined, 42, "hi", [1, 2], true]) {
      expect(ok(data), JSON.stringify(data) ?? "undefined").toBe(false);
    }
  });

  it("refuses a kind it does not know, or no kind", () => {
    expect(ok({ sessionId: "s" })).toBe(false);
    expect(ok({ kind: "shutdown_everything", sessionId: "s" })).toBe(false);
    expect(ok({ kind: 42, sessionId: "s" })).toBe(false);
    expect(ok({ kind: "__proto__", sessionId: "s" })).toBe(false);
  });

  it("refuses a frame meant for another session", () => {
    // the body would otherwise apply another workspace's interface to this one
    expect(ok({ kind: "ui_patch", sessionId: "someone-else", blueprint })).toBe(false);
    expect(ok({ kind: "ai_presence_changed", state: "acting" })).toBe(false);
  });

  it("refuses an interface that is not one", () => {
    for (const bad of [null, undefined, "a tree", 42, {}, { ...blueprint, root: { id: "r", type: "NotAComponent" } }]) {
      expect(ok({ kind: "ui_patch", sessionId: "s", blueprint: bad }), JSON.stringify(bad) ?? "undefined").toBe(false);
    }
  });

  it("refuses an interface from another build", () => {
    expect(ok({ kind: "ui_patch", sessionId: "s", blueprint: { ...blueprint, schemaVersion: "9.9.9" } })).toBe(false);
  });

  it("refuses a belief that is not one", () => {
    for (const bad of [null, "state", 42, {}, { ...world, activeProblems: "none" }]) {
      expect(ok({ kind: "world_state_changed", sessionId: "s", worldState: bad })).toBe(false);
    }
  });

  it("refuses lists that are not lists, and entries that are not entries", () => {
    expect(ok({ kind: "decision_created", sessionId: "s", audit: 7 })).toBe(false);
    expect(ok({ kind: "decision_created", sessionId: "s", audit: [null, 7] })).toBe(false);
    expect(ok({ kind: "decision_created", sessionId: "s", audit: [{ ...auditRecord, kind: {} }] })).toBe(false);
    expect(ok({ kind: "pattern_suggestions", sessionId: "s", suggestions: "x" })).toBe(false);
    expect(ok({ kind: "pattern_suggestions", sessionId: "s", suggestions: [null] })).toBe(false);
    expect(ok({ kind: "pattern_suggestions", sessionId: "s", suggestions: [{ key: 1, count: "many" }] })).toBe(false);
  });

  it("refuses a learned notice missing its parts", () => {
    expect(ok({ kind: "learned", sessionId: "s", learned: "yes" })).toBe(false);
    expect(ok({ kind: "learned", sessionId: "s", learned: { suppressed: "x" } })).toBe(false);
    expect(ok({ kind: "learned", sessionId: "s" })).toBe(false);
  });

  it("refuses a presence that is not a word", () => {
    expect(ok({ kind: "ai_presence_changed", sessionId: "s", state: 42 })).toBe(false);
    expect(ok({ kind: "ai_presence_changed", sessionId: "s" })).toBe(false);
  });
});

describe("over a real socket", () => {
  class FakeSocket {
    static last: FakeSocket | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((e: { data: string }) => void) | null = null;
    constructor(readonly url: string) {
      FakeSocket.last = this;
    }
    close() {}
  }

  beforeEach(() => {
    FakeSocket.last = null;
    vi.stubGlobal("WebSocket", FakeSocket as unknown as typeof WebSocket);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) }) as unknown as Response));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("delivers what it accepts and silently drops the rest", () => {
    const seen: ServerMessage[] = [];
    new RuntimeClient("s").connect((m) => seen.push(m), () => {});
    const send = (data: unknown) => FakeSocket.last!.onmessage!({ data: typeof data === "string" ? data : JSON.stringify(data) });

    send({ kind: "ai_presence_changed", sessionId: "s", state: "acting" });
    send("not json at all");
    send(null);
    send(42);
    send({ kind: "ui_patch", sessionId: "s", blueprint: null });
    send({ kind: "ai_presence_changed", sessionId: "another", state: "acting" });
    send({ kind: "ui_patch", sessionId: "s", blueprint });

    expect(seen.map((m) => m.kind)).toEqual(["ai_presence_changed", "ui_patch"]);
  });

  it("does not throw on a frame that is not an object", () => {
    new RuntimeClient("s").connect(() => {}, () => {});
    for (const data of ["null", "42", "[1,2]", '"text"', "not json"]) {
      expect(() => FakeSocket.last!.onmessage!({ data })).not.toThrow();
    }
  });
});
