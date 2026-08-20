import type { AuditRecord, MatterEvent, UIBlueprint, WorldState } from "@dm/contracts";
import { MatterEvent as MatterEventSchema } from "@dm/contracts";
import { EventStore } from "@dm/event-core";
import { AuditLog, ApprovalStore } from "@dm/permission-engine";
import { createRuntimeCoreFromEnv, type IngestResult, type RuntimeCore } from "@dm/runtime-core";
import type { EventLogStore } from "@dm/persistence";

/** Messages the runtime publishes to connected clients. */
export type RuntimeMessage =
  | { kind: "world_state_changed"; sessionId: string; worldState: WorldState }
  | { kind: "ui_patch"; sessionId: string; blueprint: UIBlueprint }
  | { kind: "ai_presence_changed"; sessionId: string; state: string }
  | { kind: "decision_created"; sessionId: string; audit: AuditRecord[] };

export type RuntimeListener = (msg: RuntimeMessage) => void;

/**
 * Server-side composition of the shared RuntimeCore: validates and stores events, runs the
 * full loop, records audit + approvals, and broadcasts changes over WebSocket.
 */
export class SessionRuntime {
  readonly store = new EventStore();
  readonly audit = new AuditLog();
  readonly approvals = new ApprovalStore();
  private core: RuntimeCore;
  private listeners = new Set<RuntimeListener>();

  constructor(private readonly now: () => string, private readonly eventLog?: EventLogStore) {
    this.core = createRuntimeCoreFromEnv({ iso: now, ms: () => Date.parse(now()) || 0 });
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
    if (result.permission) {
      for (const item of result.permission.needsApproval) {
        this.approvals.create({
          id: `appr-${event.id}-${item.capabilityId}`,
          capabilityId: item.capabilityId,
          risk: item.risk,
          reason: `requires approval at current autonomy level`,
          createdAt: this.now(),
        });
      }
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

  undo(sessionId: string): UIBlueprint | null {
    const bp = this.core.undo(sessionId);
    if (bp) this.emit({ kind: "ui_patch", sessionId, blueprint: bp });
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
