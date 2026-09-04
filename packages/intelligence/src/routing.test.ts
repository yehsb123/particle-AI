import { describe, it, expect } from "vitest";
import type { ModelCapability, IntelligenceRequest } from "@particle/contracts";
import type { IntelligenceProvider } from "./provider";
import { IntelligenceRouter, MockProvider, describeProviders, buildDefaultProviders } from "./index";

/**
 * The router decides which brain thinks, and the one rule it cannot break is that something
 * always answers: a missing key, an unreachable host or a provider that does not do this kind of
 * work must all end at the deterministic mock rather than at a stall. Cost is the second rule —
 * reflex work goes to the cheapest brain that can do it, deliberation to the most capable.
 */
const ALL: ModelCapability[] = ["fast.classification", "reason.general", "reason.deep", "structured_generation", "code"];

const fake = (id: string, capabilities: ModelCapability[] = ALL, healthy = true): IntelligenceProvider => ({
  id,
  capabilities,
  async evaluate() {
    return { data: {}, providerId: id };
  },
  async health() {
    return { id, healthy };
  },
});

const req = (over: Partial<IntelligenceRequest> = {}): IntelligenceRequest => ({
  purpose: "decide.runtime",
  capability: "reason.deep",
  prompt: "x",
  ...over,
});

const route = async (providers: IntelligenceProvider[], request = req()) => (await new IntelligenceRouter(providers).route(request)).route;

describe("something always answers", () => {
  it("adds the deterministic brain when the caller passed none", async () => {
    const r = await route([]);
    expect(r.providerId).toBe("mock");
    expect(r.estimatedTier).toBe("free");
  });

  it("falls back when every configured provider is unwell", async () => {
    const r = await route([fake("anthropic", ALL, false), fake("openai", ALL, false)]);
    expect(r.providerId).toBe("mock");
  });

  it("falls back when no provider does this kind of work", async () => {
    const r = await route([fake("anthropic", ["code"])], req({ capability: "reason.deep" }));
    expect(r.providerId).toBe("mock");
  });

  it("says so when it had to fall back with nothing healthy at all", async () => {
    const r = await route([fake("anthropic", ALL, false)], req({ capability: "nonsense" as ModelCapability }));
    expect(r.reasonCodes).toContain("fallback_mock_no_healthy_provider");
    expect(r.providerId).toBe("mock");
  });

  it("does not mistake a provider merely named mock for the brain of last resort", async () => {
    // an unhealthy impostor under that id used to leave the router with no working fallback
    const r = await route([fake("mock", ALL, false)]);
    expect(r.providerId).toBe("mock");
    const chosen = await new IntelligenceRouter([fake("mock", ALL, false)]).route(req());
    expect((await chosen.provider.health()).healthy).toBe(true);
    expect(chosen.provider).toBeInstanceOf(MockProvider);
  });

  it("keeps a real mock the caller passed rather than adding a second one", async () => {
    const mine = new MockProvider();
    const result = await new IntelligenceRouter([mine]).route(req());
    expect(result.provider).toBe(mine);
  });
});

describe("which brain, and why", () => {
  it("sends deliberation to the most capable healthy provider", async () => {
    const r = await route([fake("anthropic"), fake("openai")]);
    expect(r.providerId).toBe("anthropic"); // premium over standard
    expect(r.estimatedTier).toBe("premium");
    expect(r.reasonCodes).toContain("deliberation_prefers_capable");
  });

  it("sends reflex work to the cheapest that can do it", async () => {
    const r = await route([fake("anthropic"), fake("openai")], req({ capability: "fast.classification" }));
    expect(r.providerId).toBe("mock"); // free beats standard and premium
    expect(r.reasonCodes).toContain("reflex_prefers_cheap");
  });

  it("prefers a local brain when the request is private", async () => {
    const r = await route([fake("anthropic"), fake("local")], req({ privacy: true }));
    expect(r.providerId).toBe("local");
    expect(r.reasonCodes).toContain("privacy_prefers_local");
  });

  it("takes the cheapest when privacy is asked for and nothing local is configured", async () => {
    const r = await route([fake("anthropic")], req({ privacy: true }));
    expect(r.providerId).toBe("mock");
    expect(r.reasonCodes).toContain("privacy_prefers_local");
  });

  it("skips an unwell provider in favour of a healthy, less capable one", async () => {
    const r = await route([fake("anthropic", ALL, false), fake("openai", ALL, true)]);
    expect(r.providerId).toBe("openai");
  });

  it("records the capability asked for, and the provider it landed on", async () => {
    const r = await route([fake("anthropic")]);
    expect(r.reasonCodes[0]).toBe("capability:reason.deep");
    expect(r.reasonCodes.at(-1)).toBe("chose:anthropic");
  });

  it("treats a provider it has never heard of as middle of the road", async () => {
    const r = await route([fake("some-new-provider")]);
    expect(r.providerId).toBe("some-new-provider");
    expect(r.estimatedTier).toBe("standard");
  });
});

describe("what is configured", () => {
  it("describes only the mock when nothing is set up", async () => {
    expect(await describeProviders({})).toEqual([{ id: "mock", tier: "free", healthy: true }]);
  });

  it("describes each configured brain with its tier and whether it is usable", async () => {
    const described = await describeProviders({ ANTHROPIC_API_KEY: "k", DM_LOCAL_MODEL_BASE_URL: "http://127.0.0.1:1234/v1" });
    expect(described.map((p) => p.id)).toEqual(["anthropic", "local", "mock"]);
    expect(described.map((p) => p.tier)).toEqual(["premium", "local", "free"]);
    expect(described.every((p) => p.healthy)).toBe(true);
  });

  it("never reports a key, only whether one is there", async () => {
    const described = await describeProviders({ ANTHROPIC_API_KEY: "sk-secret-value" });
    expect(JSON.stringify(described)).not.toContain("sk-secret");
    expect(described[0]).toEqual({ id: "anthropic", tier: "premium", healthy: true });
  });

  it("builds the mock alone from an empty environment", () => {
    expect(buildDefaultProviders({}).map((p) => p.id)).toEqual(["mock"]);
  });
});

describe("the deterministic brain", () => {
  it("is always well", async () => {
    expect(await new MockProvider().health()).toEqual({ id: "mock", healthy: true });
  });

  it("gives the same answer to the same question", async () => {
    const m = new MockProvider();
    const request = req({ context: { event: { id: "e1", type: "development.server_error" } } });
    expect(JSON.stringify(await m.evaluate(request))).toBe(JSON.stringify(await m.evaluate(request)));
  });

  it("answers every kind of work the runtime asks for", () => {
    const m = new MockProvider();
    for (const capability of ["fast.classification", "reason.deep", "structured_generation"] as ModelCapability[]) {
      expect(m.capabilities, capability).toContain(capability);
    }
  });
});
