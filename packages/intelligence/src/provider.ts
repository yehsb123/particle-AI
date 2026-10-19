import type {
  IntelligenceRequest,
  IntelligenceResult,
  ModelCapability,
  ProviderHealth,
} from "@particle/contracts";

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

/** The picture formats a provider is handed. Every one of them is something a model can read. */
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/**
 * A picture on its way to a model, already encoded.
 *
 * Base64 rather than bytes because that is what every provider's wire format takes, and doing it
 * once here means no adapter has to decide how a picture is spelled.
 */
export type ProviderImage = { mediaType: ImageMediaType; base64: string };

/**
 * A request with pictures attached.
 *
 * The abstraction is widened rather than replaced: this is the same `IntelligenceRequest` every
 * provider already takes, with the one thing it could not carry. A caller that has no picture
 * keeps using `evaluate` and nothing about it changes.
 */
export type VisionRequest = IntelligenceRequest & { images: readonly ProviderImage[] };

/**
 * A provider that can be handed a picture.
 *
 * Separate from `evaluate` on purpose. Half of the providers in this repository cannot read one,
 * and a single method taking optional images would let a caller hand a picture to a text-only
 * adapter that quietly drops it — which is the one failure a screen-reading path must not have.
 */
export interface VisionProvider extends IntelligenceProvider {
  evaluateVision(request: VisionRequest): Promise<IntelligenceResult>;
}

/**
 * Whether this provider can actually be handed a picture.
 *
 * Both halves are required. The capability list is a set of strings anything can write, so a
 * provider claiming vision without a method for it would throw at the call site; and a method
 * without the claim would never be routed one, since the router picks by capability.
 */
export function supportsVision(provider: IntelligenceProvider): provider is VisionProvider {
  return (
    supports(provider, "vision") &&
    typeof (provider as Partial<VisionProvider>).evaluateVision === "function"
  );
}
