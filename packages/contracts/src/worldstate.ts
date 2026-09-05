import { z } from "zod";
import { AutonomyLevel, Confidence, IsoTimestamp, SessionId } from "./common";
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

/** Continuous intent states (Concept v2) — always present, no error required. */
/**
 * Who can be sensing, and what they can be sensing. The body names each of these to the person
 * in the honest-sensing indicator, so the list lives here rather than in whichever sensor happens
 * to report one: a sensor or a layer nobody has words for reaches the screen as a bare
 * identifier. "unknown" is the name the runtime itself uses for a sensor that did not give one.
 */
export const SENSOR_NAMES = ["web", "extension", "agent", "unknown"] as const;
export type SensorName = (typeof SENSOR_NAMES)[number];

export const SENSING_LAYERS = [
  // the body and the extension
  "interactions",
  "idle",
  "visibility",
  "dwell",
  "tabs",
  "network",
  // the desktop agent
  "files",
  "git",
  "output",
] as const;
export type SensingLayer = (typeof SENSING_LAYERS)[number];

/**
 * What one session looks like from outside it: enough for the rail in another session's body to
 * name it and say what it is dealing with, and nothing that would be its content. The runtime
 * built this shape and the body read it back, each describing it separately, so a field either
 * side changed was a field the other went on believing in.
 */
export const SessionSummary = z.object({
  sessionId: SessionId,
  /** what the runtime worked out that session is doing; a name with nothing in it is not one */
  intent: z.string().min(1).refine((s) => s.trim().length > 0, "an intent needs a name").optional(),
  problems: z.number().int().nonnegative().default(0),
  layers: z.array(z.string()).default([]),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const INTENT_LABELS = [
  "exploring", "focused", "stuck", "switching", "idle", "returning", "debugging",
] as const;
export const IntentLabel = z.enum(INTENT_LABELS);
export type IntentLabel = z.infer<typeof IntentLabel>;

export const IntentHypothesis = z.object({
  label: z.string().min(1),
  confidence: Confidence,
  /** short, externally-safe reason codes that produced this hypothesis */
  reasonCodes: z.array(z.string()).default([]),
});
export type IntentHypothesis = z.infer<typeof IntentHypothesis>;

/**
 * Behavior features reduced from L0–L3 sensing (shape only — never content). These are the
 * inputs to intent inference; they are what makes the runtime understand a *person*, not
 * just react to system events.
 */
export const BehaviorState = z.object({
  interactions: z.number().int().nonnegative().default(0),
  lastInteractionAt: IsoTimestamp.optional(),
  /** seconds without interaction, as reported by the sensor */
  idleSeconds: z.number().nonnegative().default(0),
  /** seconds the user was away (tab hidden) before the latest return; 0 if not returning */
  awaySeconds: z.number().nonnegative().default(0),
  /** last semantic action key and how many times in a row it repeated */
  lastActionKey: z.string().optional(),
  repeatCount: z.number().int().nonnegative().default(0),
  /** distinct entities (files/views) touched recently — breadth of exploration */
  recentEntities: z.array(z.string()).default([]),
  /** the last few action/entity keys in order — alternation between a few = "switching" */
  recentKeys: z.array(z.string()).default([]),
  /** how many undo actions the user performed recently (a "don't do that" signal) */
  undoCount: z.number().int().nonnegative().default(0),
  /** L2 communication shape — per-host counters (host only; never URL path/query/body) */
  network: z
    .object({
      requests: z.number().int().nonnegative().default(0),
      failures: z.number().int().nonnegative().default(0),
      /** requests slower than the slow threshold */
      slow: z.number().int().nonnegative().default(0),
      /** hosts with the most recent failure first */
      failingHosts: z.array(z.string()).default([]),
    })
    .default({ requests: 0, failures: 0, slow: 0, failingHosts: [] }),
});
export type BehaviorState = z.infer<typeof BehaviorState>;

export const EMPTY_BEHAVIOR: BehaviorState = {
  interactions: 0, idleSeconds: 0, awaySeconds: 0, repeatCount: 0, recentEntities: [], recentKeys: [], undoCount: 0,
  network: { requests: 0, failures: 0, slow: 0, failingHosts: [] },
};

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
/**
 * What the runtime believes is going on.
 *
 * A session and the moment it was last touched are the only things it cannot do without. Every
 * other part has an empty form, and a state that arrives without one is filled in rather than
 * refused — because the state that arrives is usually a snapshot, written by whichever build was
 * running then, and a resume should bring back everything it can understand rather than nothing.
 */
export const WorldState = z.object({
  sessionId: SessionId,
  updatedAt: IsoTimestamp,
  currentGoal: Goal.optional(),
  activeContext: ActiveContext.default({}),
  environment: z
    .object({
      applications: z.array(z.string()).optional(),
      files: z.array(z.string()).optional(),
      processes: z.array(ProcessState).optional(),
    })
    .default({}),
  activeProblems: z.array(Problem).default([]),
  recentEvents: z.array(MatterEvent).default([]),
  inferredIntent: IntentHypothesis.optional(),
  behavior: BehaviorState.default(EMPTY_BEHAVIOR),
  /**
   * What each connected sensor (web / extension / agent) currently observes, by layer name —
   * reported by the sensors themselves via `sensor.layers_changed`. The body shows this verbatim
   * so the "currently sensing: …" indicator is always true (Concept v2 privacy rule #3).
   */
  sensing: z.record(z.string(), z.array(z.string())).default({}),
  attention: AttentionState.default({ typing: false }),
  autonomy: AutonomyState.default({ level: 2 }),
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
    behavior: { ...EMPTY_BEHAVIOR },
    sensing: {},
    attention: { typing: false },
    autonomy: { level: 2 }, // MVP default: adaptive UI
  };
}
