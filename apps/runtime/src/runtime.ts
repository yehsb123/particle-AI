import type { AuditRecord, MatterEvent, UIBlueprint, WorldState } from "@particle/contracts";
import { MatterEvent as MatterEventSchema } from "@particle/contracts";
import { EventStore } from "@particle/event-core";
import { AuditLog } from "@particle/permission-engine";
import { createLogger, TraceStore, type LogLevel } from "@particle/observability";
import { createRuntimeCoreFromEnv, type IngestResult, type RuntimeCore } from "@particle/runtime-core";
import type { EventLogStore, SnapshotStore } from "@particle/persistence";

/** Messages the runtime publishes to connected clients. */
import type { RuntimeMessage, RuntimeListener } from "@particle/contracts";
export type { RuntimeMessage, RuntimeListener };

/**
 * Server-side composition of the shared RuntimeCore: validates and stores events, runs the
 * full loop, records audit, delegates approvals to the core, and broadcasts changes over WS.
 */
export class SessionRuntime {
  readonly store = new EventStore();
  readonly audit = new AuditLog();
  /**
   * Audit records identify themselves, and the trail is read by id: the inspector draws one row
   * per record keyed by it. Two reversals in the same millisecond were the same record as far as
   * anything reading could tell, and a multi-step "go back" makes exactly that. A count never
   * repeats within a process, which is as far as one trail reaches.
   */
  private auditSeq = 0;
  private auditId(kind: string): string {
    return `aud-${kind}-${++this.auditSeq}`;
  }
  readonly traces = new TraceStore();
  private readonly log = createLogger((process.env.DM_LOG_LEVEL as LogLevel) ?? "info");
  core: RuntimeCore;
  private listeners = new Set<RuntimeListener>();

  constructor(
    private readonly now: () => string,
    private readonly eventLog?: EventLogStore,
    private readonly snapshotStore?: SnapshotStore,
  ) {
    this.core = createRuntimeCoreFromEnv({
      iso: now,
      ms: () => {
        const t = Date.parse(now());
        return Number.isNaN(t) ? Date.now() : t; // never freeze cooldowns on a bad clock
      },
    });
  }

  setAutonomy(level: 0 | 1 | 2 | 3 | 4): void {
    this.core.setAutonomyLevel(level);
  }
  getAutonomy(): number {
    return this.core.getAutonomyLevel();
  }

  /** Approval store lives on the core (which also executes on approve). */
  get approvals() {
    return this.core.approvals;
  }

  /** Read-only views never create sessions (an unauthenticated GET must not evict real ones). */
  peekWorld(sessionId: string): WorldState {
    return this.core.peekWorld(sessionId);
  }
  peekUI(sessionId: string): UIBlueprint {
    return this.core.peekBlueprint(sessionId);
  }
  getWorld(sessionId: string): WorldState {
    return this.core.getWorld(sessionId);
  }
  getUI(sessionId: string): UIBlueprint {
    return this.core.getBlueprint(sessionId);
  }

  async ingest(input: unknown): Promise<{ event: MatterEvent; result: IngestResult }> {
    const event = MatterEventSchema.parse(input);
    this.store.append(event);
    // Durable append is best-effort, exactly like the snapshots further down: the event is
    // already in the in-memory log, so letting a database outage throw here would abort the
    // ingest and leave the two logs disagreeing — the body would stop reshaping because
    // storage hiccuped. The failure is loud in the log instead.
    if (this.eventLog) {
      try {
        await this.eventLog.append(event);
      } catch (err) {
        this.log.warn("event_append_failed", { sessionId: event.sessionId, eventId: event.id, error: (err as Error).message });
      }
    }
    const result = await this.core.ingest(event);

    for (const rec of result.audit) this.audit.append(rec);
    // A pending reconcile must SURVIVE unrelated events (a file save, an interaction batch) —
    // cancel only once the body actually caught up; re-arm when a new hold reports a time.
    if (result.morph.applied) this.cancelReconcile(event.sessionId);
    else if (result.retryAfterMs !== undefined) this.scheduleReconcile(event.sessionId, result.retryAfterMs);
    if (result.learned) this.emit({ kind: "learned", sessionId: event.sessionId, learned: result.learned });
    // suggestions must reach a WS-attached body too — otherwise a headless emitter's threshold
    // crossing marks them `suggested` (offered once, ever) without any human having seen them
    if (result.patternSuggestions.length) {
      this.emit({ kind: "pattern_suggestions", sessionId: event.sessionId, suggestions: result.patternSuggestions.map((p) => ({ key: p.key, count: p.count })) });
    }

    // Structured trace + log for the developer inspector / observability.
    this.traces.append({
      at: this.now(),
      sessionId: event.sessionId,
      eventId: event.id,
      eventType: event.type,
      significance: result.significance.score,
      deliberated: result.deliberated,
      providerId: result.providerId,
      usedFallback: result.usedFallback,
      decisionId: result.decision?.id,
      capabilityIds: result.capabilityRuns.map((r) => r.capabilityId),
      morphApplied: result.morph.applied,
      guardReasonCodes: result.morph.guardReasonCodes,
    });
    this.log.info("ingest", {
      sessionId: event.sessionId,
      event: event.type,
      significance: result.significance.score,
      morph: result.morph.applied,
      provider: result.providerId,
    });

    // Broadcast first so clients stay in sync even if durability hiccups.
    this.emit({ kind: "world_state_changed", sessionId: event.sessionId, worldState: result.worldState });
    this.emit({ kind: "ai_presence_changed", sessionId: event.sessionId, state: result.presence });
    if (result.morph.applied) {
      this.emit({ kind: "ui_patch", sessionId: event.sessionId, blueprint: result.blueprint });
    }
    if (result.audit.length) {
      this.emit({ kind: "decision_created", sessionId: event.sessionId, audit: result.audit });
    }
    // The presence goes out to every body watching, so they all show that the runtime is waiting
    // on somebody. Only the one whose call caused it had anything to answer with.
    if (result.pendingApprovals.length) {
      this.emit({ kind: "approval_asked", sessionId: event.sessionId, approvals: result.pendingApprovals });
    }

    // Durable snapshots of the reshaped body + belief state (best-effort — a DB failure must
    // not abort ingest or diverge clients from the server).
    if (this.snapshotStore && result.morph.applied) {
      const at = this.now();
      try {
        await this.snapshotStore.save({ sessionId: event.sessionId, kind: "world", at, data: result.worldState });
        await this.snapshotStore.save({ sessionId: event.sessionId, kind: "ui", at, data: result.blueprint });
        await this.snapshotStore.save({ sessionId: event.sessionId, kind: "memory", at, data: this.core.exportMemory(event.sessionId) });
      } catch (err) {
        this.log.warn("snapshot_save_failed", { sessionId: event.sessionId, error: (err as Error).message });
      }
    }
    return { event, result };
  }

  async approve(approvalId: string) {
    const outcome = await this.core.approve(approvalId);
    if (outcome) {
      const rec: AuditRecord = {
        id: `aud-appr-${approvalId}`,
        at: this.now(),
        sessionId: outcome.sessionId,
        kind: "capability_approved",
        detail: { approvalId, capabilityId: outcome.capabilityId, ok: outcome.result.ok },
      };
      this.audit.append(rec);
      // one body asking is not the only body watching: the same session can be open in another
      // tab and in the side panel, and whichever did not click was left holding a settled card
      this.emit({ kind: "approval_decided", sessionId: outcome.sessionId, approvalId, decision: "approved" });
    }
    return outcome;
  }

  reject(approvalId: string) {
    const req = this.core.reject(approvalId);
    if (req) {
      // a refusal is a decision. The trail recorded what was allowed and kept nothing at all of
      // what a person turned down, which is the half of a consent record worth having.
      this.audit.append({
        id: `aud-rej-${approvalId}`,
        at: this.now(),
        sessionId: req.sessionId,
        kind: "capability_rejected",
        detail: { approvalId, capabilityId: req.capabilityId, risk: req.risk },
      });
      this.emit({ kind: "approval_decided", sessionId: req.sessionId, approvalId, decision: "rejected" });
    }
    return req;
  }

  undo(sessionId: string, opts: { componentId?: string; learn?: boolean } = {}): UIBlueprint | null {
    const bp = this.core.undo(sessionId, opts);
    if (bp) {
      this.audit.append({ id: this.auditId("undo"), at: this.now(), sessionId, kind: "morph_undone", detail: { componentId: opts.componentId ?? null, learn: opts.learn ?? true } });
      this.emit({ kind: "ui_patch", sessionId, blueprint: bp });
      this.persistReversal(sessionId, bp);
    }
    return bp;
  }

  /**
   * Reversals persist MEMORY first, then UI: if the process dies in between, resume shows the
   * old card but keeps the corrected lesson — the harmless side of the race. Best-effort.
   */
  private persistReversal(sessionId: string, bp: UIBlueprint): void {
    const at = this.now();
    void (async () => {
      await this.snapshotStore?.save({ sessionId, kind: "memory", at, data: this.core.exportMemory(sessionId) });
      await this.snapshotStore?.save({ sessionId, kind: "ui", at, data: bp });
    })().catch((err: unknown) => this.log.warn("snapshot_save_failed", { sessionId, error: (err as Error).message }));
  }

  redo(sessionId: string): UIBlueprint | null {
    const bp = this.core.redo(sessionId);
    if (bp) {
      this.audit.append({ id: this.auditId("redo"), at: this.now(), sessionId, kind: "morph_redone", detail: {} });
      this.emit({ kind: "ui_patch", sessionId, blueprint: bp });
      this.persistReversal(sessionId, bp);
    }
    return bp;
  }

  /**
   * A morph held purely on timing (cooldown / dwell) must not leave the body out of step with the
   * world forever — e.g. a build that fails again 1 s after recovering, with no further output.
   * One pending tick per session; it is an ordinary event, so the log and replay see it too.
   */
  private reconcileTimers = new Map<string, NodeJS.Timeout>();
  private cancelReconcile(sessionId: string): void {
    const prev = this.reconcileTimers.get(sessionId);
    if (prev) clearTimeout(prev);
    this.reconcileTimers.delete(sessionId);
  }
  private scheduleReconcile(sessionId: string, afterMs: number): void {
    this.cancelReconcile(sessionId);
    const t = setTimeout(() => {
      this.reconcileTimers.delete(sessionId);
      if (!this.core.hasSession(sessionId)) return; // evicted meanwhile — do not resurrect it
      void this.ingest({
        id: `reconcile-${sessionId}-${Date.now()}`,
        sessionId,
        timestamp: this.now(),
        source: "system",
        type: "runtime.reconcile",
        severity: "debug",
        payload: { reason: "guard_hold_expired" },
      }).catch(() => undefined);
    }, Math.min(afterMs, 60_000));
    t.unref?.();
    this.reconcileTimers.set(sessionId, t);
  }

  /** Reconstruct a session's UI + world from the latest persisted snapshots (resume). */
  async resume(sessionId: string): Promise<UIBlueprint | null> {
    if (!this.snapshotStore) return null;
    const snaps = await this.snapshotStore.list(sessionId);
    const reversed = [...snaps].reverse();
    const ui = reversed.find((s) => s.kind === "ui");
    const world = reversed.find((s) => s.kind === "world");
    const memory = reversed.find((s) => s.kind === "memory");
    if (memory) this.core.importMemory(sessionId, memory.data as { preferences?: { key: string; weight: number }[] });
    if (!ui && !world) return null;
    const taken = this.core.hydrate(sessionId, {
      blueprint: ui?.data as UIBlueprint | undefined,
      world: world?.data as WorldState | undefined,
    });
    if (!taken.world && !taken.blueprint) {
      // the snapshots exist but neither survived validation — say nothing was resumed rather
      // than hand back a fresh body and call it a restoration
      this.log.warn("resume_snapshot_unusable", { sessionId });
      return null;
    }
    const bp = this.core.getBlueprint(sessionId);
    // Undo and redo, its siblings, have always written to the trail. A resume replaces what the
    // runtime believes and what the body shows with something an earlier process wrote, and left
    // no mark at all — so a reader of the trail could not tell that the body above them came off
    // a disk rather than out of the events listed under it.
    this.audit.append({
      id: this.auditId("resume"),
      at: this.now(),
      sessionId,
      kind: "session_resumed",
      detail: { world: !!taken.world, blueprint: !!taken.blueprint, memory: !!memory },
    });
    this.emit({ kind: "world_state_changed", sessionId, worldState: this.core.getWorld(sessionId) });
    this.emit({ kind: "ui_patch", sessionId, blueprint: bp });
    return bp;
  }

  onMessage(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Every listener hears it, whatever the others do. A broadcast happens after the state has
   * already changed, so a client that throws must not take the ingest down with it — the caller
   * would see an error for work that was done, and the clients behind the failing one would
   * never hear about it at all.
   */
  private emit(msg: RuntimeMessage): void {
    for (const l of this.listeners) {
      try {
        l(msg);
      } catch (err) {
        this.log.warn("listener_failed", { kind: msg.kind, sessionId: msg.sessionId, error: (err as Error).message });
      }
    }
  }
}
