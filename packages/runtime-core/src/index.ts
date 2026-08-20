import type {
  AttentionState,
  AuditRecord,
  AutonomyLevel,
  MatterEvent,
  ModelRouteDecision,
  RuntimeDecision,
  SignificanceResult,
  UIBlueprint,
  UIPatch,
  WorldState,
} from "@particle/contracts";
import { emptyWorldState } from "@particle/contracts";
import { reduce } from "@particle/world-model";
import {
  evaluateSignificance,
  nextPresence,
  type PresenceState,
  type SignificanceConfig,
} from "@particle/significance-engine";
import { DecisionEngine } from "@particle/decision-engine";
import {
  CapabilityExecutor,
  CapabilityRegistry,
  type ExecutionOutcome,
} from "@particle/capability-core";
import { evaluatePlan, type PermissionEvaluation } from "@particle/permission-engine";
import {
  applyPatch,
  guardPatch,
  MorphHistory,
  DEFAULT_MORPH_POLICY,
  type MorphPolicy,
} from "@particle/morph-engine";
import { developmentBlueprint, planMorph } from "@particle/ui-registry";
import { MemorySystem, type PatternCandidate } from "@particle/memory";

export type RuntimeClock = { iso: () => string; ms: () => number };

export type RuntimeCoreDeps = {
  decisionEngine: DecisionEngine;
  registry: CapabilityRegistry;
  clock: RuntimeClock;
  policy?: MorphPolicy;
  significanceConfig?: SignificanceConfig;
  autonomyLevel?: AutonomyLevel;
};

export type MorphOutcome = {
  applied: boolean;
  patch?: UIPatch;
  guardReasonCodes: string[];
  dropped: string[];
};

export type IngestResult = {
  sessionId: string;
  worldState: WorldState;
  significance: SignificanceResult;
  deliberated: boolean;
  decision?: RuntimeDecision;
  route?: ModelRouteDecision;
  providerId?: string;
  usedFallback?: boolean;
  permission?: PermissionEvaluation;
  capabilityRuns: ExecutionOutcome[];
  morph: MorphOutcome;
  blueprint: UIBlueprint;
  presence: PresenceState;
  audit: AuditRecord[];
  /** reusable-template suggestions surfaced by pattern detection this step (§20) */
  patternSuggestions: PatternCandidate[];
};

type SessionState = {
  world: WorldState;
  blueprint: UIBlueprint;
  history: MorphHistory;
  lastMorphAt?: number;
  lastMajorMorphAt?: number;
  presence: PresenceState;
};

/**
 * The canonical runtime loop, shared by the server and the web app:
 * perception → world → significance → (deliberate) decision → permission → capability →
 * morphology → guard → apply → audit. Deterministic given a fixed clock and the mock brain.
 */
export class RuntimeCore {
  private sessions = new Map<string, SessionState>();
  private executor: CapabilityExecutor;
  private autonomyLevel: AutonomyLevel;
  readonly memory = new MemorySystem();

  constructor(private readonly deps: RuntimeCoreDeps) {
    this.executor = new CapabilityExecutor(deps.registry, deps.clock.iso);
    this.autonomyLevel = deps.autonomyLevel ?? 2;
  }

  private session(sessionId: string): SessionState {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = {
        world: emptyWorldState(sessionId, this.deps.clock.iso()),
        blueprint: developmentBlueprint(this.deps.clock.iso()),
        history: new MorphHistory(),
        presence: "observing",
      };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  getWorld(sessionId: string): WorldState {
    return this.session(sessionId).world;
  }
  getBlueprint(sessionId: string): UIBlueprint {
    return this.session(sessionId).blueprint;
  }
  canUndo(sessionId: string): boolean {
    return this.session(sessionId).history.canUndo;
  }

  async ingest(event: MatterEvent, attention: AttentionState = { typing: false }): Promise<IngestResult> {
    const s = this.session(event.sessionId);
    const audit: AuditRecord[] = [];

    // Reflex significance is judged against the world BEFORE the event is folded in — that is
    // what tells us the event matters (e.g. a recovery closes a problem that is still open here).
    const significance = evaluateSignificance(event, s.world, this.deps.significanceConfig);

    // Perception → world
    s.world = reduce(s.world, event);
    s.presence = nextPresence(s.presence, significance);

    const base: IngestResult = {
      sessionId: event.sessionId,
      worldState: s.world,
      significance,
      deliberated: false,
      capabilityRuns: [],
      morph: { applied: false, guardReasonCodes: [], dropped: [] },
      blueprint: s.blueprint,
      presence: s.presence,
      audit,
      patternSuggestions: [],
    };

    if (!significance.shouldDeliberate) {
      return base;
    }

    // Deliberation → structured decision
    const { decision, route, providerId, usedFallback } = await this.deps.decisionEngine.evaluate({
      event,
      worldState: s.world,
      significance,
    });
    audit.push(this.record(event.sessionId, "decision", { id: decision.id, reasonSummary: decision.reasonSummary, providerId, usedFallback }));

    // Permission → capability execution (only authorized, read-only in MVP)
    const items = decision.capabilityPlan.capabilities.map((c) => ({
      capabilityId: c.capabilityId,
      risk: this.deps.registry.riskOf(c.capabilityId) ?? ("external_effect" as const),
    }));
    const permission = evaluatePlan(items, this.autonomyLevel);
    const capabilityRuns = await this.executor.executeMany(
      permission.authorized.map((i) => ({ capabilityId: i.capabilityId })),
      { sessionId: event.sessionId, worldState: s.world, now: this.deps.clock.iso() },
    );
    if (permission.needsApproval.length) {
      audit.push(this.record(event.sessionId, "approval_required", { capabilities: permission.needsApproval.map((i) => i.capabilityId) }));
    }

    // Morphology → guard → apply
    const intent = decision.uiPlan?.intent ?? "none";
    const desired = planMorph(s.blueprint, intent, decision.id);
    const morph: MorphOutcome = { applied: false, guardReasonCodes: [], dropped: [] };
    let patternSuggestions: PatternCandidate[] = [];

    if (desired) {
      const deEscalation = intent === "restore_normal";
      // De-escalations (reducing the UI back to normal) are not rate-limited — neither by the
      // major-change dwell time nor by the cooldown — since they reduce, not add, complexity.
      const policy = deEscalation
        ? { ...(this.deps.policy ?? DEFAULT_MORPH_POLICY), majorDwellMs: 0, cooldownMs: 0 }
        : this.deps.policy ?? DEFAULT_MORPH_POLICY;
      const guard = guardPatch({
        currentUI: s.blueprint,
        desiredPatch: desired,
        attention,
        confidence: decision.uiPlan?.confidence ?? significance.score,
        severity: event.severity,
        now: this.deps.clock.ms(),
        lastMorphAt: s.lastMorphAt,
        lastMajorMorphAt: s.lastMajorMorphAt,
        policy,
      });
      morph.guardReasonCodes = guard.reasonCodes;
      morph.dropped = guard.dropped.map((d) => `${d.op.op}:${d.reason}`);

      if (guard.allowed) {
        const { next, inverse } = applyPatch(s.blueprint, guard.patch, this.deps.clock.iso());
        s.history.push(inverse);
        s.blueprint = next;
        const t = this.deps.clock.ms();
        s.lastMorphAt = t;
        if (!deEscalation) s.lastMajorMorphAt = t;
        morph.applied = true;
        morph.patch = guard.patch;
        s.presence = "acting";
        audit.push(this.record(event.sessionId, "ui_morph", { intent, patchId: guard.patch.patchId }));

        // Experience: remember this situation, reinforce the preference, and detect patterns.
        const iso = this.deps.clock.iso();
        this.memory.episodic.record({
          id: decision.id,
          at: iso,
          context: `${decision.recommendedMode ?? "development"}.${intent}`,
          summary: decision.reasonSummary,
          eventTypes: [event.type],
        });
        this.memory.preferences.reinforce(`morph:${intent}`);
        this.memory.patterns.observe(`${event.type}->${intent}`, iso);
        patternSuggestions = this.memory.patterns.takeSuggestions();
      } else {
        audit.push(this.record(event.sessionId, "morph_blocked", { intent, reasonCodes: guard.reasonCodes }));
      }
    }

    return {
      ...base,
      worldState: s.world,
      deliberated: true,
      decision,
      route,
      providerId,
      usedFallback,
      permission,
      capabilityRuns,
      morph,
      blueprint: s.blueprint,
      presence: s.presence,
      patternSuggestions,
    };
  }

  undo(sessionId: string): UIBlueprint | null {
    const s = this.session(sessionId);
    const inverse = s.history.pop();
    if (!inverse) return null;
    const { next } = applyPatch(s.blueprint, inverse, this.deps.clock.iso());
    s.blueprint = next;
    s.lastMorphAt = this.deps.clock.ms();
    return s.blueprint;
  }

  private seq = 0;
  private record(sessionId: string, kind: string, detail: Record<string, unknown>): AuditRecord {
    return { id: `aud-${++this.seq}`, at: this.deps.clock.iso(), sessionId, kind, detail };
  }
}

export * from "./factory";
export * from "./replay";
