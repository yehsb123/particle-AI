import type { AutonomyLevel, RiskLevel } from "@dm/contracts";
import { classify, type PermissionOutcome } from "./autonomy";

export type PermissionItem = { capabilityId: string; risk: RiskLevel };

export type PermissionVerdict = {
  capabilityId: string;
  risk: RiskLevel;
  outcome: PermissionOutcome;
  reason: string;
};

export type PermissionEvaluation = {
  authorized: PermissionItem[];
  needsApproval: PermissionItem[];
  denied: PermissionItem[];
  verdicts: PermissionVerdict[];
};

/** Pure evaluation of a capability plan against the current autonomy level. */
export function evaluatePlan(
  items: PermissionItem[],
  level: AutonomyLevel,
): PermissionEvaluation {
  const authorized: PermissionItem[] = [];
  const needsApproval: PermissionItem[] = [];
  const denied: PermissionItem[] = [];
  const verdicts: PermissionVerdict[] = [];

  for (const item of items) {
    const outcome = classify(item.risk, level);
    verdicts.push({
      capabilityId: item.capabilityId,
      risk: item.risk,
      outcome,
      reason: `${item.risk}@L${level} → ${outcome}`,
    });
    if (outcome === "authorized") authorized.push(item);
    else if (outcome === "needs_approval") needsApproval.push(item);
    else denied.push(item);
  }

  return { authorized, needsApproval, denied, verdicts };
}
