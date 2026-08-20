import type { UIBlueprint, UIComponent, UIMorphIntent, UIPatch } from "@particle/contracts";
import { incidentPatch, recoveryPatch } from "./blueprints";

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
): UIPatch | null {
  const incidentPresent = !!findById(current.root, "incident");
  switch (intent) {
    case "surface_incident":
      return incidentPresent ? null : incidentPatch(decisionId);
    case "restore_normal":
      return incidentPresent ? recoveryPatch(decisionId) : null;
    case "augment":
    case "none":
    default:
      return null;
  }
}
