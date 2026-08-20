import { DecisionEngine } from "@particle/decision-engine";
import {
  IntelligenceRouter,
  MockProvider,
  buildDefaultProviders,
  type IntelligenceProvider,
} from "@particle/intelligence";
import { CapabilityRegistry, builtinCapabilities } from "@particle/capability-core";
import { RuntimeCore, type RuntimeClock } from "./index";

/**
 * Build a fully-wired RuntimeCore with the deterministic mock brain and the built-in
 * capabilities. This is what the web demo and tests use — no API key required. Pass extra
 * providers (real or MCP-backed) to upgrade the brain without touching the core.
 */
export function createRuntimeCore(clock: RuntimeClock, extraProviders: IntelligenceProvider[] = []): RuntimeCore {
  const registry = new CapabilityRegistry();
  registry.registerAll(builtinCapabilities());
  const router = new IntelligenceRouter([...extraProviders, new MockProvider()]);
  const decisionEngine = new DecisionEngine(router);
  return new RuntimeCore({ decisionEngine, registry, clock });
}

/**
 * Like `createRuntimeCore`, but builds the provider fleet from environment variables
 * (`buildDefaultProviders`): a real Anthropic/OpenAI/local provider is used when its key is
 * configured, always falling back to the deterministic mock. The server uses this so a real
 * brain can be enabled with zero code changes.
 */
export function createRuntimeCoreFromEnv(clock: RuntimeClock, env: NodeJS.ProcessEnv = process.env): RuntimeCore {
  const registry = new CapabilityRegistry();
  registry.registerAll(builtinCapabilities());
  const router = new IntelligenceRouter(buildDefaultProviders(env));
  const decisionEngine = new DecisionEngine(router);
  return new RuntimeCore({ decisionEngine, registry, clock });
}
