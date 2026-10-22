import { MatterEvent } from "@particle/contracts";
import type { Delivery, EventBus, EventHandler } from "./bus";
import type { EventBusConfig } from "./config";

/**
 * The same channel, with a broker in the middle.
 *
 * `kafkajs` is not a dependency of this repository and must never become one: with the channel
 * off, nothing here is imported, nothing is installed, and the runtime starts on a machine that
 * has never heard of Kafka. That is why the import below is dynamic and why the package is named
 * in a variable — a static specifier would be resolved by the type checker and bundled by
 * anything that walks the import graph, which is the opposite of optional.
 *
 * To turn it on: `pnpm add -w kafkajs` (tested against 2.2.4) and `DM_EVENT_BUS=kafka`.
 *
 * What this channel does NOT do is pretend. If the package is missing or no broker answers, it
 * stops and says which; it never hands back the in-process channel, because somebody who asked
 * for Kafka and was quietly given something else is watching an empty topic and believes their
 * events are on it.
 */
const KAFKAJS = "kafkajs";

/** The width of the HTTP door, so the topic is not a wider one. Fastify's own body limit. */
export const MAX_MESSAGE_BYTES = 1_048_576;

type KafkaConfig = Extract<EventBusConfig, { kind: "kafka" }>;

/** Only what this adapter calls. The real client has a great deal more. */
type KafkaMessage = { key: Buffer | null; value: Buffer | null; offset: string };
type Producer = {
  connect(): Promise<void>;
  send(payload: { topic: string; messages: { key: string; value: string }[] }): Promise<unknown>;
  disconnect(): Promise<void>;
};
type Consumer = {
  connect(): Promise<void>;
  subscribe(subscription: { topic: string; fromBeginning: boolean }): Promise<void>;
  run(opts: { eachMessage: (payload: { topic: string; partition: number; message: KafkaMessage }) => Promise<void> }): Promise<void>;
  disconnect(): Promise<void>;
};
type Admin = {
  connect(): Promise<void>;
  createTopics(opts: { topics: { topic: string; numPartitions: number; replicationFactor: number }[]; waitForLeaders: boolean }): Promise<boolean>;
  disconnect(): Promise<void>;
};
type KafkaClient = { producer(): Producer; consumer(cfg: { groupId: string }): Consumer; admin(): Admin };
type KafkaConstructor = new (cfg: { clientId: string; brokers: string[]; retry: { retries: number } }) => KafkaClient;

export type KafkaDeps = {
  /** How `kafkajs` is found. Overridden in tests; nothing else should pass it. */
  load?: () => Promise<unknown>;
  /** Something on the topic that is not an event the runtime accepts. */
  onRefused?: (refusal: { reason: string; detail: string; offset: string }) => void;
  /** The loop refused an event nobody is waiting on. */
  onFailed?: (failure: { sessionId: string; eventId: string; error: string }) => void;
};

async function loadKafka(load: () => Promise<unknown>, brokers: string[]): Promise<KafkaConstructor> {
  let mod: unknown;
  try {
    mod = await load();
  } catch (err) {
    throw new Error(
      `DM_EVENT_BUS=kafka needs the kafkajs package, and it is not installed: ${(err as Error).message}. ` +
        `Install it (pnpm add -w kafkajs) or unset DM_EVENT_BUS to use the in-process channel.`,
    );
  }
  // What came back is read rather than assumed: a package that resolved to something else would
  // otherwise fail much later, inside a call, with a message about `undefined`.
  const found = mod as { Kafka?: unknown; default?: { Kafka?: unknown } };
  const Kafka = typeof found?.Kafka === "function" ? found.Kafka : found?.default?.Kafka;
  if (typeof Kafka !== "function") {
    throw new Error(
      `DM_EVENT_BUS=kafka loaded something that is not kafkajs (no Kafka export), with brokers ${brokers.join(", ")}.`,
    );
  }
  return Kafka as KafkaConstructor;
}

export class KafkaEventBus<R> implements EventBus<R> {
  readonly via = "kafka" as const;
  private client?: KafkaClient;
  private producer?: Producer;
  private consumer?: Consumer;
  private closed = false;

  constructor(
    private readonly config: KafkaConfig,
    private readonly deps: KafkaDeps = {},
  ) {}

  /**
   * Connect before anything is published, so a missing package or an absent broker is a runtime
   * that did not start rather than one that is dropping events into nothing.
   */
  async start(): Promise<void> {
    const load = this.deps.load ?? (() => import(/* @vite-ignore */ KAFKAJS));
    const Kafka = await loadKafka(load, this.config.brokers);
    this.client = new Kafka({
      clientId: this.config.groupId,
      brokers: this.config.brokers,
      // Fail in seconds rather than minutes: this runs at startup, where somebody is watching.
      retry: { retries: 2 },
    });
    const producer = this.client.producer();
    try {
      await producer.connect();
    } catch (err) {
      throw new Error(
        `DM_EVENT_BUS=kafka could not reach a broker at ${this.config.brokers.join(", ")}: ${(err as Error).message}. ` +
          `Start one (docker compose --profile kafka up -d kafka) or unset DM_EVENT_BUS.`,
      );
    }
    this.producer = producer;
    await this.ensureTopic();
  }

  /**
   * Make sure the topic is there, with leaders elected, before anyone subscribes to it.
   *
   * Measured against a fresh broker: a consumer that subscribes to a topic which does not exist
   * yet is answered "this server does not host this topic-partition" and stops, even with
   * automatic creation on — creation happens on the metadata request and the first fetch races
   * it. So the topic is asked for once at startup and the call waits for leaders. It already
   * exists on every start after the first, which `createTopics` answers with a plain false.
   *
   * The partition count and replication are the broker's own defaults (-1), because how a cluster
   * spreads a topic is its operator's decision and not something a runtime should impose.
   */
  private async ensureTopic(): Promise<void> {
    const client = this.client;
    if (!client) throw new Error("the kafka event bus was not started");
    const admin = client.admin();
    try {
      await admin.connect();
      await admin.createTopics({
        topics: [{ topic: this.config.topic, numPartitions: -1, replicationFactor: -1 }],
        waitForLeaders: true,
      });
    } catch (err) {
      throw new Error(
        `DM_EVENT_BUS=kafka could not make sure the topic ${this.config.topic} exists on ${this.config.brokers.join(", ")}: ` +
          `${(err as Error).message}. Create it yourself, or point DM_KAFKA_TOPIC at one that is there.`,
      );
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  async publish(event: MatterEvent): Promise<Delivery<R>> {
    if (this.closed) throw new Error("the event bus is closed");
    const producer = this.producer;
    if (!producer) throw new Error("the kafka event bus was not started");
    // The session name is the partition key: one session's events land on one partition, which is
    // the only place a broker promises an order. Different sessions are free to spread.
    const key = event.sessionId;
    await producer.send({ topic: this.config.topic, messages: [{ key, value: JSON.stringify(event) }] });
    return { handled: false, via: "kafka", topic: this.config.topic, key };
  }

  async subscribe(handler: EventHandler<R>): Promise<void> {
    if (this.closed) throw new Error("the event bus is closed");
    const client = this.client;
    if (!client) throw new Error("the kafka event bus was not started");
    if (this.consumer) throw new Error("the event bus already has a subscriber");
    const consumer = client.consumer({ groupId: this.config.groupId });
    try {
      await consumer.connect();
    } catch (err) {
      throw new Error(
        `DM_EVENT_BUS=kafka could not reach a broker at ${this.config.brokers.join(", ")}: ${(err as Error).message}. ` +
          `Start one (docker compose --profile kafka up -d kafka) or unset DM_EVENT_BUS.`,
      );
    }
    this.consumer = consumer;
    // From here on, not from the beginning: a restart is not a reason to re-live a day of events
    // and reshape somebody's body around what was happening this morning.
    await consumer.subscribe({ topic: this.config.topic, fromBeginning: false });
    await consumer.run({ eachMessage: async ({ message }) => this.deliver(handler, message) });
  }

  private async deliver(handler: EventHandler<R>, message: KafkaMessage): Promise<void> {
    const offset = message.offset ?? "";
    const refuse = (reason: string, detail: string) => this.deps.onRefused?.({ reason, detail, offset });
    const raw = message.value;
    if (raw === null || raw.length === 0) return refuse("empty", "the message had no value");
    if (raw.length > MAX_MESSAGE_BYTES) {
      return refuse("too large", `${raw.length} bytes, over the ${MAX_MESSAGE_BYTES} the runtime accepts`);
    }
    let json: unknown;
    try {
      json = JSON.parse(raw.toString("utf8"));
    } catch (err) {
      return refuse("not json", (err as Error).message);
    }
    // The same contract the HTTP door parses. A topic anyone can write to must not be a way of
    // sending the loop something an event schema would have refused.
    const parsed = MatterEvent.safeParse(json);
    if (!parsed.success) {
      return refuse("not an event", parsed.error.issues.map((i) => `${i.path.join(".") || "(event)"}: ${i.code}`).join("; "));
    }
    const event = parsed.data;
    try {
      await handler(event);
    } catch (err) {
      // Nobody is waiting on a consumed event. Letting this out would make the broker hand the
      // same message back for ever and that partition — every session on it — would stop.
      this.deps.onFailed?.({ sessionId: event.sessionId, eventId: event.id, error: (err as Error).message });
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const consumer = this.consumer;
    const producer = this.producer;
    this.consumer = undefined;
    this.producer = undefined;
    this.client = undefined;
    // Both ends are closed even if the first refuses: a consumer left connected holds its share
    // of the partitions and nothing else in the group can take them.
    const problems: string[] = [];
    for (const end of [consumer, producer]) {
      try {
        await end?.disconnect();
      } catch (err) {
        problems.push((err as Error).message);
      }
    }
    if (problems.length) throw new Error(`the kafka event bus did not close cleanly: ${problems.join("; ")}`);
  }
}
