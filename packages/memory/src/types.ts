export type MemoryKind = "working" | "episodic" | "preference" | "learned";

/** A notable past situation worth remembering (spec §20 — episodic memory). */
import { IsoTimestamp, MAX_MEMORY_WEIGHT, MemoryKey } from "@particle/contracts";

/**
 * A key restored from outside, or nothing.
 *
 * Learned memory comes back from the browser's own storage and from snapshots, neither of which
 * passes through the live path that produced it. The live path composes a short prefix with a name
 * already held to MAX_IDENTIFIER; a restored one had no bound at all, so a two hundred thousand
 * character key was accepted, kept, and written straight back out — a hundred and ninety six
 * kilobytes of it, into local storage and into every snapshot after.
 *
 * Refused rather than cut, because a key selects a learned behaviour: two cut to the same length
 * would be one preference. Refusing one entry leaves the rest of the restore alone.
 */
export function restorableKey(value: unknown): string | null {
  return MemoryKey.safeParse(value).success ? (value as string) : null;
}

/** A count restored from outside, held to what counting could have produced. */
export function restorableWeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), MAX_MEMORY_WEIGHT);
}

/** A time restored from outside, or nothing — it is compared, so it has to be one. */
export function restorableTime(value: unknown): string {
  return typeof value === "string" && IsoTimestamp.safeParse(value).success ? value : "";
}

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
