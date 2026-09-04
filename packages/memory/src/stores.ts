import type { Episode, Preference } from "./types";

/** Current-task scratch memory (cleared per session/goal). */
export class WorkingMemory {
  private map = new Map<string, unknown>();
  set(key: string, value: unknown): void {
    this.map.set(key, value);
  }
  get(key: string): unknown {
    return this.map.get(key);
  }
  has(key: string): boolean {
    return this.map.has(key);
  }
  clear(): void {
    this.map.clear();
  }
  entries(): [string, unknown][] {
    return [...this.map.entries()];
  }
}

/** Important prior situations. Bounded ring; searchable by context. */
export class EpisodicMemory {
  private episodes: Episode[] = [];
  constructor(private readonly limit = 200) {}
  record(episode: Episode): void {
    this.episodes.push(episode);
    if (this.episodes.length > this.limit) this.episodes.shift();
  }
  /** The newest `n` episodes, newest first. Asking for none gives none — `slice(-0)` is `slice(0)`, which is everything. */
  recent(n = 10): Episode[] {
    if (n <= 0) return [];
    return this.episodes.slice(-n).reverse();
  }
  search(contextSubstring: string): Episode[] {
    const q = contextSubstring.toLowerCase();
    return this.episodes.filter((e) => e.context.toLowerCase().includes(q));
  }
  count(): number {
    return this.episodes.length;
  }
}

/** Count-weighted preferences reinforced over time. */
export class PreferenceMemory {
  private weights = new Map<string, number>();
  reinforce(key: string, delta = 1): number {
    const next = Math.max(0, (this.weights.get(key) ?? 0) + delta); // never negative (redo hands a dismissal back)
    this.weights.set(key, next);
    return next;
  }
  weightOf(key: string): number {
    return this.weights.get(key) ?? 0;
  }
  top(n = 5): Preference[] {
    return [...this.weights.entries()]
      .map(([key, weight]) => ({ key, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, n);
  }
  /** Every preference (for persistence across sessions / restarts). */
  entries(): Preference[] {
    return [...this.weights.entries()].map(([key, weight]) => ({ key, weight }));
  }
  /** Restore persisted preferences (max wins on conflict — never lowers what was learned live). */
  load(prefs: Preference[]): void {
    for (const p of prefs) {
      if (typeof p?.key !== "string" || !Number.isFinite(p.weight)) continue;
      this.weights.set(p.key, Math.max(this.weights.get(p.key) ?? 0, p.weight));
    }
  }
}
