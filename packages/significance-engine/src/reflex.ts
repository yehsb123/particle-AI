import type { SignificanceResult, WorldState } from "@dm/contracts";

export type WorkspaceMode = "development" | "incident";
export type PresenceState = "idle" | "observing" | "evaluating" | "acting" | "waiting_for_approval";

/** Deterministic mode the workspace should be in given the current problems. */
export function suggestMode(world: WorldState): WorkspaceMode {
  return world.activeProblems.length > 0 ? "incident" : "development";
}

/** Cheap presence transition for the AI indicator (no morph, just a signal). */
export function nextPresence(current: PresenceState, sig: SignificanceResult): PresenceState {
  if (sig.shouldDeliberate) return "evaluating";
  return current === "acting" ? "acting" : "observing";
}
