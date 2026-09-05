import type {
  ModelRouteDecision,
  RuntimeDecision,
} from "@particle/contracts";
import { RuntimeDecision as RuntimeDecisionSchema, shapeOfEvent } from "@particle/contracts";
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

/**
 * Why the runtime fell back, in a form that is safe to show and the same every time. The
 * provider's own message goes nowhere near this: it carries our endpoint (host and port) and
 * the provider's response body, and these codes are read in the inspector, written to the audit
 * trail and broadcast to every connected client. A port number also made the code different on
 * every run, which is the opposite of what a reason code is for.
 */
export function fallbackReason(err: unknown): string {
  const e = err as { status?: unknown; name?: string; message?: string };
  if (typeof e?.status === "number") return `http_${e.status}`;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return "timeout";
  const message = typeof e?.message === "string" ? e.message : "";
  if (/no API key/i.test(message)) return "no_api_key";
  if (/no JSON value found/i.test(message)) return "unparseable_output";
  return "provider_error";
}

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
      // the event as shape, not as content: a payload carrying a hundred kilobytes was ninety
      // per cent of this prompt, and none of it was what the decision turns on
      context: { event: shapeOfEvent(ctx.event), worldState: ctx.worldState, significance: ctx.significance },
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
      route.reasonCodes.push(`fell_back_to_deterministic:${fallbackReason(err)}`);
    }

    return { decision, route, providerId: provider.id, usedFallback };
  }
}

export { deterministicDecision };
export type { DecisionContext };
