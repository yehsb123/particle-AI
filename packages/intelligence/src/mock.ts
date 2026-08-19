import type {
  IntelligenceRequest,
  IntelligenceResult,
  ModelCapability,
  ProviderHealth,
} from "@dm/contracts";
import type { IntelligenceProvider } from "./provider";
import { deterministicDecision, type DecisionContext } from "./deterministic";

/**
 * Deterministic, always-available provider. Requires no credentials — the demo always runs.
 * For decision purposes it computes a validated RuntimeDecision from the request context.
 */
export class MockProvider implements IntelligenceProvider {
  readonly id = "mock";
  readonly capabilities: ModelCapability[] = [
    "fast.classification",
    "reason.general",
    "reason.deep",
    "structured_generation",
    "code",
  ];

  async evaluate(request: IntelligenceRequest): Promise<IntelligenceResult> {
    const ctx = request.context as Partial<DecisionContext> | undefined;
    if (ctx?.event && ctx.worldState && ctx.significance) {
      const decision = deterministicDecision(ctx as DecisionContext);
      return { providerId: this.id, modelId: "deterministic", data: decision, tier: "free", latencyMs: 0 };
    }
    return { providerId: this.id, modelId: "deterministic", text: "", tier: "free", latencyMs: 0 };
  }

  async health(): Promise<ProviderHealth> {
    return { id: this.id, healthy: true };
  }
}
