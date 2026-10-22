import { describe, it, expect, vi } from "vitest";
import type { MatterEvent } from "@particle/contracts";
import { KafkaEventBus } from "./kafka";
import { createEventBus } from "./create";

/**
 * The kafka channel, against a broker that is not there.
 *
 * Everything below drives the adapter through a stand-in for `kafkajs` — the same calls a real
 * client would get, with the messages kept in an array instead of on a disk somewhere. That is
 * enough to pin the three things the channel promises and a broker cannot be asked to prove on
 * every run: that a session's events keep their order, that a failure reaches whoever published,
 * and that closing it closes both ends. The one thing a stand-in cannot prove is that a real
 * broker agrees, which is what `kafka.live.test.ts` is for.
 */
type SentMessage = { key: string | null; value: string };

function fakeKafkajs() {
  const sent: { topic: string; messages: SentMessage[] }[] = [];
  const state = {
    sent,
    producerConnected: false,
    consumerConnected: false,
    subscribedTo: [] as { topic: string; fromBeginning: boolean }[],
    groupId: "",
    brokers: [] as string[],
    deliver: undefined as undefined | ((msg: { key?: string | null; value: string | null; offset?: string }) => Promise<void>),
    failConnect: null as string | null,
    failSend: null as string | null,
    failCreateTopics: null as string | null,
    created: [] as string[],
    waitedForLeaders: false,
  };
  class Kafka {
    constructor(cfg: { brokers: string[] }) {
      state.brokers = cfg.brokers;
    }
    producer() {
      return {
        connect: async () => {
          if (state.failConnect) throw new Error(state.failConnect);
          state.producerConnected = true;
        },
        send: async (payload: { topic: string; messages: SentMessage[] }) => {
          if (state.failSend) throw new Error(state.failSend);
          sent.push(payload);
        },
        disconnect: async () => {
          state.producerConnected = false;
        },
      };
    }
    admin() {
      return {
        connect: async () => {
          if (state.failConnect) throw new Error(state.failConnect);
        },
        createTopics: async (opts: { topics: { topic: string; numPartitions: number }[]; waitForLeaders: boolean }) => {
          if (state.failCreateTopics) throw new Error(state.failCreateTopics);
          state.created.push(...opts.topics.map((t) => t.topic));
          state.waitedForLeaders = opts.waitForLeaders;
          return true;
        },
        disconnect: async () => undefined,
      };
    }
    consumer(cfg: { groupId: string }) {
      state.groupId = cfg.groupId;
      return {
        connect: async () => {
          if (state.failConnect) throw new Error(state.failConnect);
          state.consumerConnected = true;
        },
        subscribe: async (s: { topic: string; fromBeginning: boolean }) => {
          state.subscribedTo.push(s);
        },
        run: async (opts: {
          eachMessage: (p: { topic: string; partition: number; message: { key: Buffer | null; value: Buffer | null; offset: string } }) => Promise<void>;
        }) => {
          state.deliver = async (msg) =>
            opts.eachMessage({
              topic: state.subscribedTo[0]?.topic ?? "",
              partition: 0,
              message: {
                key: msg.key === undefined || msg.key === null ? null : Buffer.from(msg.key),
                value: msg.value === null ? null : Buffer.from(msg.value),
                offset: msg.offset ?? "0",
              },
            });
        },
        disconnect: async () => {
          state.consumerConnected = false;
        },
      };
    }
  }
  return { module: { Kafka }, state };
}

const config = { kind: "kafka" as const, brokers: ["127.0.0.1:9092"], topic: "dm.events", groupId: "dm-runtime" };

const event = (id: string, sessionId = "s1"): MatterEvent => ({
  id,
  sessionId,
  timestamp: "2026-10-22T00:00:00.000Z",
  source: "development",
  type: "development.build_failed",
  severity: "warning",
  payload: {},
});

describe("publishing to a topic", () => {
  it("sends the event to the configured topic", async () => {
    const fake = fakeKafkajs();
    const bus = new KafkaEventBus<void>(config, { load: async () => fake.module });
    await bus.start();

    const delivery = await bus.publish(event("e1"));

    expect(fake.state.sent).toHaveLength(1);
    expect(fake.state.sent[0]!.topic).toBe("dm.events");
    expect(JSON.parse(fake.state.sent[0]!.messages[0]!.value)).toMatchObject({ id: "e1", sessionId: "s1" });
    expect(delivery).toEqual({ handled: false, via: "kafka", topic: "dm.events", key: "s1" });
    await bus.close();
  });

  /**
   * A session's events only mean anything in the order they happened, and across partitions a
   * broker keeps no order at all. The session name is the partition key, so one session's events
   * land on one partition and come back out in the order they went in; different sessions are
   * free to spread.
   */
  it("keys every message by the session, so one session keeps its order", async () => {
    const fake = fakeKafkajs();
    const bus = new KafkaEventBus<void>(config, { load: async () => fake.module });
    await bus.start();

    await bus.publish(event("e1", "alice"));
    await bus.publish(event("e2", "bob"));
    await bus.publish(event("e3", "alice"));

    expect(fake.state.sent.map((s) => s.messages[0]!.key)).toEqual(["alice", "bob", "alice"]);
    await bus.close();
  });

  it("tells the publisher when the broker refused the send, rather than losing it quietly", async () => {
    const fake = fakeKafkajs();
    const bus = new KafkaEventBus<void>(config, { load: async () => fake.module });
    await bus.start();
    fake.state.failSend = "broker went away";

    await expect(bus.publish(event("e1"))).rejects.toThrow(/broker went away/);
    await bus.close();
  });
});

/**
 * Measured against a fresh broker: subscribing to a topic that does not exist yet is answered
 * "this server does not host this topic-partition", and the consumer stops there — automatic
 * creation happens on the metadata request and the first fetch races it.
 */
describe("the topic itself", () => {
  it("is there, with leaders, before anybody subscribes", async () => {
    const fake = fakeKafkajs();
    const bus = new KafkaEventBus<void>(config, { load: async () => fake.module });
    await bus.start();

    expect(fake.state.created).toEqual(["dm.events"]);
    expect(fake.state.waitedForLeaders).toBe(true);
    await bus.close();
  });

  it("stops with the topic's name when it cannot be made sure of", async () => {
    const fake = fakeKafkajs();
    fake.state.failCreateTopics = "TOPIC_AUTHORIZATION_FAILED";
    const bus = new KafkaEventBus<void>(config, { load: async () => fake.module });
    await expect(bus.start()).rejects.toThrow(/dm\.events/);
    await expect(bus.start()).rejects.toThrow(/TOPIC_AUTHORIZATION_FAILED/);
  });
});

describe("consuming from a topic", () => {
  it("parses what arrives and hands the loop an event, in arrival order", async () => {
    const fake = fakeKafkajs();
    const bus = new KafkaEventBus<void>(config, { load: async () => fake.module });
    await bus.start();
    const taken: string[] = [];
    await bus.subscribe(async (e) => {
      taken.push(e.id);
    });

    expect(fake.state.groupId).toBe("dm-runtime");
    expect(fake.state.subscribedTo).toEqual([{ topic: "dm.events", fromBeginning: false }]);

    await fake.state.deliver!({ key: "s1", value: JSON.stringify(event("e1")) });
    await fake.state.deliver!({ key: "s1", value: JSON.stringify(event("e2")) });

    expect(taken).toEqual(["e1", "e2"]);
    await bus.close();
  });

  /**
   * A topic is a door into the loop, and it has to be exactly as wide as the HTTP one. Anything
   * on it is parsed against the same contract, so changing the channel cannot widen what a
   * sensor is able to say.
   */
  it("refuses anything on the topic that is not an event, and says why", async () => {
    const fake = fakeKafkajs();
    const refused: { reason: string }[] = [];
    const bus = new KafkaEventBus<void>(config, { load: async () => fake.module, onRefused: (r) => refused.push(r) });
    await bus.start();
    const taken: string[] = [];
    await bus.subscribe(async (e) => {
      taken.push(e.id);
    });

    await fake.state.deliver!({ key: "s1", value: null });
    await fake.state.deliver!({ key: "s1", value: "not json at all" });
    await fake.state.deliver!({ key: "s1", value: JSON.stringify({ id: "x" }) });
    await fake.state.deliver!({ key: "s1", value: JSON.stringify({ ...event("ctrl"), sessionId: "a\u0007b" }) });

    expect(taken).toEqual([]);
    expect(refused).toHaveLength(4);
    expect(refused.map((r) => r.reason)).toEqual(["empty", "not json", "not an event", "not an event"]);
    await bus.close();
  });

  /** A message bigger than the HTTP door accepts is not made acceptable by arriving on a topic. */
  it("refuses a message larger than the runtime's own body limit", async () => {
    const fake = fakeKafkajs();
    const refused: { reason: string }[] = [];
    const bus = new KafkaEventBus<void>(config, { load: async () => fake.module, onRefused: (r) => refused.push(r) });
    await bus.start();
    await bus.subscribe(async () => undefined);

    const huge = JSON.stringify({ ...event("big"), payload: { blob: "x".repeat(2_000_000) } });
    await fake.state.deliver!({ key: "s1", value: huge });

    expect(refused.map((r) => r.reason)).toEqual(["too large"]);
    await bus.close();
  });

  /**
   * Nobody is waiting on a consumed event, so a failure in the loop has nowhere to be returned
   * to. Letting it out of `eachMessage` would make the broker hand the same message back for
   * ever, and that partition — every session on it — would never move again.
   */
  it("reports a loop failure instead of handing the message back to the broker for ever", async () => {
    const fake = fakeKafkajs();
    const failures: { eventId: string; error: string }[] = [];
    const bus = new KafkaEventBus<void>(config, { load: async () => fake.module, onFailed: (f) => failures.push(f) });
    await bus.start();
    await bus.subscribe(async () => {
      throw new Error("the session queue was full");
    });

    await expect(fake.state.deliver!({ key: "s1", value: JSON.stringify(event("e1")) })).resolves.toBeUndefined();

    expect(failures).toEqual([{ sessionId: "s1", eventId: "e1", error: "the session queue was full" }]);
    await bus.close();
  });
});

describe("closing the kafka channel", () => {
  it("disconnects both ends and refuses to publish afterwards", async () => {
    const fake = fakeKafkajs();
    const bus = new KafkaEventBus<void>(config, { load: async () => fake.module });
    await bus.start();
    await bus.subscribe(async () => undefined);
    expect(fake.state.producerConnected).toBe(true);
    expect(fake.state.consumerConnected).toBe(true);

    await bus.close();

    expect(fake.state.producerConnected).toBe(false);
    expect(fake.state.consumerConnected).toBe(false);
    await expect(bus.publish(event("after"))).rejects.toThrow(/closed/i);
  });
});

/**
 * Asking for kafka and not getting it has exactly one honest answer: say what is missing and
 * stop. Falling back to the channel inside the process would leave somebody watching a topic
 * that nothing is ever written to, certain that their runtime is on it.
 */
describe("asking for kafka and not getting it", () => {
  it("stops with what is missing and what to do, when kafkajs is not installed", async () => {
    const bus = new KafkaEventBus<void>(config, {
      load: async () => {
        throw new Error("Cannot find module 'kafkajs'");
      },
    });
    await expect(bus.start()).rejects.toThrow(/kafkajs/);
    await expect(bus.start()).rejects.toThrow(/pnpm add/);
  });

  it("stops when what it loaded is not kafkajs", async () => {
    const bus = new KafkaEventBus<void>(config, { load: async () => ({ nope: true }) });
    await expect(bus.start()).rejects.toThrow(/kafkajs/);
  });

  it("stops with the broker addresses it could not reach", async () => {
    const fake = fakeKafkajs();
    fake.state.failConnect = "ECONNREFUSED";
    const bus = new KafkaEventBus<void>(config, { load: async () => fake.module });
    await expect(bus.start()).rejects.toThrow(/127\.0\.0\.1:9092/);
    await expect(bus.start()).rejects.toThrow(/ECONNREFUSED/);
  });

  it("never answers with the in-process channel instead", async () => {
    const load = vi.fn(async () => {
      throw new Error("Cannot find module 'kafkajs'");
    });
    await expect(createEventBus({ DM_EVENT_BUS: "kafka" }, { load })).rejects.toThrow(/kafkajs/);
    expect(load).toHaveBeenCalled();
  });
});

describe("choosing a channel", () => {
  it("gives the in-process one by default, without reaching for kafkajs at all", async () => {
    const load = vi.fn(async () => ({}));
    const bus = await createEventBus({}, { load });
    expect(bus.via).toBe("inproc");
    expect(load).not.toHaveBeenCalled();
    await bus.close();
  });

  it("gives the kafka one when asked, already connected", async () => {
    const fake = fakeKafkajs();
    const bus = await createEventBus({ DM_EVENT_BUS: "kafka", DM_KAFKA_TOPIC: "dm.events" }, { load: async () => fake.module });
    expect(bus.via).toBe("kafka");
    expect(fake.state.producerConnected).toBe(true);
    await bus.close();
  });
});
