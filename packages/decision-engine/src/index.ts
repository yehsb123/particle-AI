import type {
  ModelRouteDecision,
  RuntimeDecision,
} from "@particle/contracts";
import { RuntimeDecision as RuntimeDecisionSchema } from "@particle/contracts";
import {
  IntelligenceRouter,
  deterministicDecision,
  type DecisionContext,
} from "@particle/intelligence";

const DECISION_SYSTEM =
  "You are the decision engine of an adaptive computing runtime. Given an event, the current " +
  "world state, and a significance result, output ONLY a JSON object matching the RuntimeDecision " +
  "schema (id, significance, capabilityPlan, uiPlan{intent,targetMode,confidence,reasonSummary}, " +
  "autonomyRequirement{minLevel,requiresApproval,risk}, reasonSummary). uiPlan.intent is one of " +
  "surface_incident|restore_normal|augment|none. reasonSummary must be concise and externally safe " +
  "(never chain-of-thought). Do not include any prose outside the JSON.";

export type DecisionOutput = {
  decision: RuntimeDecision;
  route: ModelRouteDecision;
  providerId: string;
  usedFallback: boolean;
};

/**
 * Orchestrates a structured decision: route → provider.evaluate → validate. Any provider
 * output that fails schema validation is discarded in favour of the deterministic decision,
 * so an unreliable model can never corrupt the runtime.
 */
export class DecisionEngine {
  constructor(private readonly router: IntelligenceRouter) {}

  async evaluate(ctx: DecisionContext): Promise<DecisionOutput> {
    const request = {
      purpose: "decide.runtime",
      capability: "reason.deep" as const,
      structured: true,
      system: DECISION_SYSTEM,
      prompt: "Decide how the runtime should respond to the current event.",
      context: { event: ctx.event, worldState: ctx.worldState, significance: ctx.significance },
    };

    const { provider, route } = await this.router.route(request);

    let decision: RuntimeDecision;
    let usedFallback = false;
    try {
      const result = await provider.evaluate(request);
      const parsed = RuntimeDecisionSchema.safeParse(result.data);
      if (parsed.success) {
        decision = parsed.data;
      } else {
        decision = deterministicDecision(ctx);
        usedFallback = true;
        route.reasonCodes.push("fell_back_to_deterministic:invalid_output");
      }
    } catch (err) {
      decision = deterministicDecision(ctx);
      usedFallback = true;
      route.reasonCodes.push(`fell_back_to_deterministic:${(err as Error).message.slice(0, 40)}`);
    }

    return { decision, route, providerId: provider.id, usedFallback };
  }
}

export { deterministicDecision };
export type { DecisionContext };
