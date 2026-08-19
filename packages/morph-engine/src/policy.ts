/**
 * Morph stability configuration. Kept as data (not scattered constants) so behavior is
 * inspectable and tunable. All durations in milliseconds.
 */
export type MorphPolicy = {
  /** minimum confidence for any morph */
  minConfidence: number;
  /** minimum confidence for a large/structural transformation */
  minConfidenceStructural: number;
  /** minimum ms between any two morphs */
  cooldownMs: number;
  /** minimum ms a major workspace change must dwell before another major change */
  majorDwellMs: number;
  /** fraction of components changed that classifies a morph as "major" (0..1) */
  majorChangeRatio: number;
  /** critical-severity events may bypass the cooldown (never the unsaved-state rule) */
  allowCriticalBypass: boolean;
};

export const DEFAULT_MORPH_POLICY: MorphPolicy = {
  minConfidence: 0.75,
  minConfidenceStructural: 0.85,
  cooldownMs: 5_000,
  majorDwellMs: 8_000,
  majorChangeRatio: 0.5,
  allowCriticalBypass: true,
};
