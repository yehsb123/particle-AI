import type { AutonomyLevel, RiskLevel } from "@particle/contracts";
import { classify, type PermissionOutcome } from "./autonomy";

export type PermissionItem = {
  capabilityId: string;
  risk: RiskLevel;
  /** What the capability says must be granted before it may run. Built-ins declare nothing. */
  requiredPermissions?: readonly string[];
};

/** How many ungranted names are spelled out. The decision uses whether there are any, not how many. */
export const MAX_NAMED_PERMISSIONS = 3;

/**
 * The names a capability declares that nobody has granted. A name we cannot read is a permission
 * we cannot check, which is not a permission we have, so it counts as missing too.
 */
function ungranted(item: PermissionItem, granted: ReadonlySet<string>): string[] {
  const missing = new Set<string>();
  for (const raw of item.requiredPermissions ?? []) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!granted.has(name)) missing.add(name || "an unreadable permission");
    if (missing.size >= MAX_NAMED_PERMISSIONS) break;
  }
  return [...missing];
}

export type PermissionVerdict = {
  capabilityId: string;
  risk: RiskLevel;
  outcome: PermissionOutcome;
  reason: string;
  /** Declared permissions that are not granted. Empty unless that is what held it back. */
  missingPermissions: string[];
};

export type PermissionEvaluation = {
  authorized: PermissionItem[];
  needsApproval: PermissionItem[];
  denied: PermissionItem[];
  verdicts: PermissionVerdict[];
};

/**
 * Pure evaluation of a capability plan against the current autonomy level and what has been
 * granted. A capability may declare permissions it needs before it runs: a tool from an MCP
 * server, for instance, needs that server to have been allowed. Nothing read that declaration
 * until now, so such a tool ran on its own at the default level. A capability cannot be trusted
 * to declare honestly, so an ungranted name only ever holds one back, never lets one through.
 * The worst a capability can do to itself here is have to ask.
 */
export function evaluatePlan(
  items: PermissionItem[],
  level: AutonomyLevel,
  granted: Iterable<string> = [],
): PermissionEvaluation {
  const allowed = new Set(granted);
  const authorized: PermissionItem[] = [];
  const needsApproval: PermissionItem[] = [];
  const denied: PermissionItem[] = [];
  const verdicts: PermissionVerdict[] = [];

  for (const item of items) {
    const missingPermissions = ungranted(item, allowed);
    let outcome = classify(item.risk, level);
    let reason = `${item.risk}@L${level} → ${outcome}`;
    if (missingPermissions.length > 0 && outcome === "authorized") {
      outcome = "needs_approval";
      reason = `not granted: ${missingPermissions.join(", ")}`;
    }
    verdicts.push({ capabilityId: item.capabilityId, risk: item.risk, outcome, reason, missingPermissions });
    if (outcome === "authorized") authorized.push(item);
    else if (outcome === "needs_approval") needsApproval.push(item);
    else denied.push(item);
  }

  return { authorized, needsApproval, denied, verdicts };
}
