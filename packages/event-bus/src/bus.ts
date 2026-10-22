import type { MatterEvent } from "@particle/contracts";

/**
 * The channel an event travels down between the sensor that observed it and the loop that folds
 * it into a belief.
 *
 * It is one part with two ends on purpose. Inside one process the two ends are the same call and
 * the channel is nothing at all; across a broker they are two processes and the answer the loop
 * produces is no longer the publisher's to return. Everything that differs between those two is
 * in `Delivery`, in the open, so that a caller is never told that something ran here when it did
 * not.
 */
export const EVENT_BUS_KINDS = ["inproc", "kafka"] as const;
export type EventBusKind = (typeof EVENT_BUS_KINDS)[number];

/** What the loop does with one event, and what it answers with. */
export type EventHandler<R> = (event: MatterEvent) => Promise<R>;

/**
 * Where the event went, and whether its answer came back.
 *
 * `handled: false` is not a failure — it is a handover. The event is on the topic and some
 * runtime in the consumer group will run it; this process simply has no result to hand back, and
 * says so rather than answering with an empty one.
 */
export type Delivery<R> =
  | { readonly handled: true; readonly via: "inproc"; readonly result: R }
  | { readonly handled: false; readonly via: "kafka"; readonly topic: string; readonly key: string };

export interface EventBus<R> {
  /** Which channel this is, for anything that has to say where an event went. */
  readonly via: EventBusKind;
  /** Put one event in the channel. Resolves when it is the loop's (or the broker's). */
  publish(event: MatterEvent): Promise<Delivery<R>>;
  /** Take what comes out of the channel. One subscriber; the loop is not a crowd. */
  subscribe(handler: EventHandler<R>): Promise<void>;
  /** Stop. After this nothing may be published, and nothing more is delivered. */
  close(): Promise<void>;
}
