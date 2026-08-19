import { z } from "zod";

export const ModelCapability = z.enum([
  "fast.classification",
  "reason.general",
  "reason.deep",
  "code",
  "vision",
  "structured_generation",
  "embedding",
]);
export type ModelCapability = z.infer<typeof ModelCapability>;

export const ModelTier = z.enum(["free", "local", "standard", "premium"]);
export type ModelTier = z.infer<typeof ModelTier>;

/** A request handed to an intelligence provider. Provider-agnostic. */
export const IntelligenceRequest = z.object({
  /** what this reasoning is for, e.g. "decide.runtime" — used for audit + routing */
  purpose: z.string().min(1),
  capability: ModelCapability,
  /** latency budget hint in ms (router may honor) */
  latencyTargetMs: z.number().optional(),
  /** whether privacy-sensitive (router may prefer local) */
  privacy: z.boolean().optional(),
  system: z.string().optional(),
  prompt: z.string().optional(),
  /** structured context the provider reasons over (event, worldState, significance, …) */
  context: z.record(z.unknown()).optional(),
  /** true when a validated structured object is expected back in `data` */
  structured: z.boolean().optional(),
});
export type IntelligenceRequest = z.infer<typeof IntelligenceRequest>;

export const TokenUsage = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
});
export type TokenUsage = z.infer<typeof TokenUsage>;

export const IntelligenceResult = z.object({
  providerId: z.string(),
  modelId: z.string().optional(),
  text: z.string().optional(),
  data: z.unknown().optional(),
  latencyMs: z.number().optional(),
  usage: TokenUsage.optional(),
  tier: ModelTier.optional(),
});
export type IntelligenceResult = z.infer<typeof IntelligenceResult>;

export const ProviderHealth = z.object({
  id: z.string(),
  healthy: z.boolean(),
  detail: z.string().optional(),
});
export type ProviderHealth = z.infer<typeof ProviderHealth>;

/** The router's audit-friendly record of which brain was chosen and why. */
export const ModelRouteDecision = z.object({
  providerId: z.string(),
  modelId: z.string().optional(),
  reasonCodes: z.array(z.string()),
  estimatedTier: ModelTier,
});
export type ModelRouteDecision = z.infer<typeof ModelRouteDecision>;
