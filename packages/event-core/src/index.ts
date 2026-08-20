import { MatterEvent } from "@particle/contracts";

export type EventHandler = (event: MatterEvent) => void;

/**
 * Append-only, in-memory event log with per-session indexing and subscription. Phase 8
 * swaps the backing store for Postgres behind this same interface. Validates on append so
 * malformed events never enter the log.
 */
export class EventStore {
  private events: MatterEvent[] = [];
  private bySession = new Map<string, MatterEvent[]>();
  private handlers = new Set<EventHandler>();

  append(input: unknown): MatterEvent {
    const event = MatterEvent.parse(input);
    this.events.push(event);
    const list = this.bySession.get(event.sessionId) ?? [];
    list.push(event);
    this.bySession.set(event.sessionId, list);
    for (const h of this.handlers) h(event);
    return event;
  }

  listBySession(sessionId: string): MatterEvent[] {
    return [...(this.bySession.get(sessionId) ?? [])];
  }

  all(): MatterEvent[] {
    return [...this.events];
  }

  count(): number {
    return this.events.length;
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

/** Build a validated event, filling id/timestamp provided by the caller (kept clock-free). */
export function createEvent(
  spec: Omit<MatterEvent, "id" | "timestamp"> & { id: string; timestamp: string },
): MatterEvent {
  return MatterEvent.parse(spec);
}
