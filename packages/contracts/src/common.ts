import { z } from "zod";

/** ISO-8601 timestamp string. We pass time in explicitly (never Date.now() in pure code). */
/**
 * A timestamp the runtime can turn back into a clock. Replay derives its clock from these, so a
 * value `Date.parse` cannot read would make every guard comparison false and quietly drop the
 * cooldowns. The format is checked here rather than trusted.
 */
export const IsoTimestamp = z
  .string()
  .min(1)
  .refine((s) => Number.isFinite(Date.parse(s)), { message: "not a readable timestamp" });
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

export const Confidence = z.number().min(0).max(1);
export type Confidence = z.infer<typeof Confidence>;

export const Severity = z.enum([
  "debug",
  "info",
  "notice",
  "warning",
  "critical",
]);
export type Severity = z.infer<typeof Severity>;

/** Ordinal used by significance/guard math. Higher = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  critical: 4,
};

export const RiskLevel = z.enum([
  "read",
  "safe_write",
  "external_effect",
  "destructive",
]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const AutonomyLevel = z.union([
  z.literal(0), // manual
  z.literal(1), // suggestive
  z.literal(2), // adaptive UI (MVP default)
  z.literal(3), // assisted action
  z.literal(4), // autonomous
]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;
