import type { IntentHypothesis, IntentLabel, WorldState } from "@particle/contracts";

/**
 * Deterministic intent inference (Concept v2). Reads behavior features + problems from the
 * world state and returns a continuous intent hypothesis — present even when nothing is broken.
 * Pure: no clock, no I/O. A model provider may later refine it; this is the always-on reflex.
 */
export type IntentConfig = {
  returningAfterSeconds: number; // away this long → "returning"
  idleAfterSeconds: number;      // no interaction this long → "idle"
  stuckRepeatCount: number;      // same action this many times in a row → "stuck"
  exploringEntities: number;     // this many distinct entities recently → "exploring"
  switchingKeys: number;         // this many consecutive changes among ≤3 contexts → "switching"
};

export const DEFAULT_INTENT_CONFIG: IntentConfig = {
  returningAfterSeconds: 30,
  idleAfterSeconds: 60,
  stuckRepeatCount: 3,
  exploringEntities: 3,
  switchingKeys: 6,
};

/**
 * Ping-pong detection: the last `n` keys all differ from their predecessor, yet span only a few
 * distinct contexts (A B A B A B). Breadth over many entities is "exploring"; this is juggling.
 */
export function isSwitching(keys: string[], n: number): boolean {
  // It takes at least two keys to alternate. A window of one shows nothing, and a window of
  // zero takes the whole history instead of none — slice(-0) is slice(0) — which made an empty
  // history read as juggling.
  if (n < 2 || keys.length < n) return false;
  const tail = keys.slice(-n);
  for (let i = 1; i < tail.length; i++) if (tail[i] === tail[i - 1]) return false;
  return new Set(tail).size <= 3;
}

export function inferIntent(world: WorldState, config: IntentConfig = DEFAULT_INTENT_CONFIG): IntentHypothesis {
  const b = world.behavior;
  const codes: string[] = [];
  let label: IntentLabel;
  let confidence: number;

  if (b.awaySeconds >= config.returningAfterSeconds) {
    label = "returning"; confidence = 0.9; codes.push(`away_${Math.round(b.awaySeconds)}s`);
  } else if (b.idleSeconds >= config.idleAfterSeconds) {
    label = "idle"; confidence = 0.85; codes.push(`idle_${Math.round(b.idleSeconds)}s`);
  } else if (b.repeatCount >= config.stuckRepeatCount) {
    label = "stuck"; confidence = 0.8; codes.push(`repeated_${b.lastActionKey ?? "action"}_x${b.repeatCount}`);
    if (world.activeProblems.length) codes.push("with_open_problem");
  } else if (world.activeProblems.length > 0) {
    label = "debugging"; confidence = 0.8; codes.push(`open_problems_${world.activeProblems.length}`);
  } else if (isSwitching(b.recentKeys ?? [], config.switchingKeys)) {
    label = "switching"; confidence = 0.75; codes.push(`alternating_${new Set((b.recentKeys ?? []).slice(-config.switchingKeys)).size}_contexts`);
  } else if (b.recentEntities.length >= config.exploringEntities) {
    label = "exploring"; confidence = 0.7; codes.push(`entities_${b.recentEntities.length}`);
  } else {
    label = "focused"; confidence = 0.6; codes.push("steady_interaction");
  }

  return { label, confidence, reasonCodes: codes };
}

/** True when the intent label changed — the significance engine treats this as a transition. */
export function intentChanged(prev: IntentHypothesis | undefined, next: IntentHypothesis): boolean {
  return prev?.label !== next.label;
}
