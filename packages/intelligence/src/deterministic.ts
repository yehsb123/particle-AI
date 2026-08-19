import type {
  MatterEvent,
  RuntimeDecision,
  SignificanceResult,
  WorldState,
} from "@dm/contracts";
import { RuntimeDecision as RuntimeDecisionSchema } from "@dm/contracts";

export type DecisionContext = {
  event: MatterEvent;
  worldState: WorldState;
  significance: SignificanceResult;
};

const PROBLEM_CLOSERS = new Set([
  "development.server_recovered",
  "development.build_succeeded",
  "development.test_passed",
]);

/**
 * The deterministic "brain": derive a validated RuntimeDecision from the post-event world
 * state. This is what makes the whole runtime work with no API key. Real providers produce
 * the same shape; the decision engine validates either way.
 */
export function deterministicDecision(ctx: DecisionContext): RuntimeDecision {
  const { event, worldState, significance } = ctx;
  const problems = worldState.activeProblems;
  const id = `dec-${event.id}`;

  let decision: RuntimeDecision;

  if (problems.length > 0) {
    const critical = problems.some((p) => p.severity === "critical");
    decision = {
      id,
      significance: significance.score,
      worldStateUpdates: [],
      intent: { label: "resolve_incident", confidence: 0.9 },
      recommendedMode: "incident",
      capabilityPlan: {
        capabilities: [
          { capabilityId: "development.read_logs" },
          { capabilityId: "development.read_build_state" },
          { capabilityId: "data.inspect" },
        ],
      },
      uiPlan: {
        intent: "surface_incident",
        targetMode: "incident",
        confidence: critical ? 0.92 : 0.85,
        reasonSummary:
          "An unresolved problem is active during development; surface an incident workspace beside the editor without discarding unsaved work.",
      },
      autonomyRequirement: { minLevel: 2, requiresApproval: false, risk: "read" },
      reasonSummary:
        "Problem detected in the current context; assembled read-only diagnostics and an incident view.",
    };
  } else if (PROBLEM_CLOSERS.has(event.type)) {
    decision = {
      id,
      significance: significance.score,
      worldStateUpdates: [],
      intent: { label: "return_to_normal", confidence: 0.88 },
      recommendedMode: "development",
      capabilityPlan: { capabilities: [] },
      uiPlan: {
        intent: "restore_normal",
        targetMode: "development",
        confidence: 0.88,
        reasonSummary: "The problem is resolved and stable; return to normal development mode.",
      },
      autonomyRequirement: { minLevel: 2, requiresApproval: false, risk: "read" },
      reasonSummary: "Stability observed; de-escalated the workspace back to development.",
    };
  } else {
    decision = {
      id,
      significance: significance.score,
      worldStateUpdates: [],
      recommendedMode: worldState.activeContext.activity ?? "development",
      capabilityPlan: { capabilities: [] },
      uiPlan: {
        intent: "none",
        targetMode: "development",
        confidence: significance.score,
        reasonSummary: "No structural change warranted for this event.",
      },
      autonomyRequirement: { minLevel: 2, requiresApproval: false, risk: "read" },
      reasonSummary: "Observed the event; no morph required.",
    };
  }

  // Validate our own output too — the decision engine trusts only validated decisions.
  return RuntimeDecisionSchema.parse(decision);
}
