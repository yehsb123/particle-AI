import type { MatterEvent, UIBlueprint, WorldState } from "@dm/contracts";
import { emptyWorldState } from "@dm/contracts";
import { EventStore } from "@dm/event-core";
import { reduce } from "@dm/world-model";
import { developmentBlueprint } from "@dm/ui-registry";

/** Messages the runtime publishes to connected clients. */
export type RuntimeMessage =
  | { kind: "world_state_changed"; sessionId: string; worldState: WorldState }
  | { kind: "ui_patch"; sessionId: string; blueprint: UIBlueprint }
  | { kind: "ai_presence_changed"; sessionId: string; state: string };

export type RuntimeListener = (msg: RuntimeMessage) => void;

/**
 * Phase-2 perception runtime: owns the event store, per-session world state and current UI,
 * and publishes changes. Later phases extend `ingest` with significance → decision →
 * capability → morph; the seams (listeners, per-session UI) are already here.
 */
export class SessionRuntime {
  readonly store = new EventStore();
  private worlds = new Map<string, WorldState>();
  private uis = new Map<string, UIBlueprint>();
  private listeners = new Set<RuntimeListener>();

  constructor(private readonly now: () => string) {}

  getWorld(sessionId: string): WorldState {
    let w = this.worlds.get(sessionId);
    if (!w) {
      w = emptyWorldState(sessionId, this.now());
      this.worlds.set(sessionId, w);
    }
    return w;
  }

  getUI(sessionId: string): UIBlueprint {
    let ui = this.uis.get(sessionId);
    if (!ui) {
      ui = developmentBlueprint(this.now());
      this.uis.set(sessionId, ui);
    }
    return ui;
  }

  setUI(sessionId: string, blueprint: UIBlueprint): void {
    this.uis.set(sessionId, blueprint);
    this.emit({ kind: "ui_patch", sessionId, blueprint });
  }

  ingest(input: unknown): { event: MatterEvent; worldState: WorldState } {
    const event = this.store.append(input); // validates or throws
    const prev = this.getWorld(event.sessionId);
    const next = reduce(prev, event);
    this.worlds.set(event.sessionId, next);
    this.emit({ kind: "world_state_changed", sessionId: event.sessionId, worldState: next });
    return { event, worldState: next };
  }

  onMessage(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(msg: RuntimeMessage): void {
    for (const l of this.listeners) l(msg);
  }
}
