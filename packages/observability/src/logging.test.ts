import { describe, it, expect, vi, afterEach } from "vitest";
import { createLogger, normalizeLevel, TraceStore, type RuntimeTrace } from "./index";

/**
 * The runtime builds its logger from DM_LOG_LEVEL, an operator-supplied string, and writes a line
 * per ingested event. A level nobody checked used to mean the noisiest possible output, so the
 * normalising is pinned here alongside the trace ring the inspector reads.
 */
const collect = (level: unknown) => {
  const seen: string[] = [];
  const log = createLogger(level as string, (l) => seen.push(l.level));
  log.debug("d");
  log.info("i");
  log.warn("w");
  log.error("e");
  return seen;
};

afterEach(() => vi.restoreAllMocks());

describe("normalizeLevel — what an operator types is not a type", () => {
  it("takes the four levels, in any case, with stray spaces", () => {
    expect(normalizeLevel("debug")).toBe("debug");
    expect(normalizeLevel("DEBUG")).toBe("debug");
    expect(normalizeLevel("  Warn ")).toBe("warn");
    expect(normalizeLevel("error")).toBe("error");
  });

  it("falls back for anything it does not recognise", () => {
    for (const bad of ["verbose", "", "   ", "trace", "silent", undefined, null, 3, {}, []]) {
      expect(normalizeLevel(bad), JSON.stringify(bad)).toBe("info");
    }
  });

  it("lets the caller choose the fallback", () => {
    expect(normalizeLevel("nonsense", "error")).toBe("error");
  });

  it("does not let a prototype key pass as a level", () => {
    for (const key of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expect(normalizeLevel(key), key).toBe("info");
    }
  });
});

describe("createLogger — the floor actually holds", () => {
  it("drops everything below the requested level", () => {
    expect(collect("debug")).toEqual(["debug", "info", "warn", "error"]);
    expect(collect("info")).toEqual(["info", "warn", "error"]);
    expect(collect("warn")).toEqual(["warn", "error"]);
    expect(collect("error")).toEqual(["error"]);
  });

  it("treats a level it cannot read as info, not as debug", () => {
    // the bug: an unreadable level made every comparison false, so a quiet run printed everything
    for (const bad of ["verbose", "", "  ", "quiet", 3]) {
      expect(collect(bad), JSON.stringify(bad)).toEqual(["info", "warn", "error"]);
    }
  });

  it("defaults to info when nothing is passed at all", () => {
    expect(collect(undefined)).toEqual(["info", "warn", "error"]);
  });

  it("hands the sink the message and its fields, untouched", () => {
    const lines: { level: string; msg: string; fields?: Record<string, unknown> }[] = [];
    const log = createLogger("debug", (l) => lines.push(l));
    log.info("ingested", { eventId: "e1", decisionId: "d1", significance: 0.82 });
    log.debug("no fields");
    expect(lines[0]).toEqual({ level: "info", msg: "ingested", fields: { eventId: "e1", decisionId: "d1", significance: 0.82 } });
    expect(lines[1]).toEqual({ level: "debug", msg: "no fields", fields: undefined });
  });

  it("writes one JSON line per record when there is no sink", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = createLogger("warn");
    log.info("dropped");
    log.warn("held", { sessionId: "s1" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({ level: "warn", msg: "held", sessionId: "s1" });
  });

  it("sends debug through console.log, since console.debug is hidden by default", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    createLogger("debug").debug("verbose detail");
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("TraceStore — the inspector's window, bounded", () => {
  const mk = (sessionId: string, i: number, over: Partial<RuntimeTrace> = {}): RuntimeTrace => ({
    at: "2026-09-03T00:00:00Z",
    sessionId,
    eventId: `e${i}`,
    eventType: "development.server_error",
    significance: 0.9,
    deliberated: true,
    capabilityIds: [],
    morphApplied: true,
    guardReasonCodes: [],
    ...over,
  });

  it("keeps the newest traces and forgets the oldest", () => {
    const store = new TraceStore(3);
    for (let i = 1; i <= 5; i += 1) store.append(mk("s1", i));
    expect(store.count()).toBe(3);
    expect(store.list().map((t) => t.eventId)).toEqual(["e3", "e4", "e5"]);
  });

  it("keeps one session's traces out of another's", () => {
    const store = new TraceStore();
    store.append(mk("s1", 1));
    store.append(mk("s2", 2));
    store.append(mk("s1", 3));
    expect(store.list("s1").map((t) => t.eventId)).toEqual(["e1", "e3"]);
    expect(store.list("s2").map((t) => t.eventId)).toEqual(["e2"]);
    expect(store.list("never-existed")).toEqual([]);
    // each session keeps its own order; across sessions there is no order to keep, since nothing
    // reads them together except a count
    expect(store.list()).toHaveLength(3);
    expect(new Set(store.list().map((t) => t.eventId))).toEqual(new Set(["e1", "e2", "e3"]));
  });

  it("bounds each session on its own, so a busy one cannot empty a quiet one", () => {
    // this used to evict by age across every session: the inspector of a session that had done
    // nothing wrong showed nothing at all, which is the one place a person looks to find out why
    // their body changed
    const store = new TraceStore(2);
    store.append(mk("quiet", 1));
    for (let i = 2; i <= 20; i += 1) store.append(mk("busy", i));

    expect(store.list("quiet").map((t) => t.eventId)).toEqual(["e1"]);
    expect(store.list("busy")).toHaveLength(2);
    expect(store.list("busy").map((t) => t.eventId)).toEqual(["e19", "e20"]);
  });

  it("forgets the session that went quiet longest when it is holding too many", () => {
    const store = new TraceStore(5, 2);
    store.append(mk("a", 1));
    store.append(mk("b", 2));
    store.append(mk("a", 3)); // a is written to again, so b is now the quietest
    store.append(mk("c", 4));

    expect(store.list("b")).toEqual([]);
    expect(store.list("a").map((t) => t.eventId)).toEqual(["e1", "e3"]);
    expect(store.list("c")).toHaveLength(1);
  });

  it("hands back a list the caller cannot use to lengthen the ring", () => {
    const store = new TraceStore(5);
    store.append(mk("s1", 1));
    store.list("s1").push(mk("s1", 99));
    store.list().push(mk("s1", 98));
    expect(store.count()).toBe(1);
  });

  it("carries the whole why-did-the-UI-change trail, including a refusal", () => {
    const store = new TraceStore();
    store.append(mk("s1", 1, { deliberated: false, morphApplied: false, guardReasonCodes: ["cooldown_active"], providerId: "mock", usedFallback: true, decisionId: "d1", capabilityIds: ["dev.read_logs"] }));
    const t = store.list("s1")[0]!;
    expect(t.morphApplied).toBe(false);
    expect(t.guardReasonCodes).toEqual(["cooldown_active"]);
    expect(t.usedFallback).toBe(true);
    expect(t.providerId).toBe("mock");
    expect(t.capabilityIds).toEqual(["dev.read_logs"]);
  });
});
