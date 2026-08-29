import type {
  MatterEvent,
  RuntimeDecision,
  SignificanceResult,
  WorldState,
} from "@particle/contracts";
import { RuntimeDecision as RuntimeDecisionSchema } from "@particle/contracts";

export type DecisionContext = {
  event: MatterEvent;
  worldState: WorldState;
  significance: SignificanceResult;
};

const PROBLEM_CLOSERS = new Set([
  "development.server_recovered",
  "development.build_succeeded",
  "development.test_passed",
  "security.vulnerability_patched",
]);

/** Capability plans per problem kind — diagnostics are read-only; remediation is gated. */
function planFor(kind: string) {
  if (kind === "security_alert") {
    return [
      { capabilityId: "security.scan_dependencies" },
      { capabilityId: "workspace.get_state" },
      // remediation — external effect, gated behind human approval
      { capabilityId: "security.update_dependency", input: { pkg: "lodash", to: "4.17.21" } },
    ];
  }
  return [
    { capabilityId: "development.read_logs" },
    { capabilityId: "development.read_build_state" },
    { capabilityId: "data.inspect" },
    // remediation — external effect, gated behind human approval
    { capabilityId: "development.revert_diff", input: { target: "recent diff" } },
  ];
}

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
    const primary = problems.find((p) => p.severity === "critical") ?? problems[0]!;
    decision = {
      id,
      significance: significance.score,
      worldStateUpdates: [],
      intent: { label: "resolve_incident", confidence: 0.9 },
      recommendedMode: "incident",
      capabilityPlan: { capabilities: planFor(primary.kind) },
      uiPlan: {
        intent: "surface_incident",
        targetMode: "incident",
        confidence: critical ? 0.92 : 0.85,
        variant: primary.kind,
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
