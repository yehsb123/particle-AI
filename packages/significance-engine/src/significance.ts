import type { MatterEvent, SignificanceResult, WorldState } from "@particle/contracts";
import { SEVERITY_RANK } from "@particle/contracts";

export type SignificanceConfig = {
  weights: { severity: number; relevance: number; novelty: number; problem: number };
  /** score at or above which we deliberate */
  threshold: number;
  /** how many recent events of the same type before novelty decays to ~0 */
  noveltyWindow: number;
};

export const DEFAULT_SIGNIFICANCE_CONFIG: SignificanceConfig = {
  weights: { severity: 0.35, relevance: 0.2, novelty: 0.15, problem: 0.3 },
  threshold: 0.6,
  noveltyWindow: 4,
};

const PROBLEM_OPENERS = new Set([
  "development.server_error",
  "development.build_failed",
  "development.test_failed",
]);
const PROBLEM_CLOSERS = new Set([
  "development.server_recovered",
  "development.build_succeeded",
  "development.test_passed",
]);

/**
 * Cheap, deterministic significance evaluation — the reflex that decides whether an event
 * is worth an (expensive) deliberation cycle. No LLM. Combines severity, task relevance,
 * novelty, and problem transitions under configurable weights.
 */
export function evaluateSignificance(
  event: MatterEvent,
  world: WorldState,
  config: SignificanceConfig = DEFAULT_SIGNIFICANCE_CONFIG,
): SignificanceResult {
  const reasonCodes: string[] = [];
  const w = config.weights;

  // Severity (0..1)
  const severity = SEVERITY_RANK[event.severity] / 4;
  if (event.severity === "critical") reasonCodes.push("severity_critical");

  // Relevance to current activity/domain
  let relevance = 0;
  if (world.activeContext.activity && event.source === "development") {
    relevance = 1;
    reasonCodes.push("relevant_to_activity");
  } else if (event.source === "user") {
    relevance = 0.5;
  }

  // Novelty — repeated identical events decay toward 0 (anti-thrash)
  const sameTypeRecently = world.recentEvents.filter((e) => e.type === event.type).length;
  const novelty = Math.max(0, 1 - sameTypeRecently / config.noveltyWindow);
  if (sameTypeRecently === 0) reasonCodes.push("novel_event");
  if (sameTypeRecently >= config.noveltyWindow) reasonCodes.push("repetitive_event");

  // Problem transitions dominate
  let problem = 0;
  if (PROBLEM_OPENERS.has(event.type)) {
    problem = 1;
    reasonCodes.push("opens_problem");
  } else if (PROBLEM_CLOSERS.has(event.type)) {
    // only meaningful if a matching problem is actually open
    problem = world.activeProblems.length > 0 ? 1 : 0.3;
    reasonCodes.push("closes_problem");
  }

  const score = clamp01(
    w.severity * severity +
      w.relevance * relevance +
      w.novelty * novelty +
      w.problem * problem,
  );

  // Deliberate when the score clears threshold, or for critical events / problem transitions.
  const shouldDeliberate =
    score >= config.threshold ||
    event.severity === "critical" ||
    PROBLEM_OPENERS.has(event.type) ||
    (PROBLEM_CLOSERS.has(event.type) && world.activeProblems.length > 0);

  if (shouldDeliberate) reasonCodes.push("deliberate");
  else reasonCodes.push("reflex_only");

  return { score, reasonCodes, shouldDeliberate };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
