import type { AccountLink, IntelligenceRequest, ModelRouteDecision, ModelTier } from "@particle/contracts";
import { AccountLink as AccountLinkSchema } from "@particle/contracts";
import type { IntelligenceProvider } from "./provider";
import { supports } from "./provider";
import { MockProvider } from "./mock";
import { AnthropicProvider } from "./anthropic";
import { OpenAIProvider, LocalModelProvider } from "./openai";
import { browserSessionsFromEnv } from "./session";

const TIER_BY_ID: Record<string, ModelTier> = {
  mock: "free",
  local: "local",
  openai: "standard",
  anthropic: "premium",
};

function tierOf(id: string): ModelTier {
  // own keys only: a provider id of "toString" would otherwise return a function as the tier,
  // and every rank comparison against it is false.
  // A `session:` id is not in the table and takes the default. A session the person already pays
  // for has no price tier of ours to name, and the rank is never read for one: it declares no
  // capabilities, so `route()` drops it before any comparison happens.
  return Object.hasOwn(TIER_BY_ID, id) ? (TIER_BY_ID[id] ?? "standard") : "standard";
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
    // The last resort has to be a brain that actually answers, so this looks for the real
    // MockProvider rather than anything calling itself "mock" — otherwise a caller passing an
    // unhealthy provider under that id would leave the router with no working fallback at all.
    this.providers = providers.some((p) => p instanceof MockProvider)
      ? providers
      : [...providers, new MockProvider()];
  }

  /** The always-healthy deterministic brain, guaranteed present by the constructor. */
  private get fallback(): IntelligenceProvider {
    return this.providers.find((p) => p instanceof MockProvider)!;
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
      chosen = this.fallback;
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

/**
 * The accounts a person can hand over as a key, in the order they are offered.
 *
 * One list, read twice: once to build the brains that can think, once to tell the person what is
 * linked. Two lists would drift, and the half that drifted would be the half saying "not linked"
 * about an account that is.
 */
const API_KEY_ACCOUNTS = [
  {
    providerId: "anthropic",
    /** the service the key reaches — never the person's identity on it */
    account: "api.anthropic.com",
    envVar: "ANTHROPIC_API_KEY",
    make: (apiKey: string): IntelligenceProvider => new AnthropicProvider({ apiKey }),
  },
  {
    providerId: "openai",
    account: "api.openai.com",
    envVar: "OPENAI_API_KEY",
    make: (apiKey: string): IntelligenceProvider => new OpenAIProvider({ apiKey }),
  },
] as const;

/**
 * Build providers from environment: real ones when configured, plus the mock fallback.
 *
 * A declared browser session is built here too, and it is built unusable on purpose — it has no
 * capabilities and reports itself unwell, so `route()` filters it out before health is even
 * asked. Nothing about the runtime loop changes by declaring one; what changes is that the
 * person can see it is there. See `session.ts` for why it cannot do more than that yet.
 */
export function buildDefaultProviders(env: NodeJS.ProcessEnv = process.env): IntelligenceProvider[] {
  const providers: IntelligenceProvider[] = [];
  for (const account of API_KEY_ACCOUNTS) {
    const apiKey = env[account.envVar];
    if (apiKey) providers.push(account.make(apiKey));
  }
  if (env.DM_LOCAL_MODEL_BASE_URL) providers.push(new LocalModelProvider({ baseUrl: env.DM_LOCAL_MODEL_BASE_URL }));
  providers.push(...browserSessionsFromEnv(env));
  providers.push(new MockProvider());
  return providers;
}

/**
 * Describe the person's linked AI accounts — which service, what kind of link, whether it is
 * alive — for a view they can read.
 *
 * It holds the line `describeProviders` holds: what comes back is built from a closed vocabulary
 * and validated by a strict schema, so no key, cookie or password can reach it, however the
 * environment is filled in. A key-based account is listed whether or not it is set up, because
 * "not linked" is the answer to "is my Anthropic account connected?"; a session is listed only
 * when declared, since there is no fixed list of sites a person might be signed into.
 */
export async function describeAccountLinks(env: NodeJS.ProcessEnv = process.env): Promise<AccountLink[]> {
  const links: AccountLink[] = [];

  for (const account of API_KEY_ACCOUNTS) {
    const apiKey = env[account.envVar];
    // the provider answers for its own health; with no key there is nothing to ask
    const healthy = apiKey ? (await account.make(apiKey).health()).healthy : false;
    links.push(
      AccountLinkSchema.parse({
        providerId: account.providerId,
        account: account.account,
        kind: "api_key",
        state: apiKey ? "linked" : "not_linked",
        healthy,
        reasonCode: apiKey ? "api_key_present" : "credential_absent",
      }),
    );
  }

  for (const session of browserSessionsFromEnv(env)) {
    links.push(
      AccountLinkSchema.parse({
        providerId: session.id,
        account: session.host,
        kind: "browser_session",
        // declared, and still not something this runtime can act on — see session.ts
        state: "not_operable",
        healthy: (await session.health()).healthy,
        reasonCode: "session_control_not_built",
      }),
    );
  }

  return links;
}
