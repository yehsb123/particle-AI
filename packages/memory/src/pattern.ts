import type { PatternCandidate } from "./types";

/**
 * Detects repeated context→behaviour combinations. When a key crosses the threshold it
 * becomes a *candidate* for a reusable workspace template. Per spec §20 the system only
 * SUGGESTS templates — it never auto-mutates capabilities. Pure counters; time is injected.
 */
/**
 * How many distinct patterns one session keeps. A pattern key is built from the event type,
 * and an event type is any string a sensor sends, so without a ceiling a long-lived session
 * grows this table forever.
 */
export const MAX_PATTERNS = 500;

export class PatternDetector {
  private counts = new Map<string, PatternCandidate>();
  constructor(private readonly threshold = 3) {}

  /** Forget the pattern seen longest ago, so a new one has room. Ties go to the older entry. */
  private evictStalest(): void {
    let stalest: PatternCandidate | undefined;
    for (const c of this.counts.values()) {
      if (!stalest || c.lastSeen < stalest.lastSeen) stalest = c;
    }
    if (stalest) this.counts.delete(stalest.key);
  }

  observe(key: string, at: string): PatternCandidate {
    const existing = this.counts.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastSeen = at;
      return { ...existing }; // a copy: what the caller does with it is not learning
    }
    if (this.counts.size >= MAX_PATTERNS) this.evictStalest();
    const created: PatternCandidate = { key, count: 1, firstSeen: at, lastSeen: at, suggested: false };
    this.counts.set(key, created);
    return { ...created };
  }

  /** Every observed pattern (for persistence across restarts), threshold or not. */
  entries(): PatternCandidate[] {
    return [...this.counts.values()].map((c) => ({ ...c }));
  }

  /**
   * Restore persisted patterns. Max count wins and `suggested` is sticky, so a restart never
   * re-offers a template the person already saw. Garbage is ignored; the table stays bounded.
   */
  load(items: PatternCandidate[]): void {
    for (const it of items) {
      if (typeof it?.key !== "string" || !Number.isFinite(it.count) || it.count < 1) continue;
      if (this.counts.size >= MAX_PATTERNS && !this.counts.has(it.key)) continue;
      const existing = this.counts.get(it.key);
      if (!existing) {
        this.counts.set(it.key, { key: it.key, count: Math.floor(it.count), firstSeen: String(it.firstSeen ?? ""), lastSeen: String(it.lastSeen ?? ""), suggested: it.suggested === true });
      } else {
        existing.count = Math.max(existing.count, Math.floor(it.count));
        existing.suggested = existing.suggested || it.suggested === true;
        if (it.lastSeen && String(it.lastSeen) > existing.lastSeen) existing.lastSeen = String(it.lastSeen);
      }
    }
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
