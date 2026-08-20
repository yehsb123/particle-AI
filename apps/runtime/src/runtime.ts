import type { AuditRecord, MatterEvent, UIBlueprint, WorldState } from "@particle/contracts";
import { MatterEvent as MatterEventSchema } from "@particle/contracts";
import { EventStore } from "@particle/event-core";
import { AuditLog } from "@particle/permission-engine";
import { createLogger, TraceStore, type LogLevel } from "@particle/observability";
import { createRuntimeCoreFromEnv, type IngestResult, type RuntimeCore } from "@particle/runtime-core";
import type { EventLogStore, SnapshotStore } from "@particle/persistence";

/** Messages the runtime publishes to connected clients. */
export type RuntimeMessage =
  | { kind: "world_state_changed"; sessionId: string; worldState: WorldState }
  | { kind: "ui_patch"; sessionId: string; blueprint: UIBlueprint }
  | { kind: "ai_presence_changed"; sessionId: string; state: string }
  | { kind: "decision_created"; sessionId: string; audit: AuditRecord[] };

export type RuntimeListener = (msg: RuntimeMessage) => void;

/**
 * Server-side composition of the shared RuntimeCore: validates and stores events, runs the
 * full loop, records audit, delegates approvals to the core, and broadcasts changes over WS.
 */
export class SessionRuntime {
  readonly store = new EventStore();
  readonly audit = new AuditLog();
  readonly traces = new TraceStore();
  private readonly log = createLogger((process.env.DM_LOG_LEVEL as LogLevel) ?? "info");
  private core: RuntimeCore;
  private listeners = new Set<RuntimeListener>();

  constructor(
    private readonly now: () => string,
    private readonly eventLog?: EventLogStore,
    private readonly snapshotStore?: SnapshotStore,
  ) {
    this.core = createRuntimeCoreFromEnv({ iso: now, ms: () => Date.parse(now()) || 0 });
  }

  /** Approval store lives on the core (which also executes on approve). */
  get approvals() {
    return this.core.approvals;
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
    if (this.eventLog) await this.eventLog.append(event); // durable append when configured
    const result = await this.core.ingest(event);

    for (const rec of result.audit) this.audit.append(rec);

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

    // Durable snapshots of the reshaped body + belief state (when configured).
    if (this.snapshotStore && result.morph.applied) {
      const at = this.now();
      await this.snapshotStore.save({ sessionId: event.sessionId, kind: "world", at, data: result.worldState });
      await this.snapshotStore.save({ sessionId: event.sessionId, kind: "ui", at, data: result.blueprint });
    }

    this.emit({ kind: "world_state_changed", sessionId: event.sessionId, worldState: result.worldState });
    this.emit({ kind: "ai_presence_changed", sessionId: event.sessionId, state: result.presence });
    if (result.morph.applied) {
      this.emit({ kind: "ui_patch", sessionId: event.sessionId, blueprint: result.blueprint });
    }
    if (result.audit.length) {
      this.emit({ kind: "decision_created", sessionId: event.sessionId, audit: result.audit });
    }
    return { event, result };
  }

  async approve(approvalId: string) {
    const outcome = await this.core.approve(approvalId);
    if (outcome) {
      const rec: AuditRecord = {
        id: `aud-appr-${approvalId}`,
        at: this.now(),
        sessionId: "",
        kind: "capability_approved",
        detail: { approvalId, capabilityId: outcome.capabilityId, ok: outcome.result.ok },
      };
      this.audit.append(rec);
    }
    return outcome;
  }

  reject(approvalId: string) {
    return this.core.reject(approvalId);
  }

  undo(sessionId: string): UIBlueprint | null {
    const bp = this.core.undo(sessionId);
    if (bp) this.emit({ kind: "ui_patch", sessionId, blueprint: bp });
    return bp;
  }

  /** Reconstruct a session's UI + world from the latest persisted snapshots (resume). */
  async resume(sessionId: string): Promise<UIBlueprint | null> {
    if (!this.snapshotStore) return null;
    const snaps = await this.snapshotStore.list(sessionId);
    const reversed = [...snaps].reverse();
    const ui = reversed.find((s) => s.kind === "ui");
    const world = reversed.find((s) => s.kind === "world");
    if (!ui && !world) return null;
    this.core.hydrate(sessionId, {
      blueprint: ui?.data as UIBlueprint | undefined,
      world: world?.data as WorldState | undefined,
    });
    const bp = this.core.getBlueprint(sessionId);
    this.emit({ kind: "world_state_changed", sessionId, worldState: this.core.getWorld(sessionId) });
    this.emit({ kind: "ui_patch", sessionId, blueprint: bp });
    return bp;
  }

  onMessage(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(msg: RuntimeMessage): void {
    for (const l of this.listeners) l(msg);
  }
}
