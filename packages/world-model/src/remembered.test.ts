import { describe, it, expect } from "vitest";
import { emptyWorldState, MAX_IDENTIFIER, MAX_PAYLOAD_FIELDS, type MatterEvent, type WorldState } from "@particle/contracts";
import { reduce } from "./index";

/**
 * The belief holds a short list of recent events so the runtime can tell a repeat from a novelty,
 * and it kept each one whole. That list travels further than it looks: to every body watching the
 * session on every change, into every snapshot, and into the context of every prompt a provider
 * is given, since the decision engine hands the whole world state over as JSON.
 *
 * Thirty events carrying a hundred kilobytes each made a three megabyte belief, sent three ways.
 * Nothing read those payloads: the significance reflex counts how many recent events share a
 * type, and the body labels the last one. That is all.
 *
 * A payload is meant to be shape — a path, a host, a status — so that is what is remembered. The
 * event log keeps events whole, so a replay still has everything.
 */
const T = "2026-09-06T00:00:00Z";
const ESC = "\u001b";
const event = (payload: Record<string, unknown>, i = 1): MatterEvent => ({
  id: `e${i}`, sessionId: "s", timestamp: T, source: "user", type: "user.action", severity: "debug", payload,
});
const remember = (...payloads: Record<string, unknown>[]): WorldState => {
  let world = emptyWorldState("s", T);
  payloads.forEach((p, i) => { world = reduce(world, event(p, i)); });
  return world;
};
const lastPayload = (...payloads: Record<string, unknown>[]) => remember(...payloads).recentEvents.at(-1)?.payload ?? {};

describe("what the belief remembers of an event", () => {
  it("is the event itself, still", () => {
    const kept = remember({ key: "file:a" }).recentEvents.at(-1)!;
    expect(kept.id).toBe("e0");
    expect(kept.type).toBe("user.action");
    expect(kept.severity).toBe("debug");
    expect(kept.timestamp).toBe(T);
    expect(kept.sessionId).toBe("s");
  });

  it("keeps the shape a payload is supposed to be", () => {
    expect(lastPayload({ key: "file:a", status: 503, ok: false, nothing: null })).toEqual({
      key: "file:a", status: 503, ok: false, nothing: null,
    });
  });

  it("keeps a name at the length every other identifier is held to", () => {
    const kept = lastPayload({ blob: "b".repeat(100_000) }).blob as string;
    expect(kept.length).toBe(MAX_IDENTIFIER + 1);
    expect(kept.endsWith("…")).toBe(true);
  });

  it("keeps the identifiers beside a blob rather than dropping the lot", () => {
    const kept = lastPayload({ key: "file:a", host: "api.example.com", blob: "b".repeat(100_000) });
    expect(kept.key).toBe("file:a");
    expect(kept.host).toBe("api.example.com");
  });

  it("keeps none of what is content rather than shape", () => {
    const kept = lastPayload({ key: "file:a", nested: { a: 1 }, list: [1, 2, 3], fn: undefined });
    expect(kept).toEqual({ key: "file:a" });
  });

  it("carries no escape sequence into a snapshot or a prompt", () => {
    expect(lastPayload({ key: `file${ESC}[31m:a` }).key).toBe("file[31m:a");
  });

  it("is a handful of fields, however many a sender writes", () => {
    const many = Object.fromEntries(Array.from({ length: 1_000 }, (_, i) => [`f${i}`, i]));
    expect(Object.keys(lastPayload(many)).length).toBe(MAX_PAYLOAD_FIELDS);
  });
});

describe("the belief that list travels inside", () => {
  it("stays a size worth sending on every change", () => {
    const heavy = Array.from({ length: 30 }, () => ({ key: "file:a", blob: "b".repeat(100_000) }));
    const world = remember(...heavy);
    expect(world.recentEvents.length).toBeGreaterThan(0);
    // it was three megabytes: broadcast to every watcher, snapshotted, and put in every prompt
    expect(JSON.stringify(world).length).toBeLessThan(50_000);
  });

  it("still lets the reflex tell a repeat from a novelty", () => {
    // the one thing anything actually reads off this list
    const world = remember({ key: "a" }, { key: "b" }, { key: "c" });
    expect(world.recentEvents.filter((e) => e.type === "user.action").length).toBe(3);
  });

  it("still remembers which one was last", () => {
    const world = remember({ key: "first" }, { key: "second" });
    expect(world.recentEvents.at(-1)?.payload.key).toBe("second");
  });
});
