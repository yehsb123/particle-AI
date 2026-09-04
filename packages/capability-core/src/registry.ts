import type { CapabilityManifest, RiskLevel } from "@particle/contracts";
import type { Capability } from "./types";

/** The set of abilities available to the runtime, whatever their origin (native, MCP, …). */
export class CapabilityRegistry {
  private caps = new Map<string, Capability>();

  /**
   * Claim an id for a capability. A second claim on the same id is refused rather than allowed
   * to replace the first: an id is what a decision plans and what an approval answers for, so
   * swapping what it means — and what risk it carries — would change what a person consented to.
   * Discovered tools are the reason this matters; a server can offer the same name twice.
   */
  register(capability: Capability): boolean {
    if (this.caps.has(capability.manifest.id)) return false;
    this.caps.set(capability.manifest.id, capability);
    return true;
  }

  /** Register each, returning the ids that were refused because something already held them. */
  registerAll(capabilities: Capability[]): string[] {
    const refused: string[] = [];
    for (const c of capabilities) if (!this.register(c)) refused.push(c.manifest.id);
    return refused;
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
