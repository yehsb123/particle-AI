import { z } from "zod";
import { AutonomyLevel, Confidence, IsoTimestamp } from "./common";
import { AttentionState } from "./attention";
import { MatterEvent } from "./events";

export const Goal = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  createdAt: IsoTimestamp,
});
export type Goal = z.infer<typeof Goal>;

export const Problem = z.object({
  id: z.string().min(1),
  kind: z.string().min(1), // e.g. "runtime_error", "build_failure", "test_failure"
  summary: z.string().min(1),
  severity: z.enum(["warning", "critical"]),
  openedByEventId: z.string().min(1),
  openedAt: IsoTimestamp,
});
export type Problem = z.infer<typeof Problem>;

export const ProcessState = z.object({
  name: z.string().min(1),
  state: z.enum(["healthy", "degraded", "failed"]),
});
export type ProcessState = z.infer<typeof ProcessState>;

export const IntentHypothesis = z.object({
  label: z.string().min(1),
  confidence: Confidence,
});
export type IntentHypothesis = z.infer<typeof IntentHypothesis>;

export const ActiveContext = z.object({
  domain: z.string().optional(),
  task: z.string().optional(),
  activity: z.string().optional(),
  focusedEntity: z.string().optional(),
});
export type ActiveContext = z.infer<typeof ActiveContext>;

export const AutonomyState = z.object({
  level: AutonomyLevel,
});
export type AutonomyState = z.infer<typeof AutonomyState>;

/**
 * What the runtime currently believes is happening. This is NOT conversation history — it
 * is a continuously-reduced snapshot that decisions read from and replay can reconstruct.
 */
export const WorldState = z.object({
  sessionId: z.string().min(1),
  updatedAt: IsoTimestamp,
  currentGoal: Goal.optional(),
  activeContext: ActiveContext,
  environment: z.object({
    applications: z.array(z.string()).optional(),
    files: z.array(z.string()).optional(),
    processes: z.array(ProcessState).optional(),
  }),
  activeProblems: z.array(Problem),
  recentEvents: z.array(MatterEvent),
  inferredIntent: IntentHypothesis.optional(),
  attention: AttentionState,
  autonomy: AutonomyState,
});
export type WorldState = z.infer<typeof WorldState>;

export const RECENT_EVENTS_LIMIT = 50;

export function emptyWorldState(sessionId: string, now: string): WorldState {
  return {
    sessionId,
    updatedAt: now,
    activeContext: {},
    environment: {},
    activeProblems: [],
    recentEvents: [],
    attention: { typing: false },
    autonomy: { level: 2 }, // MVP default: adaptive UI
  };
}
