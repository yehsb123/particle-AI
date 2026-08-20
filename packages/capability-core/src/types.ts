import type { CapabilityManifest, CapabilityResult, WorldState } from "@particle/contracts";

export type CapabilityContext = {
  sessionId: string;
  worldState?: WorldState;
  now: string;
};

/** A capability behaves like digital matter: a manifest plus an execute function. */
export interface Capability {
  readonly manifest: CapabilityManifest;
  execute(input: unknown, context: CapabilityContext): Promise<CapabilityResult>;
}
