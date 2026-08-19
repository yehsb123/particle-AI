import { z } from "zod";
import { AutonomyLevel, Confidence, RiskLevel } from "./common";

/** A capability the decision wants executed, by id, with optional input. */
export const PlannedCapability = z.object({
  capabilityId: z.string().min(1),
  input: z.record(z.unknown()).optional(),
});
export type PlannedCapability = z.infer<typeof PlannedCapability>;

export const CapabilityPlan = z.object({
  capabilities: z.array(PlannedCapability),
});
export type CapabilityPlan = z.infer<typeof CapabilityPlan>;

/**
 * The UI *intent* — NOT a concrete patch. The morphology planner (UI layer) turns this into
 * a validated patch against the registry. This keeps the decision engine free of UI details.
 */
export const UIMorphIntent = z.enum(["surface_incident", "restore_normal", "augment", "none"]);
export type UIMorphIntent = z.infer<typeof UIMorphIntent>;

export const UIMorphPlan = z.object({
  intent: UIMorphIntent,
  targetMode: z.string().min(1),
  confidence: Confidence,
  reasonSummary: z.string(),
});
export type UIMorphPlan = z.infer<typeof UIMorphPlan>;

export const ActionPlan = z.object({
  actions: z.array(PlannedCapability),
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
  reasonSummary: z.string(),
});
export type RuntimeDecision = z.infer<typeof RuntimeDecision>;
