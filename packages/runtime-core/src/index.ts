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
import { evaluatePlan, ApprovalStore, type PermissionEvaluation } from "@particle/permission-engine";
import {
  applyPatch,
  guardPatch,
  MorphHistory,
  DEFAULT_MORPH_POLICY,
  type MorphPolicy,
} from "@particle/morph-engine";
import { developmentBlueprint, planMorph } from "@particle/ui-registry";
import { MemorySystem, type PatternCandidate } from "@particle/memory";
import { inferIntent, intentChanged } from "@particle/intent-engine";
import type { ApprovalRequest } from "@particle/contracts";

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
  /** approval requests created this step for risky capabilities awaiting a human decision */
  pendingApprovals: ApprovalRequest[];
  /** set when a morph was withheld because the person kept dismissing that kind (Concept v2 P4) */
  learned?: { suppressed: string; dismissals: number };
};

/** Undos of the same augmentation variant after which the runtime stops offering it (per session). */
export const DISMISS_THRESHOLD = 2;

type SessionState = {
  world: WorldState;
  blueprint: UIBlueprint;
  history: MorphHistory;
  /** what each entry in `history` undid (parallel stack) — lets undo teach a preference */
  morphMeta: { intent: string; variant?: string }[];
  lastMorphAt?: number;
  lastMajorMorphAt?: number;
  presence: PresenceState;
  memory: MemorySystem;
  /** serializes ingest per session so concurrent events don't interleave shared state */
  queue: Promise<unknown>;
};

/**
 * Resolve data bindings in a desired patch against capability outputs (spec §5).
 * Source format: `capability:<capabilityId>:<field>` — when the capability ran and the field
 * exists on its output, the bound prop is overwritten with live data. Pure (clones the patch).
 */
export function resolvePatchBindings(patch: UIPatch, lookup: Map<string, unknown>): UIPatch {
  const next: UIPatch = structuredClone(patch);
  const resolveNode = (node: { bindings?: { prop: string; source: string }[]; props?: Record<string, unknown>; children?: unknown[] }) => {
    for (const b of node.bindings ?? []) {
      const m = /^capability:([^:]+):(.+)$/.exec(b.source);
      if (!m) continue;
      const output = lookup.get(m[1]!) as Record<string, unknown> | undefined;
      const value = output?.[m[2]!];
      if (value !== undefined) {
        node.props = { ...(node.props ?? {}), [b.prop]: value };
      }
    }
    for (const c of (node.children ?? []) as typeof node[]) resolveNode(c);
  };
  for (const op of next.operations) {
    if (op.op === "add" || op.op === "replace") resolveNode(op.component);
  }
  return next;
}

/**
 * The canonical runtime loop, shared by the server and the web app:
 * perception → world → significance → (deliberate) decision → permission → capability →
 * morphology → guard → apply → audit. Deterministic given a fixed clock and the mock brain.
 */
export class RuntimeCore {
  private sessions = new Map<string, SessionState>();
  private executor: CapabilityExecutor;
  private autonomyLevel: AutonomyLevel;
  readonly approvals = new ApprovalStore();
  /** pending capability executions awaiting approval, keyed by approval id */
  private pendingExecutions = new Map<string, { capabilityId: string; input?: unknown; sessionId: string }>();

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
        morphMeta: [],
        presence: "observing",
        memory: new MemorySystem(),
        queue: Promise.resolve(),
      };
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /** Per-session experience (working/episodic/preference/pattern). */
  memoryFor(sessionId: string): MemorySystem {
    return this.session(sessionId).memory;
  }

  getAutonomyLevel(): AutonomyLevel {
    return this.autonomyLevel;
  }
  /** Change the autonomy level — governs which capability risks auto-run vs need approval. */
  setAutonomyLevel(level: AutonomyLevel): void {
    this.autonomyLevel = level;
  }

  getWorld(sessionId: string): WorldState {
    return this.session(sessionId).world;
  }
  getBlueprint(sessionId: string): UIBlueprint {
    return this.session(sessionId).blueprint;
  }

  /** Restore a session's belief state and body from persisted snapshots (resume). */
  hydrate(sessionId: string, state: { world?: WorldState; blueprint?: UIBlueprint }): void {
    const s = this.session(sessionId);
    if (state.world) s.world = state.world;
    if (state.blueprint) s.blueprint = state.blueprint;
  }
  canUndo(sessionId: string): boolean {
    return this.session(sessionId).history.canUndo;
  }

  /** Public entry: serialize ingests per session so concurrent events cannot interleave. */
  ingest(event: MatterEvent, attention: AttentionState = { typing: false }): Promise<IngestResult> {
    const s = this.session(event.sessionId);
    const run = s.queue.then(() => this.runIngest(event, attention));
    // keep the chain alive even if a run rejects, so later ingests still serialize
    s.queue = run.catch(() => undefined);
    return run;
  }

  private async runIngest(event: MatterEvent, attention: AttentionState): Promise<IngestResult> {
    const s = this.session(event.sessionId);
    const audit: AuditRecord[] = [];

    // Reflex significance is judged against the world BEFORE the event is folded in — that is
    // what tells us the event matters (e.g. a recovery closes a problem that is still open here).
    let significance = evaluateSignificance(event, s.world, this.deps.significanceConfig);

    // Perception → world → continuous intent (Concept v2: always present, no error needed)
    const prevIntent = s.world.inferredIntent;
    s.world = reduce(s.world, event);
    const nextIntent = inferIntent(s.world);
    s.world = { ...s.world, inferredIntent: nextIntent };
    // Some intents can only be seen AFTER the event is folded in (e.g. the 6th alternation that
    // makes "switching"). An intent transition is itself significant — deliberate on it.
    if (!significance.shouldDeliberate && intentChanged(prevIntent, nextIntent) && nextIntent.label === "switching") {
      significance = { ...significance, shouldDeliberate: true, reasonCodes: [...significance.reasonCodes.filter((c) => c !== "reflex_only"), "intent_transition", "deliberate"] };
    }
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
      pendingApprovals: [],
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
    const inputById = new Map(decision.capabilityPlan.capabilities.map((c) => [c.capabilityId, c.input]));
    const permission = evaluatePlan(items, this.autonomyLevel);
    const capabilityRuns = await this.executor.executeMany(
      permission.authorized.map((i) => ({ capabilityId: i.capabilityId, input: inputById.get(i.capabilityId) })),
      { sessionId: event.sessionId, worldState: s.world, now: this.deps.clock.iso() },
    );

    // Risky capabilities do not auto-run — create an approval request a human must decide on.
    const pendingApprovals: ApprovalRequest[] = [];
    for (const item of permission.needsApproval) {
      const id = `appr-${event.sessionId}-${decision.id}-${item.capabilityId}`;
      if (this.approvals.get(id)) continue;
      const req = this.approvals.create({
        id,
        capabilityId: item.capabilityId,
        risk: item.risk,
        reason: `${item.risk} capability requires approval at autonomy level ${this.autonomyLevel}`,
        createdAt: this.deps.clock.iso(),
      });
      this.pendingExecutions.set(id, { capabilityId: item.capabilityId, input: inputById.get(item.capabilityId), sessionId: event.sessionId });
      pendingApprovals.push(req);
      audit.push(this.record(event.sessionId, "approval_required", { approvalId: id, capabilityId: item.capabilityId, risk: item.risk }));
    }

    // Morphology → guard → apply
    const intent = decision.uiPlan?.intent ?? "none";
    // Experience shapes the body: if episodic memory has seen this situation before, the
    // incident surfaces WITH that knowledge (a "recurring ×N" badge). Episodes are recorded
    // after a morph applies, so past occurrences + this one = recurrence.
    const morphContext = `${decision.recommendedMode ?? "development"}.${intent}`;
    const recurrence =
      intent === "surface_incident" ? s.memory.episodic.search(morphContext).length + 1 : 0;

    const morph: MorphOutcome = { applied: false, guardReasonCodes: [], dropped: [] };
    let learned: IngestResult["learned"];

    // Learning (Concept v2 P4): a person who keeps dismissing a kind of augmentation has told
    // us something. After DISMISS_THRESHOLD undos of the same variant, the runtime stops
    // offering it in this session — the body adapts to the person, not only to the situation.
    const prefKey = `dismissed:${intent}:${decision.uiPlan?.variant ?? ""}`;
    const dismissals = s.memory.preferences.weightOf(prefKey);
    const learnedSuppress = intent === "augment" && dismissals >= DISMISS_THRESHOLD;
    if (learnedSuppress) {
      learned = { suppressed: `${intent}:${decision.uiPlan?.variant ?? ""}`, dismissals };
      morph.guardReasonCodes.push("learned_preference");
      audit.push(this.record(event.sessionId, "morph_suppressed", { intent, variant: decision.uiPlan?.variant, dismissals, reason: "learned_preference" }));
    }

    let desired = learnedSuppress ? null : planMorph(s.blueprint, intent, decision.id, decision.uiPlan?.variant, recurrence);
    // Feedback into the body: capability outputs resolve declared data bindings (spec §5),
    // so the morphed workspace shows LIVE diagnostics, not placeholder content.
    if (desired) {
      const lookup = new Map(capabilityRuns.filter((r) => r.result.ok).map((r) => [r.capabilityId, r.result.output]));
      desired = resolvePatchBindings(desired, lookup);
    }
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
        s.morphMeta.push({ intent, variant: decision.uiPlan?.variant });
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
        s.memory.episodic.record({
          id: decision.id,
          at: iso,
          context: `${decision.recommendedMode ?? "development"}.${intent}`,
          summary: decision.reasonSummary,
          eventTypes: [event.type],
        });
        s.memory.preferences.reinforce(`morph:${intent}`);
        s.memory.patterns.observe(`${event.type}->${intent}`, iso);
        patternSuggestions = s.memory.patterns.takeSuggestions();
      } else {
        audit.push(this.record(event.sessionId, "morph_blocked", { intent, reasonCodes: guard.reasonCodes }));
      }
    }

    this.reflectApprovalPresence(s, pendingApprovals, morph.applied);

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
      pendingApprovals,
      learned,
    };
  }

  /** Reflect pending approvals in the AI presence (no morph applied but consent is needed). */
  private reflectApprovalPresence(s: SessionState, pending: ApprovalRequest[], morphed: boolean): void {
    if (pending.length > 0 && !morphed) s.presence = "waiting_for_approval";
  }

  /** Approve a pending capability and execute it (records an audit run). */
  async approve(approvalId: string): Promise<(ExecutionOutcome & { sessionId: string }) | null> {
    const pending = this.pendingExecutions.get(approvalId);
    const req = this.approvals.approve(approvalId);
    if (!pending || !req) return null;
    this.pendingExecutions.delete(approvalId);
    const s = this.session(pending.sessionId);
    const outcome = await this.executor.execute(pending.capabilityId, pending.input, {
      sessionId: pending.sessionId,
      worldState: s.world,
      now: this.deps.clock.iso(),
    });
    return { ...outcome, sessionId: pending.sessionId };
  }

  /** Reject a pending capability; it will not run. */
  reject(approvalId: string): ApprovalRequest | undefined {
    this.pendingExecutions.delete(approvalId);
    const req = this.approvals.reject(approvalId);
    // Drop the record so the same capability can be re-offered if the situation recurs.
    this.approvals.delete(approvalId);
    return req;
  }

  undo(sessionId: string): UIBlueprint | null {
    const s = this.session(sessionId);
    const inverse = s.history.pop();
    if (!inverse) return null;
    const meta = s.morphMeta.pop();
    // Undo is feedback: remember that this kind of change was not wanted (see DISMISS_THRESHOLD).
    if (meta) s.memory.preferences.reinforce(`dismissed:${meta.intent}:${meta.variant ?? ""}`);
    const { next } = applyPatch(s.blueprint, inverse, this.deps.clock.iso());
    s.blueprint = next;
    // Undo is a deliberate user action — clear morph timing so a re-morph isn't rate-limited.
    s.lastMorphAt = undefined;
    s.lastMajorMorphAt = undefined;
    return s.blueprint;
  }

  private seq = 0;
  private record(sessionId: string, kind: string, detail: Record<string, unknown>): AuditRecord {
    return { id: `aud-${++this.seq}`, at: this.deps.clock.iso(), sessionId, kind, detail };
  }
}

export * from "./factory";
export * from "./replay";
