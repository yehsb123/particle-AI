import type { CapabilityManifest, RiskLevel } from "@dm/contracts";
import type { Capability } from "./types";

/** The set of abilities available to the runtime, whatever their origin (native, MCP, …). */
export class CapabilityRegistry {
  private caps = new Map<string, Capability>();

  register(capability: Capability): void {
    this.caps.set(capability.manifest.id, capability);
  }

  registerAll(capabilities: Capability[]): void {
    for (const c of capabilities) this.register(c);
  }

  get(id: string): Capability | undefined {
    return this.caps.get(id);
  }

  has(id: string): boolean {
    return this.caps.has(id);
  }

  manifests(): CapabilityManifest[] {
    return [...this.caps.values()].map((c) => c.manifest);
  }

  /** Risk lookup used by the permission engine before execution. */
  riskOf(id: string): RiskLevel | undefined {
    return this.caps.get(id)?.manifest.risk;
  }
}
