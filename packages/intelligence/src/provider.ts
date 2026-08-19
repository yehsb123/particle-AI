import type {
  IntelligenceRequest,
  IntelligenceResult,
  ModelCapability,
  ProviderHealth,
} from "@dm/contracts";

/**
 * The provider abstraction. The decision engine depends ONLY on this interface — never on a
 * concrete SDK. Swapping Anthropic ↔ OpenAI ↔ local ↔ mock must not touch the core.
 */
export interface IntelligenceProvider {
  readonly id: string;
  readonly capabilities: ModelCapability[];
  evaluate(request: IntelligenceRequest): Promise<IntelligenceResult>;
  health(): Promise<ProviderHealth>;
}

export function supports(provider: IntelligenceProvider, capability: ModelCapability): boolean {
  return provider.capabilities.includes(capability);
}
