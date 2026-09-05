import type { SignificanceResult, WorldState } from "@particle/contracts";

export type WorkspaceMode = "development" | "incident";
// One list, in the contracts: the body names each of these to the person, and the frame that
// carries one between the two sides is checked against it.
export type { PresenceState } from "@particle/contracts";
import type { PresenceState } from "@particle/contracts";

/** Deterministic mode the workspace should be in given the current problems. */
export function suggestMode(world: WorldState): WorkspaceMode {
  return world.activeProblems.length > 0 ? "incident" : "development";
}

/** Cheap presence transition for the AI indicator (no morph, just a signal). */
export function nextPresence(current: PresenceState, sig: SignificanceResult): PresenceState {
  if (sig.shouldDeliberate) return "evaluating";
  return current === "acting" ? "acting" : "observing";
}
