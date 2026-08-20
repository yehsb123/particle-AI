export type MemoryKind = "working" | "episodic" | "preference" | "learned";

/** A notable past situation worth remembering (spec §20 — episodic memory). */
export type Episode = {
  id: string;
  at: string;
  /** short context label, e.g. "development.incident" */
  context: string;
  summary: string;
  eventTypes: string[];
};

/** A count-weighted preference, e.g. "keeps logs visible while debugging". */
export type Preference = { key: string; weight: number };

/** A repeated context→behaviour combination that may be worth templatizing. */
export type PatternCandidate = {
  key: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  /** true once it has been surfaced as a reusable-template suggestion */
  suggested: boolean;
};
