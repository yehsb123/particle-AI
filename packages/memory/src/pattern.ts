import type { PatternCandidate } from "./types";

/**
 * Detects repeated context→behaviour combinations. When a key crosses the threshold it
 * becomes a *candidate* for a reusable workspace template. Per spec §20 the system only
 * SUGGESTS templates — it never auto-mutates capabilities. Pure counters; time is injected.
 */
export class PatternDetector {
  private counts = new Map<string, PatternCandidate>();
  constructor(private readonly threshold = 3) {}

  observe(key: string, at: string): PatternCandidate {
    const existing = this.counts.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = at;
      return existing;
    }
    const created: PatternCandidate = { key, count: 1, firstSeen: at, lastSeen: at, suggested: false };
    this.counts.set(key, created);
    return created;
  }

  /** All keys that have reached the threshold. */
  candidates(): PatternCandidate[] {
    return [...this.counts.values()].filter((c) => c.count >= this.threshold);
  }

  /**
   * Return candidates not yet surfaced, marking them suggested so they are offered once.
   * The caller decides whether to actually create a template (a reviewed, deliberate act).
   */
  takeSuggestions(): PatternCandidate[] {
    const fresh = this.candidates().filter((c) => !c.suggested);
    for (const c of fresh) c.suggested = true;
    return fresh.map((c) => ({ ...c }));
  }
}
