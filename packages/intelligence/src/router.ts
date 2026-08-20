import type { IntelligenceRequest, ModelRouteDecision, ModelTier } from "@dm/contracts";
import type { IntelligenceProvider } from "./provider";
import { supports } from "./provider";
import { MockProvider } from "./mock";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider, LocalModelProvider } from "./openai";

const TIER_BY_ID: Record<string, ModelTier> = {
  mock: "free",
  local: "local",
  openai: "standard",
  anthropic: "premium",
};

function tierOf(id: string): ModelTier {
  return TIER_BY_ID[id] ?? "standard";
}

const TIER_RANK: Record<ModelTier, number> = { free: 0, local: 1, standard: 2, premium: 3 };

export type RouteResult = { provider: IntelligenceProvider; route: ModelRouteDecision };

/**
 * Chooses which brain thinks. Cheap/reflex work goes to the cheapest capable provider;
 * hard reasoning prefers the most capable. Privacy-sensitive requests prefer local. Always
 * falls back to the always-healthy mock so the runtime never stalls on a missing key.
 */
export class IntelligenceRouter {
  private readonly providers: IntelligenceProvider[];

  constructor(providers: IntelligenceProvider[]) {
    // Ensure a mock is always present as the final fallback.
    this.providers = providers.some((p) => p.id === "mock")
      ? providers
      : [...providers, new MockProvider()];
  }

  async route(request: IntelligenceRequest): Promise<RouteResult> {
    const reasonCodes: string[] = [`capability:${request.capability}`];

    const healthy: IntelligenceProvider[] = [];
    for (const p of this.providers) {
      if (!supports(p, request.capability)) continue;
      if ((await p.health()).healthy) healthy.push(p);
    }

    let chosen: IntelligenceProvider;
    if (healthy.length === 0) {
      chosen = this.providers.find((p) => p.id === "mock")!;
      reasonCodes.push("fallback_mock_no_healthy_provider");
    } else if (request.privacy) {
      chosen = pickByTier(healthy, "min_local_preferred");
      reasonCodes.push("privacy_prefers_local");
    } else if (request.capability === "fast.classification") {
      chosen = pickByTier(healthy, "cheapest");
      reasonCodes.push("reflex_prefers_cheap");
    } else {
      chosen = pickByTier(healthy, "most_capable");
      reasonCodes.push("deliberation_prefers_capable");
    }

    reasonCodes.push(`chose:${chosen.id}`);
    return {
      provider: chosen,
      route: {
        providerId: chosen.id,
        reasonCodes,
        estimatedTier: tierOf(chosen.id),
      },
    };
  }
}

function pickByTier(
  providers: IntelligenceProvider[],
  mode: "cheapest" | "most_capable" | "min_local_preferred",
): IntelligenceProvider {
  const sorted = [...providers].sort((a, b) => TIER_RANK[tierOf(a.id)] - TIER_RANK[tierOf(b.id)]);
  if (mode === "cheapest") return sorted[0]!;
  if (mode === "most_capable") return sorted[sorted.length - 1]!;
  // min_local_preferred: first provider at 'local' tier, else cheapest
  return sorted.find((p) => tierOf(p.id) === "local") ?? sorted[0]!;
}

/** Describe the configured providers (id, tier, health) — for observability / a /api/brain view. */
export async function describeProviders(
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ id: string; tier: ModelTier; healthy: boolean }[]> {
  const providers = buildDefaultProviders(env);
  return Promise.all(
    providers.map(async (p) => ({ id: p.id, tier: tierOf(p.id), healthy: (await p.health()).healthy })),
  );
}

/** Build providers from environment: real ones when configured, plus the mock fallback. */
export function buildDefaultProviders(env: NodeJS.ProcessEnv = process.env): IntelligenceProvider[] {
  const providers: IntelligenceProvider[] = [];
  if (env.ANTHROPIC_API_KEY) providers.push(new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY }));
  if (env.OPENAI_API_KEY) providers.push(new OpenAIProvider({ apiKey: env.OPENAI_API_KEY }));
  if (env.DM_LOCAL_MODEL_BASE_URL) providers.push(new LocalModelProvider({ baseUrl: env.DM_LOCAL_MODEL_BASE_URL }));
  providers.push(new MockProvider());
  return providers;
}
