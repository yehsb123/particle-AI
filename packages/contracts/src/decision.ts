import { z } from "zod";
import { AutonomyLevel, Confidence, MAX_IDENTIFIER, RiskLevel } from "./common";

/**
 * How many capabilities one decision may ask for.
 *
 * A plan is a handful; the runtime executes them one after another. Five hundred of them is a
 * model that has run away, and running them is worse than not.
 */
export const MAX_PLANNED_CAPABILITIES = 16;

/** Every control character except the newline a wrapped sentence has. */
const CONTROL_CHARACTERS = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/**
 * A name a model wrote: a capability to run, a layout to show, a mode to be in.
 *
 * These are names, not prose. Each ends up somewhere that keeps it — a preference key that is
 * stored and snapshotted, a mode written into the blueprint, a line the body renders — and the
 * schema asked only that they not be empty, so a model could write fifty thousand characters, or
 * an escape sequence, into any of them. Trimmed and cleaned the way every other identifier the
 * runtime takes already is.
 */
const ModelName = z
  .string()
  .min(1)
  .transform((s) => s.replace(CONTROL_CHARACTERS, "").trim())
  .refine((s) => s.length > 0, "a name needs something in it")
  .transform((s) => (s.length > MAX_IDENTIFIER ? `${s.slice(0, MAX_IDENTIFIER)}…` : s));

/** A capability the decision wants executed, by id, with optional input. */
export const PlannedCapability = z.object({
  capabilityId: ModelName,
  input: z.record(z.unknown()).optional(),
});
export type PlannedCapability = z.infer<typeof PlannedCapability>;

export const CapabilityPlan = z.object({
  capabilities: z.array(PlannedCapability).max(MAX_PLANNED_CAPABILITIES),
});
export type CapabilityPlan = z.infer<typeof CapabilityPlan>;

/**
 * The UI *intent* — NOT a concrete patch. The morphology planner (UI layer) turns this into
 * a validated patch against the registry. This keeps the decision engine free of UI details.
 */
/**
 * How long a reason a person is shown may be.
 *
 * This is the one piece of model-written prose the product puts in front of somebody, and nothing
 * said how much of it there could be — a provider that ignored "concise" could write an essay
 * into the interface, escape sequences and all. The built-in provider writes about ninety
 * characters, so this is room for several sentences and no room for a page.
 */
export const MAX_REASON_SUMMARY = 600;

/**
 * A reason as it will be shown: trimmed to a length someone reads, with the characters that are
 * not writing taken out.
 *
 * It is cleaned rather than refused. A summary that runs long is a provider being wordy, not a
 * decision being wrong, and throwing the decision away over its caption would cost the person the
 * reshaping it describes.
 */
const ReasonSummary = z
  .string()
  .min(1)
  .transform((s) => {
    const clean = s.replace(CONTROL_CHARACTERS, "").trim();
    return clean.length > MAX_REASON_SUMMARY ? `${clean.slice(0, MAX_REASON_SUMMARY)}…` : clean;
  });

export const UIMorphIntent = z.enum(["surface_incident", "restore_normal", "augment", "none"]);
export type UIMorphIntent = z.infer<typeof UIMorphIntent>;

export const UIMorphPlan = z.object({
  intent: UIMorphIntent,
  targetMode: ModelName,
  confidence: Confidence,
  // never empty: a decision nobody can read is not auditable, and the body shows this as "why"
  reasonSummary: ReasonSummary,
  /** which incident layout to surface, e.g. "runtime_error" | "build_failure" | "test_failure" */
  variant: ModelName.optional(),
});
export type UIMorphPlan = z.infer<typeof UIMorphPlan>;

export const ActionPlan = z.object({
  actions: z.array(PlannedCapability).max(MAX_PLANNED_CAPABILITIES),
});
export type ActionPlan = z.infer<typeof ActionPlan>;

export const AutonomyRequirement = z.object({
  minLevel: AutonomyLevel,
  requiresApproval: z.boolean(),
  risk: RiskLevel,
});
export type AutonomyRequirement = z.infer<typeof AutonomyRequirement>;

export const WorldStateMutation = z.object({
  path: z.string().min(1),
  value: z.unknown(),
});
export type WorldStateMutation = z.infer<typeof WorldStateMutation>;

/**
 * The strict, structured output of the decision engine. Never free-form prose.
 * `reasonSummary` is externally safe — never chain-of-thought.
 */
export const RuntimeDecision = z.object({
  id: z.string().min(1),
  significance: Confidence,
  worldStateUpdates: z.array(WorldStateMutation).default([]),
  intent: z.object({ label: z.string(), confidence: Confidence }).optional(),
  recommendedMode: z.string().optional(),
  capabilityPlan: CapabilityPlan,
  uiPlan: UIMorphPlan.optional(),
  actionPlan: ActionPlan.optional(),
  autonomyRequirement: AutonomyRequirement,
  // never empty: a decision nobody can read is not auditable, and the body shows this as "why"
  reasonSummary: ReasonSummary,
});
export type RuntimeDecision = z.infer<typeof RuntimeDecision>;
