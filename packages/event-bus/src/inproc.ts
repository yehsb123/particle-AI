import type { MatterEvent } from "@particle/contracts";
import type { Delivery, EventBus, EventHandler } from "./bus";

/**
 * The channel that is no channel: the publisher calls the loop.
 *
 * This is what the runtime has always done, named. Nothing is serialised, nothing is copied,
 * nothing is retried, and no dependency is added — handing an event to this is the same act as
 * calling the loop with it, which is the only way a part can be pulled out of a working path
 * without changing what that path does.
 *
 * The handover happens inside `publish`, before the promise is returned: the acknowledgement for
 * a caller that is not waiting reads what its session has lost immediately after publishing, and
 * it is the queueing itself that may have pushed an older event out.
 */
export class InProcessEventBus<R> implements EventBus<R> {
  readonly via = "inproc" as const;
  private handler?: EventHandler<R>;
  private closed = false;

  publish(event: MatterEvent): Promise<Delivery<R>> {
    if (this.closed) return Promise.reject(new Error("the event bus is closed"));
    const handler = this.handler;
    // Publishing into a channel nobody listens on would be answered like a success, which is the
    // silent loss this part exists to make impossible.
    if (!handler) return Promise.reject(new Error("nothing is listening on the event bus"));
    try {
      // A handler that throws rather than rejects would throw out of `publish` itself, past every
      // caller written to catch a rejection. Refusing and rejecting are the same thing to whoever
      // published, so they are made the same thing here.
      return handler(event).then((result) => ({ handled: true, via: "inproc", result }) as const);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  async subscribe(handler: EventHandler<R>): Promise<void> {
    if (this.closed) throw new Error("the event bus is closed");
    // Replacing it quietly would leave the first subscriber attached to nothing and no sign of it.
    if (this.handler) throw new Error("the event bus already has a subscriber");
    this.handler = handler;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handler = undefined;
  }
}
