import { describe, it, expect } from "vitest";
import { MemorySystem } from "./index";
import { PatternDetector } from "./pattern";
import { EpisodicMemory, PreferenceMemory, WorkingMemory } from "./stores";

const T = (n: number) => `2026-08-19T00:00:0${n}Z`;

describe("WorkingMemory", () => {
  it("stores and clears scratch values", () => {
    const w = new WorkingMemory();
    w.set("focus", "editor");
    expect(w.get("focus")).toBe("editor");
    expect(w.has("focus")).toBe(true);
    w.clear();
    expect(w.has("focus")).toBe(false);
  });
});

describe("EpisodicMemory", () => {
  it("records, recalls recent, and searches by context", () => {
    const e = new EpisodicMemory();
    e.record({ id: "1", at: T(1), context: "development.incident", summary: "500 on /users", eventTypes: ["development.server_error"] });
    e.record({ id: "2", at: T(2), context: "development.build", summary: "build failed", eventTypes: ["development.build_failed"] });
    expect(e.count()).toBe(2);
    expect(e.recent(1)[0]!.id).toBe("2");
    expect(e.search("incident").map((x) => x.id)).toEqual(["1"]);
  });
});

describe("PreferenceMemory", () => {
  it("reinforces and ranks preferences", () => {
    const p = new PreferenceMemory();
    p.reinforce("logs-visible-while-debugging");
    p.reinforce("logs-visible-while-debugging");
    p.reinforce("dark-theme");
    expect(p.weightOf("logs-visible-while-debugging")).toBe(2);
    expect(p.top(1)[0]!.key).toBe("logs-visible-while-debugging");
  });
});

describe("PatternDetector", () => {
  it("promotes a repeated combination to a candidate at the threshold", () => {
    const d = new PatternDetector(3);
    d.observe("incident->surface", T(1));
    d.observe("incident->surface", T(2));
    expect(d.candidates()).toHaveLength(0); // not yet
    d.observe("incident->surface", T(3));
    expect(d.candidates().map((c) => c.key)).toEqual(["incident->surface"]);
  });

  it("offers each suggestion only once", () => {
    const d = new PatternDetector(2);
    d.observe("k", T(1));
    d.observe("k", T(2));
    expect(d.takeSuggestions().map((c) => c.key)).toEqual(["k"]);
    expect(d.takeSuggestions()).toHaveLength(0); // already suggested
  });
});

describe("MemorySystem", () => {
  it("aggregates all four memory types", () => {
    const m = new MemorySystem();
    m.working.set("a", 1);
    m.preferences.reinforce("p");
    m.episodic.record({ id: "e", at: T(1), context: "c", summary: "s", eventTypes: [] });
    m.patterns.observe("x", T(1));
    expect(m.working.get("a")).toBe(1);
    expect(m.preferences.weightOf("p")).toBe(1);
    expect(m.episodic.count()).toBe(1);
    expect(m.patterns.observe("x", T(2)).count).toBe(2);
  });
});

describe("PatternDetector persistence", () => {
  it("restores patterns without re-offering suggested ones; garbage ignored; max count wins", () => {
    const a = new PatternDetector(3);
    for (let i = 0; i < 3; i++) a.observe("k", T(i));
    expect(a.takeSuggestions().map((c) => c.key)).toEqual(["k"]); // offered once
    const saved = a.entries();

    const b = new PatternDetector(3);
    b.load(JSON.parse(JSON.stringify(saved)) as typeof saved);
    expect(b.takeSuggestions()).toEqual([]); // a restart never re-offers
    expect(b.observe("k", T(9)).count).toBe(4); // counting continues from the restored value

    const c = new PatternDetector(3);
    c.observe("k", T(0));
    c.load([{ key: "k", count: 2, firstSeen: T(0), lastSeen: T(1), suggested: false }]);
    expect(c.observe("k", T(2)).count).toBe(3); // max(1,2)+1
    c.load([{ key: 1 as unknown as string, count: NaN, firstSeen: "", lastSeen: "", suggested: false }]);
    expect(c.entries().every((e) => typeof e.key === "string")).toBe(true);
  });
});
