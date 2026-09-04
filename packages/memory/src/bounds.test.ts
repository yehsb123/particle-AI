import { describe, it, expect } from "vitest";
import { EpisodicMemory, PatternDetector, PreferenceMemory, WorkingMemory, MAX_PATTERNS, MAX_PREFERENCES } from "./index";
import type { PatternCandidate, Preference } from "./types";

/**
 * These four stores hold everything the runtime learns about a person, and they live for as long
 * as the process does. What matters at the edges: they stay bounded whatever arrives, a caller
 * cannot rewrite what was learned by holding onto something they were handed, and what comes back
 * from a snapshot is treated as data rather than trusted.
 */
const iso = (i: number) => `2026-09-04T00:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}Z`;

describe("WorkingMemory — scratch for the task at hand", () => {
  it("keeps the last value written under a key", () => {
    const w = new WorkingMemory();
    w.set("mode", "development");
    w.set("mode", "incident");
    expect(w.get("mode")).toBe("incident");
    expect(w.entries()).toEqual([["mode", "incident"]]);
  });

  it("tells an absent key apart from one holding undefined", () => {
    const w = new WorkingMemory();
    w.set("explicit", undefined);
    expect(w.get("explicit")).toBeUndefined();
    expect(w.has("explicit")).toBe(true);
    expect(w.has("never-set")).toBe(false);
    expect(w.get("never-set")).toBeUndefined();
  });

  it("empties on clear and can be used again after", () => {
    const w = new WorkingMemory();
    w.set("a", 1);
    w.clear();
    expect(w.entries()).toEqual([]);
    w.set("b", 2);
    expect(w.entries()).toEqual([["b", 2]]);
  });
});

describe("EpisodicMemory — what happened before", () => {
  const episode = (i: number, context = "development.incident") => ({ id: `e${i}`, at: iso(i), context, summary: `s${i}`, eventTypes: ["development.server_error"] });

  it("keeps the newest episodes and drops the oldest at its bound", () => {
    const m = new EpisodicMemory(3);
    for (let i = 0; i < 5; i += 1) m.record(episode(i));
    expect(m.count()).toBe(3);
    expect(m.recent(10).map((e) => e.id)).toEqual(["e4", "e3", "e2"]);
  });

  it("returns the most recent first, ten by default", () => {
    const m = new EpisodicMemory();
    for (let i = 0; i < 15; i += 1) m.record(episode(i));
    expect(m.recent().map((e) => e.id)).toEqual(["e14", "e13", "e12", "e11", "e10", "e9", "e8", "e7", "e6", "e5"]);
    expect(m.recent(2).map((e) => e.id)).toEqual(["e14", "e13"]);
    // asking for none has to give none: slice(-0) is slice(0), which is the whole history
    expect(m.recent(0)).toEqual([]);
    expect(m.recent(-1)).toEqual([]);
  });

  it("searches context without caring about case, and matches everything on an empty query", () => {
    const m = new EpisodicMemory();
    m.record(episode(1, "Development.Incident"));
    m.record(episode(2, "browser.traffic"));
    expect(m.search("incident").map((e) => e.id)).toEqual(["e1"]);
    expect(m.search("INCIDENT").map((e) => e.id)).toEqual(["e1"]);
    expect(m.search("")).toHaveLength(2);
    expect(m.search("nothing like this")).toEqual([]);
  });

  it("says it holds nothing before anything happens", () => {
    const m = new EpisodicMemory();
    expect(m.count()).toBe(0);
    expect(m.recent()).toEqual([]);
    expect(m.search("anything")).toEqual([]);
  });
});

describe("PreferenceMemory — weights that never go negative", () => {
  it("adds up reinforcement and stops at zero on the way down", () => {
    const p = new PreferenceMemory();
    expect(p.reinforce("k")).toBe(1);
    expect(p.reinforce("k")).toBe(2);
    expect(p.reinforce("k", -1)).toBe(1); // redo hands a dismissal back
    expect(p.reinforce("k", -5)).toBe(0); // and never past zero
    expect(p.weightOf("k")).toBe(0);
    expect(p.weightOf("never-touched")).toBe(0);
  });

  it("ranks the heaviest first and takes as many as asked", () => {
    const p = new PreferenceMemory();
    p.reinforce("light");
    p.reinforce("heavy", 5);
    p.reinforce("middle", 3);
    expect(p.top(2).map((x) => x.key)).toEqual(["heavy", "middle"]);
    expect(p.top()).toHaveLength(3);
    expect(p.top(0)).toEqual([]);
  });

  it("hands back a list a caller cannot write learning into", () => {
    const p = new PreferenceMemory();
    p.reinforce("k");
    const entries = p.entries();
    entries.push({ key: "forged", weight: 99 });
    entries[0]!.weight = 42;
    expect(p.entries()).toEqual([{ key: "k", weight: 1 }]);
    expect(p.weightOf("forged")).toBe(0);
  });

  it("takes the higher of what it has and what a snapshot says", () => {
    // a restored snapshot must never lower what this session already learned
    const p = new PreferenceMemory();
    p.reinforce("k", 5);
    p.load([{ key: "k", weight: 1 }, { key: "fresh", weight: 3 }]);
    expect(p.weightOf("k")).toBe(5);
    expect(p.weightOf("fresh")).toBe(3);
  });

  it("ignores anything in a snapshot that is not a preference", () => {
    const p = new PreferenceMemory();
    p.load([
      { key: "ok", weight: 2 },
      { key: "nan", weight: Number.NaN },
      { key: "infinite", weight: Number.POSITIVE_INFINITY },
      { key: 7, weight: 1 },
      null,
      undefined,
      "not a preference",
    ] as unknown as Preference[]);
    expect(p.entries()).toEqual([{ key: "ok", weight: 2 }]);
  });

  it("stops growing at a ceiling, keeping what was reinforced most", () => {
    // a preference key carries the morph variant, which the model chooses freely, so this table
    // would otherwise grow for as long as the session lives — in memory, in every snapshot, and
    // in the browser's own storage
    const p = new PreferenceMemory();
    p.reinforce("dismissed:augment:stuck", 20);
    for (let i = 0; i < MAX_PREFERENCES + 200; i += 1) p.reinforce(`dismissed:augment:v${i}`);
    expect(p.entries()).toHaveLength(MAX_PREFERENCES);
    expect(p.weightOf("dismissed:augment:stuck")).toBe(20); // what the person actually taught us
  });

  it("keeps reinforcing a preference it already knows at the ceiling", () => {
    const p = new PreferenceMemory();
    for (let i = 0; i < MAX_PREFERENCES; i += 1) p.reinforce(`k${i}`);
    expect(p.reinforce("k0", 5)).toBe(6);
    expect(p.entries()).toHaveLength(MAX_PREFERENCES);
  });

  it("does not let a snapshot push it past the ceiling", () => {
    const p = new PreferenceMemory();
    p.load(Array.from({ length: MAX_PREFERENCES + 300 }, (_, i) => ({ key: `k${i}`, weight: 1 })));
    expect(p.entries()).toHaveLength(MAX_PREFERENCES);
  });

  it("still takes a snapshot's word on a preference it already has, at the ceiling", () => {
    const p = new PreferenceMemory();
    for (let i = 0; i < MAX_PREFERENCES; i += 1) p.reinforce(`k${i}`);
    p.load([{ key: "k0", weight: 9 }, { key: "brand-new", weight: 9 }]);
    expect(p.weightOf("k0")).toBe(9);
    expect(p.weightOf("brand-new")).toBe(0);
  });

  it("survives an empty snapshot", () => {
    const p = new PreferenceMemory();
    p.reinforce("k");
    p.load([]);
    expect(p.entries()).toEqual([{ key: "k", weight: 1 }]);
  });
});

describe("PatternDetector — repeated situations, bounded", () => {
  it("becomes a candidate at the threshold, not before", () => {
    const d = new PatternDetector(3);
    d.observe("k", iso(1));
    expect(d.candidates()).toEqual([]);
    d.observe("k", iso(2));
    expect(d.candidates()).toEqual([]);
    d.observe("k", iso(3));
    expect(d.candidates().map((c) => c.key)).toEqual(["k"]);
  });

  it("offers a suggestion once and remembers it was offered", () => {
    const d = new PatternDetector(2);
    d.observe("k", iso(1));
    d.observe("k", iso(2));
    expect(d.takeSuggestions().map((c) => c.key)).toEqual(["k"]);
    expect(d.takeSuggestions()).toEqual([]);
    d.observe("k", iso(3));
    expect(d.takeSuggestions()).toEqual([]); // seeing it again does not re-offer it
    expect(d.candidates()[0]?.suggested).toBe(true);
  });

  it("tracks when a pattern was first and last seen", () => {
    const d = new PatternDetector(2);
    d.observe("k", iso(1));
    d.observe("k", iso(90));
    const c = d.entries()[0]!;
    expect(c.firstSeen).toBe(iso(1));
    expect(c.lastSeen).toBe(iso(90));
    expect(c.count).toBe(2);
  });

  it("hands back copies from every read, so learning cannot be rewritten from outside", () => {
    const d = new PatternDetector(2);
    const observed = d.observe("k", iso(1));
    observed.count = 99;
    observed.suggested = true;
    expect(d.entries()[0]).toMatchObject({ count: 1, suggested: false });

    d.observe("k", iso(2));
    const taken = d.takeSuggestions()[0]!;
    taken.count = 0;
    d.entries()[0]!.count = 0;
    expect(d.candidates()[0]?.count).toBe(2);
  });

  it("stays bounded no matter how many distinct patterns arrive", () => {
    // a pattern key is built from the event type, and an event type is whatever a sensor sends
    const d = new PatternDetector(3);
    for (let i = 0; i < MAX_PATTERNS + 200; i += 1) d.observe(`type${i}->augment`, iso(i));
    expect(d.entries()).toHaveLength(MAX_PATTERNS);
    expect(d.entries().at(-1)?.key).toBe(`type${MAX_PATTERNS + 199}->augment`);
    expect(d.entries().some((c) => c.key === "type0->augment")).toBe(false); // the stalest went
  });

  it("keeps a pattern that keeps happening through a flood of one-offs", () => {
    const d = new PatternDetector(3);
    d.observe("regular", iso(0));
    for (let i = 0; i < MAX_PATTERNS + 100; i += 1) {
      d.observe(`noise${i}`, iso(i + 1));
      if (i % 50 === 0) d.observe("regular", iso(i + 2));
    }
    expect(d.entries().some((c) => c.key === "regular")).toBe(true);
    expect(d.entries()).toHaveLength(MAX_PATTERNS);
  });

  it("refuses new keys from a snapshot once it is full, and keeps what it has", () => {
    const d = new PatternDetector(3);
    for (let i = 0; i < MAX_PATTERNS; i += 1) d.observe(`k${i}`, iso(i));
    d.load([{ key: "from-snapshot", count: 9, firstSeen: iso(0), lastSeen: iso(0), suggested: false }]);
    expect(d.entries()).toHaveLength(MAX_PATTERNS);
    expect(d.entries().some((c) => c.key === "from-snapshot")).toBe(false);
  });

  it("restores a snapshot without re-offering what was already suggested", () => {
    const d = new PatternDetector(2);
    d.load([{ key: "k", count: 5, firstSeen: iso(1), lastSeen: iso(2), suggested: true }]);
    expect(d.candidates().map((c) => c.key)).toEqual(["k"]);
    expect(d.takeSuggestions()).toEqual([]);
  });

  it("takes the higher count and the later sighting when a snapshot overlaps", () => {
    const d = new PatternDetector(2);
    d.observe("k", iso(10));
    d.observe("k", iso(20));
    d.load([{ key: "k", count: 1, firstSeen: iso(0), lastSeen: iso(5), suggested: false }]);
    expect(d.entries()[0]).toMatchObject({ count: 2, lastSeen: iso(20) });
    d.load([{ key: "k", count: 7, firstSeen: iso(0), lastSeen: iso(99), suggested: false }]);
    expect(d.entries()[0]).toMatchObject({ count: 7, lastSeen: iso(99) });
  });

  it("keeps `suggested` sticky across a restore, in both directions", () => {
    const shown = new PatternDetector(1);
    shown.observe("k", iso(1));
    shown.takeSuggestions();
    shown.load([{ key: "k", count: 1, firstSeen: iso(1), lastSeen: iso(1), suggested: false }]);
    expect(shown.takeSuggestions()).toEqual([]); // a snapshot cannot un-offer it

    const fresh = new PatternDetector(1);
    fresh.observe("k", iso(1));
    fresh.load([{ key: "k", count: 1, firstSeen: iso(1), lastSeen: iso(1), suggested: true }]);
    expect(fresh.takeSuggestions()).toEqual([]); // and the snapshot's word counts
  });

  it("ignores anything in a snapshot that is not a pattern", () => {
    const d = new PatternDetector(1);
    d.load([
      { key: "good", count: 2, firstSeen: iso(1), lastSeen: iso(2), suggested: false },
      { key: "zero", count: 0, firstSeen: iso(1), lastSeen: iso(2), suggested: false },
      { key: "nan", count: Number.NaN, firstSeen: iso(1), lastSeen: iso(2), suggested: false },
      { key: 7, count: 1 },
      null,
      undefined,
    ] as unknown as PatternCandidate[]);
    expect(d.entries().map((c) => c.key)).toEqual(["good"]);
  });

  it("rounds a fractional count from a snapshot down to a whole sighting", () => {
    const d = new PatternDetector(2);
    d.load([{ key: "k", count: 2.9, firstSeen: iso(1), lastSeen: iso(2), suggested: false }]);
    expect(d.entries()[0]?.count).toBe(2);
  });
});
