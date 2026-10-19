import { describe, it, expect } from "vitest";
import { WorldState, emptyWorldState, EMPTY_BEHAVIOR, SENSING_LAYERS } from "./index";

/**
 * The world state is what the runtime believes is going on, and the copies of it that come back
 * from outside are snapshots — written by whichever build was running then. A session and the
 * moment it was last touched are the only things it cannot do without; everything else has an
 * empty form, so a resume brings back what it can understand rather than nothing at all.
 */
const T = "2026-09-04T00:00:00Z";
const full = emptyWorldState("s", T);

describe("a fresh belief", () => {
  it("starts empty, and valid", () => {
    expect(WorldState.safeParse(full).success).toBe(true);
    expect(full.activeProblems).toEqual([]);
    expect(full.recentEvents).toEqual([]);
    expect(full.sensing).toEqual({});
    expect(full.attention).toEqual({ typing: false });
    expect(full.autonomy.level).toBe(2);
    expect(full.behavior).toEqual(EMPTY_BEHAVIOR);
  });

  it("gives each session its own, sharing nothing between them", () => {
    const a = emptyWorldState("a", T);
    const b = emptyWorldState("b", T);
    expect(a.sessionId).toBe("a");
    expect(a.activeProblems).not.toBe(b.activeProblems);
    expect(a.behavior).not.toBe(b.behavior);
    a.activeProblems.push({ id: "p", kind: "k", summary: "s", severity: "critical", openedByEventId: "e", openedAt: T });
    expect(b.activeProblems).toEqual([]);
  });

  it("is the same for the same session and moment", () => {
    expect(JSON.stringify(emptyWorldState("s", T))).toBe(JSON.stringify(emptyWorldState("s", T)));
  });

  it("round-trips through its own schema unchanged", () => {
    expect(JSON.stringify(WorldState.parse(full))).toBe(JSON.stringify(full));
  });
});

describe("a snapshot from a build that knew less", () => {
  const withoutParts = (...parts: string[]) => {
    const older = { ...full } as Record<string, unknown>;
    for (const part of parts) delete older[part];
    return older;
  };

  it("is taken, with the missing parts filled in", () => {
    for (const part of ["activeContext", "environment", "activeProblems", "recentEvents", "behavior", "sensing", "attention", "autonomy"]) {
      const parsed = WorldState.safeParse(withoutParts(part));
      expect(parsed.success, part).toBe(true);
      if (parsed.success) expect(Object.keys(parsed.data), part).toContain(part);
    }
  });

  it("is taken when several parts are missing at once", () => {
    const parsed = WorldState.safeParse(withoutParts("behavior", "attention", "autonomy", "sensing", "recentEvents"));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.attention).toEqual({ typing: false });
      expect(parsed.data.autonomy.level).toBe(2);
      expect(parsed.data.recentEvents).toEqual([]);
    }
  });

  it("keeps everything it did carry", () => {
    const problem = { id: "p", kind: "runtime_error", summary: "x", severity: "critical" as const, openedByEventId: "e", openedAt: T };
    const parsed = WorldState.parse({ sessionId: "s", updatedAt: T, activeProblems: [problem] });
    expect(parsed.activeProblems).toEqual([problem]);
    expect(parsed.sessionId).toBe("s");
  });

  it("needs the session and the moment, and says so", () => {
    for (const missing of [{ updatedAt: T }, { sessionId: "s" }, {}]) {
      expect(WorldState.safeParse(missing).success, JSON.stringify(missing)).toBe(false);
    }
    expect(WorldState.safeParse({ sessionId: "", updatedAt: T }).success).toBe(false);
    expect(WorldState.safeParse({ sessionId: "s", updatedAt: "yesterday" }).success).toBe(false);
  });
});

describe("a snapshot that is not a belief", () => {
  it("is refused when a part is there but is not what it claims", () => {
    for (const [part, value] of [
      ["activeProblems", "none"],
      ["recentEvents", { first: {} }],
      ["attention", "typing"],
      ["autonomy", { level: 9 }],
      ["sensing", ["tabs"]],
      ["behavior", 42],
      ["environment", "empty"],
    ] as [string, unknown][]) {
      expect(WorldState.safeParse({ ...full, [part]: value }).success, part).toBe(false);
    }
  });

  it("is refused when a problem inside it is not a problem", () => {
    expect(WorldState.safeParse({ ...full, activeProblems: [{ id: "p" }] }).success).toBe(false);
    expect(WorldState.safeParse({ ...full, activeProblems: [null] }).success).toBe(false);
  });

  it("is refused when a remembered event is not an event", () => {
    expect(WorldState.safeParse({ ...full, recentEvents: [{ id: "e" }] }).success).toBe(false);
    expect(WorldState.safeParse({ ...full, recentEvents: ["an event"] }).success).toBe(false);
  });

  it("is refused when it is not an object at all", () => {
    for (const junk of [null, undefined, 42, "a world", [], true]) {
      expect(WorldState.safeParse(junk).success, JSON.stringify(junk) ?? "undefined").toBe(false);
    }
  });
});

/**
 * The layer list is what the body has words for, and the one place a person reads to find out
 * what is being observed about them. Ten of them send the shape of something and nothing of what
 * is in it. Two read content: `screen` reads what is in a window, `page` reads the names on the
 * page in front of somebody. They are listed apart from the ten and from each other rather than
 * appended quietly, and the whole list is held here by equality: a layer added to either group
 * fails this file, which is what makes the addition deliberate (docs/CONSENT_V2.md).
 *
 * The first version of this block only checked the ten and that `screen` was somewhere in the
 * list, so `page` — a second layer that reads content — arrived without a single assertion
 * noticing. That is the thing this block exists to stop.
 */
describe("the layers a sensor may declare", () => {
  const SHAPE_ONLY = [
    "interactions", "idle", "visibility", "dwell", "tabs", "network", "files", "git", "output", "windows",
  ];
  const READS_CONTENT = ["screen", "page"];

  it("still carries the ten that send shape and nothing of the content", () => {
    expect(SENSING_LAYERS.slice(0, SHAPE_ONLY.length)).toEqual(SHAPE_ONLY);
  });

  it("carries these two that read content and no others", () => {
    // equality, not `toContain`: a third layer that reads content has to be added here, and
    // adding it here is reading the paragraph above about what that costs a person
    expect(SENSING_LAYERS.slice(SHAPE_ONLY.length)).toEqual(READS_CONTENT);
  });

  it("names the browser's content layer too, not only the window's", () => {
    // the page layer was the one that got in unasserted; it is named here so that losing it, or
    // renaming it, reads as a change to what a person was told rather than as a passing test
    expect(SENSING_LAYERS).toContain("page");
  });

  it("keeps a layer that names the window it is pointed at", () => {
    // the indicator has to say WHICH app is being photographed, so the name travels with the
    // layer; a colon is not a control character and must survive the trim a snapshot goes through
    const parsed = WorldState.parse({ ...full, sensing: { agent: ["windows", "screen:KakaoTalk"] } });
    expect(parsed.sensing.agent).toEqual(["windows", "screen:KakaoTalk"]);
  });
});
