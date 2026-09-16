import { describe, it, expect } from "vitest";
import { MAX_MEMORY_KEY, MAX_MEMORY_WEIGHT, MAX_IDENTIFIER } from "@particle/contracts";
import { PreferenceMemory, MAX_PREFERENCES } from "./stores";
import { PatternDetector, MAX_PATTERNS } from "./pattern";

/**
 * Learned memory is restored from the browser's own storage and from snapshots — neither of which
 * passes through the live path that produced it. The live path composes a key from a short prefix
 * and a name the runtime already holds to MAX_IDENTIFIER; the restore had no bound at all.
 *
 * Measured through the real runtime: a two hundred thousand character preference key was accepted,
 * kept, and written straight back out — a hundred and ninety six kilobyte export, into local
 * storage and into every snapshot after. A key carrying an escape sequence survived, and it is
 * written onto a card a person reads. A weight of 1e308 was accepted for a preference nobody set,
 * and the threshold that acts on it is two.
 *
 * A key is refused rather than cut, because it selects a learned behaviour: two cut to the same
 * length would be one preference. A count is clamped, because clamping a count merges nothing.
 *
 * The bound is on the COMPOSED key, not on a single name. The first attempt at this reused
 * Identifier and so refused a hundred-and-thirty-nine character key the live path really makes —
 * which is why the longest real key has a test of its own.
 */
const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);
const AT = "2026-09-16T00:00:00.000Z";

// what the runtime itself composes: "dismissed:" + intent + ":" + a ModelName, which is
// MAX_IDENTIFIER plus the ellipsis a cut name carries
const LONGEST_REAL_KEY = "dismissed:augment:" + "n".repeat(MAX_IDENTIFIER + 1);

describe("a preference restored from outside", () => {
  it("is the preference, when it is one", () => {
    const prefs = new PreferenceMemory();
    prefs.load([{ key: "dismissed:augment:context-card", weight: 2 }, { key: "morph:augment", weight: 7 }]);
    expect(prefs.entries()).toEqual([
      { key: "dismissed:augment:context-card", weight: 2 },
      { key: "morph:augment", weight: 7 },
    ]);
  });

  it("is the longest key this runtime actually composes", () => {
    // 139 characters: the rule is on the composed key, not on one name inside it
    expect(LONGEST_REAL_KEY.length).toBeGreaterThan(MAX_IDENTIFIER);
    expect(LONGEST_REAL_KEY.length).toBeLessThanOrEqual(MAX_MEMORY_KEY);
    const prefs = new PreferenceMemory();
    prefs.load([{ key: LONGEST_REAL_KEY, weight: 1 }]);
    expect(prefs.entries()).toHaveLength(1);
  });

  it("is not a key longer than any key could be", () => {
    const prefs = new PreferenceMemory();
    prefs.load([{ key: "k".repeat(MAX_MEMORY_KEY + 1), weight: 3 }, { key: "v".repeat(200_000), weight: 3 }]);
    expect(prefs.entries()).toEqual([]);
  });

  it("is not a key carrying what is not writing", () => {
    const prefs = new PreferenceMemory();
    prefs.load([{ key: "dismissed:augment:x" + ESC + "[31m", weight: 3 }, { key: "dismissed:augment:y" + NUL, weight: 3 }]);
    expect(prefs.entries()).toEqual([]);
  });

  it("claims no more reinforcement than counting could have produced", () => {
    const prefs = new PreferenceMemory();
    prefs.load([{ key: "dismissed:augment:a", weight: 1e308 }, { key: "dismissed:augment:b", weight: -1e308 }]);
    expect(prefs.weightOf("dismissed:augment:a")).toBe(MAX_MEMORY_WEIGHT);
    expect(prefs.weightOf("dismissed:augment:b")).toBe(0);
  });

  it("takes no weight that is not a number", () => {
    const prefs = new PreferenceMemory();
    prefs.load([
      { key: "a", weight: NaN as number },
      { key: "b", weight: Infinity as number },
      { key: "c", weight: "3" as unknown as number },
    ]);
    expect(prefs.entries()).toEqual([]);
  });

  it("weighs nothing more than what it already had", () => {
    // max wins, so a restore cannot walk a learned count backwards
    const prefs = new PreferenceMemory();
    prefs.reinforce("dismissed:augment:a");
    prefs.reinforce("dismissed:augment:a");
    prefs.load([{ key: "dismissed:augment:a", weight: 1 }]);
    expect(prefs.weightOf("dismissed:augment:a")).toBe(2);
  });

  it("still cannot be grown past its ceiling by a restore", () => {
    const prefs = new PreferenceMemory();
    prefs.load(Array.from({ length: MAX_PREFERENCES + 50 }, (_, i) => ({ key: "k" + i, weight: 1 })));
    expect(prefs.entries()).toHaveLength(MAX_PREFERENCES);
  });

  it("refuses one entry without losing the rest of the restore", () => {
    const prefs = new PreferenceMemory();
    prefs.load([{ key: "good:one", weight: 1 }, { key: "bad" + NUL, weight: 1 }, { key: "good:two", weight: 1 }]);
    expect(prefs.entries().map((p) => p.key)).toEqual(["good:one", "good:two"]);
  });
});

describe("a pattern restored from outside", () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    key: "development.server_error->augment", count: 4, firstSeen: AT, lastSeen: AT, suggested: false, ...over,
  });

  it("is the pattern, when it is one", () => {
    const patterns = new PatternDetector();
    patterns.load([candidate()]);
    expect(patterns.entries()).toEqual([candidate()]);
  });

  it("is not a key that could not have been observed", () => {
    const patterns = new PatternDetector();
    patterns.load([
      candidate({ key: "k".repeat(MAX_MEMORY_KEY + 1) }),
      candidate({ key: "user.click" + ESC + "->augment" }),
    ]);
    expect(patterns.entries()).toEqual([]);
  });

  it("claims no more repetitions than counting could have produced", () => {
    const patterns = new PatternDetector();
    patterns.load([candidate({ count: 1e308 })]);
    expect(patterns.entries()[0]?.count).toBe(MAX_MEMORY_WEIGHT);
  });

  it("carries only times that are times, because they are compared", () => {
    const patterns = new PatternDetector();
    patterns.load([candidate({ firstSeen: "not a time", lastSeen: "9".repeat(50_000) })]);
    const [kept] = patterns.entries();
    expect(kept?.firstSeen).toBe("");
    expect(kept?.lastSeen).toBe("");
  });

  it("cannot be moved forward by a time that is not one", () => {
    // lastSeen is compared as a string, so a row of nines would pin it forever
    const patterns = new PatternDetector();
    patterns.load([candidate()]);
    patterns.load([candidate({ lastSeen: "9".repeat(50) })]);
    expect(patterns.entries()[0]?.lastSeen).toBe(AT);
  });

  it("keeps a suggestion from being offered twice across a restart", () => {
    // the sticky flag is what this restore exists for; the new rule must not drop it
    const patterns = new PatternDetector();
    patterns.load([candidate({ suggested: true })]);
    expect(patterns.takeSuggestions()).toEqual([]);
  });

  it("still cannot be grown past its ceiling by a restore", () => {
    const patterns = new PatternDetector();
    patterns.load(Array.from({ length: MAX_PATTERNS + 50 }, (_, i) => candidate({ key: "k" + i })));
    expect(patterns.entries()).toHaveLength(MAX_PATTERNS);
  });
});
