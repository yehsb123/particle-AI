import { DecisionEngine } from "@dm/decision-engine";
import { IntelligenceRouter, MockProvider, type IntelligenceProvider } from "@dm/intelligence";
import { CapabilityRegistry, builtinCapabilities } from "@dm/capability-core";
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
