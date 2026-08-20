import type { MatterEvent, Severity, UIBlueprint, UIPatch } from "@particle/contracts";
import { incidentPatch, recoveryPatch } from "@particle/ui-registry";
import { findById } from "@particle/ui-protocol";

/**
 * Phase-1 deterministic decision logic. This is intentionally simple, rule-based, and
 * LLM-free — it proves the observe→decide→morph loop end to end. Phases 3–4 replace this
 * with the significance engine + decision engine + intelligence router packages.
 */
export type Decision = {
  decisionId: string;
  patch: UIPatch;
  confidence: number;
  severity: Severity;
  reasonSummary: string;
  presence: "observing" | "evaluating" | "acting";
  /** whether this decision meaningfully restructures the workspace */
  major: boolean;
  /** de-escalations (reducing/removing UI) are not rate-limited by dwell time */
  deEscalation: boolean;
};

const INCIDENT_TYPES = new Set([
  "development.server_error",
  "development.build_failed",
  "development.test_failed",
]);
const RECOVERY_TYPES = new Set([
  "development.server_recovered",
  "development.build_succeeded",
  "development.test_passed",
]);

export function decide(event: MatterEvent, current: UIBlueprint): Decision | null {
  const incidentPresent = !!findById(current.root, "incident");

  if (INCIDENT_TYPES.has(event.type)) {
    if (incidentPresent) return null; // already surfaced — do not thrash
    const severity: Severity = event.type === "development.server_error" ? "critical" : "warning";
    return {
      decisionId: `dec-${event.id}`,
      patch: incidentPatch(`dec-${event.id}`),
      confidence: 0.9,
      severity,
      reasonSummary:
        "Runtime failure detected during active development; surfaced an incident workspace beside the editor without discarding unsaved work.",
      presence: "acting",
      major: true,
      deEscalation: false,
    };
  }

  if (RECOVERY_TYPES.has(event.type)) {
    if (!incidentPresent) return null;
    return {
      decisionId: `dec-${event.id}`,
      patch: recoveryPatch(`dec-${event.id}`),
      confidence: 0.88,
      severity: "info",
      reasonSummary:
        "Service recovered and remained stable; returned the workspace to normal development mode.",
      presence: "acting",
      major: true,
      deEscalation: true,
    };
  }

  return null; // event not significant enough to morph in Phase 1
}
