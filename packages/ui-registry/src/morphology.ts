import type { UIBlueprint, UIComponent, UIMorphIntent, UIPatch } from "@particle/contracts";
import { incidentPatch, recoveryPatch, augmentPatch, type IncidentKind, type AugmentKind, AUGMENT_TITLES } from "./blueprints";

const INCIDENT_KINDS: IncidentKind[] = ["runtime_error", "build_failure", "test_failure", "security_alert", "network_failure"];
function asIncidentKind(v: string | undefined): IncidentKind {
  return (v && INCIDENT_KINDS.includes(v as IncidentKind) ? v : "runtime_error") as IncidentKind;
}

function findById(node: UIComponent, id: string): UIComponent | undefined {
  if (node.id === id) return node;
  for (const c of node.children ?? []) {
    const f = findById(c, id);
    if (f) return f;
  }
  return undefined;
}

/**
 * The morphology planner: turn a decision's UI *intent* into a concrete, registry-valid
 * patch against the current blueprint. Idempotent — re-issuing the same intent when the UI
 * already reflects it yields `null` (no thrash). This is the seam that keeps the decision
 * engine free of UI specifics.
 */
export function planMorph(
  current: UIBlueprint,
  intent: UIMorphIntent,
  decisionId = "decision",
  variant?: string,
  recurrence = 0,
): UIPatch | null {
  const incidentPresent = !!findById(current.root, "incident");
  switch (intent) {
    case "surface_incident":
      return incidentPresent ? null : incidentPatch(decisionId, asIncidentKind(variant), recurrence);
    case "restore_normal":
      return incidentPresent ? recoveryPatch(decisionId) : null;
    case "augment": {
      // one context card at a time; a different augment replaces the current one
      const kind: AugmentKind = variant === "stuck" || variant === "switching" ? variant : "returning";
      const existing = findById(current.root, "context");
      const patch = augmentPatch(decisionId, kind);
      if (existing) {
        if (existing.props?.title === AUGMENT_TITLES[kind]) return null;
        const add = patch.operations[0];
        if (add && add.op === "add") return { ...patch, operations: [{ op: "replace", targetId: "context", component: add.component }] };
      }
      return patch;
    }
    case "none":
    default:
      return null;
  }
}
