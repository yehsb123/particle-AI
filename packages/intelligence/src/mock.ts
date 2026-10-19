import type {
  IntelligenceRequest,
  IntelligenceResult,
  ModelCapability,
  ProviderHealth,
} from "@particle/contracts";
import { ScreenReading } from "@particle/contracts";
import type { VisionProvider, VisionRequest } from "./provider";
import { deterministicDecision, type DecisionContext } from "./deterministic";
import { SCREEN_READING_PURPOSE } from "./screen";

/**
 * What the deterministic brain says about a picture: that it cannot say.
 *
 * It is a reading and it is honest, which are the two things it has to be. The runtime gets the
 * same shape it gets from a real model, so the whole screen-reading path runs with no key and no
 * network; and nothing in it is invented, because nothing here looked at a pixel. Saying
 * `unclear` at no confidence is the only answer a brain that does not see can give.
 */
function readingWithoutLooking(context: Record<string, unknown> | undefined): unknown {
  const named = [context?.app, context?.window].filter((part) => typeof part === "string" && part.trim()).join(" · ");
  const unread = "photographed, not read: the deterministic brain looks at no pixels";
  return {
    activity: "unclear",
    summary: named ? `${named}: ${unread}` : unread,
    topics: [],
    needsAttention: false,
    confidence: 0,
  };
}

/**
 * Deterministic, always-available provider. Requires no credentials — the demo always runs.
 * For decision purposes it computes a validated RuntimeDecision from the request context.
 */
export class MockProvider implements VisionProvider {
  readonly id = "mock";
  readonly capabilities: ModelCapability[] = [
    "fast.classification",
    "reason.general",
    "reason.deep",
    "structured_generation",
    "code",
    // it can be handed a picture — see `evaluateVision` for how little it does with one. Without
    // this the router would find no vision provider at all when nobody configured a key, and the
    // screen layer would have no path to run on the machine it was turned on.
    "vision",
  ];

  async evaluate(request: IntelligenceRequest): Promise<IntelligenceResult> {
    const ctx = request.context as Partial<DecisionContext> | undefined;
    if (ctx?.event && ctx.worldState && ctx.significance) {
      const decision = deterministicDecision(ctx as DecisionContext);
      return { providerId: this.id, modelId: "deterministic", data: decision, tier: "free", latencyMs: 0 };
    }
    return { providerId: this.id, modelId: "deterministic", text: "", tier: "free", latencyMs: 0 };
  }

  /**
   * A picture, read without reading it.
   *
   * The empty request is refused rather than answered: a caller that asked a brain to look at
   * nothing has a bug, and a reading handed back for no picture would be a fact about a window
   * nobody photographed. A vision request for something other than a screen reading gets the
   * same empty answer `evaluate` gives, rather than a reading of a question nobody asked.
   */
  async evaluateVision(request: VisionRequest): Promise<IntelligenceResult> {
    if (request.images.length === 0) {
      throw new Error("MockProvider: a vision request with no picture in it");
    }
    const data =
      request.purpose === SCREEN_READING_PURPOSE ? ScreenReading.parse(readingWithoutLooking(request.context)) : undefined;
    return {
      providerId: this.id,
      modelId: "deterministic",
      ...(data === undefined ? { text: "" } : { data }),
      tier: "free",
      latencyMs: 0,
    };
  }

  async health(): Promise<ProviderHealth> {
    return { id: this.id, healthy: true };
  }
}
