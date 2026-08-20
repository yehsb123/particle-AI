import type { AutonomyLevel, RiskLevel } from "@particle/contracts";

/**
 * Autonomy levels:
 *  0 manual      — responds only to explicit requests
 *  1 suggestive  — may recommend, cannot apply
 *  2 adaptive UI — may reorganise non-destructive UI; read capabilities auto (MVP default)
 *  3 assisted    — may run low-risk (safe_write) capabilities
 *  4 autonomous  — may run external-effect capabilities within configured bounds
 * Destructive capabilities ALWAYS require explicit approval in the MVP.
 */
const AUTO_MIN_LEVEL: Record<RiskLevel, AutonomyLevel | null> = {
  read: 2,
  safe_write: 3,
  external_effect: 4,
  destructive: null, // never auto in MVP
};

export function canAutoRun(risk: RiskLevel, level: AutonomyLevel): boolean {
  const min = AUTO_MIN_LEVEL[risk];
  return min !== null && level >= min;
}

export type PermissionOutcome = "authorized" | "needs_approval" | "denied";

export function classify(risk: RiskLevel, level: AutonomyLevel): PermissionOutcome {
  if (canAutoRun(risk, level)) return "authorized";
  // Below adaptive level the AI is passive: it cannot even request execution.
  if (level < 2) return "denied";
  return "needs_approval";
}
