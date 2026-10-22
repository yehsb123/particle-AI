import { describe, it, expect } from "vitest";
import { DEFAULT_KAFKA_BROKERS, DEFAULT_KAFKA_GROUP_ID, DEFAULT_KAFKA_TOPIC, eventBusConfig } from "./config";

/**
 * Which channel the runtime uses, read from the environment.
 *
 * Everything here comes from outside the process, so it is parsed rather than read: a broker
 * list, a topic and a group name all end up in calls to somebody else's cluster, and a spelling
 * nobody defined has to be refused at startup instead of turning into a channel the person
 * running it did not ask for. Saying nothing means the in-process channel — the way it has always
 * worked, with nothing installed and no broker anywhere.
 */
describe("saying nothing", () => {
  it("leaves the runtime on the channel it has always used", () => {
    expect(eventBusConfig({})).toEqual({ kind: "inproc" });
    expect(eventBusConfig({ DM_EVENT_BUS: "" })).toEqual({ kind: "inproc" });
    expect(eventBusConfig({ DM_EVENT_BUS: "  " })).toEqual({ kind: "inproc" });
  });

  it("ignores kafka settings while kafka is off, rather than half-switching", () => {
    expect(eventBusConfig({ DM_KAFKA_BROKERS: "nowhere:9092", DM_KAFKA_TOPIC: "t" })).toEqual({ kind: "inproc" });
  });
});

describe("asking for kafka", () => {
  it("fills in the brokers, topic and group a local broker would have", () => {
    expect(eventBusConfig({ DM_EVENT_BUS: "kafka" })).toEqual({
      kind: "kafka",
      brokers: [DEFAULT_KAFKA_BROKERS],
      topic: DEFAULT_KAFKA_TOPIC,
      groupId: DEFAULT_KAFKA_GROUP_ID,
    });
  });

  it("takes a list of brokers, trimming what a person leaves around the commas", () => {
    const cfg = eventBusConfig({ DM_EVENT_BUS: "kafka", DM_KAFKA_BROKERS: " a:9092 , b:9093 , " });
    expect(cfg).toMatchObject({ brokers: ["a:9092", "b:9093"] });
  });

  /** An empty value is how an env file says nothing; `.env.example` ships several. */
  it("reads an empty setting as the default rather than as an empty list", () => {
    expect(eventBusConfig({ DM_EVENT_BUS: "kafka", DM_KAFKA_BROKERS: "", DM_KAFKA_TOPIC: "", DM_KAFKA_GROUP_ID: "" })).toEqual({
      kind: "kafka",
      brokers: [DEFAULT_KAFKA_BROKERS],
      topic: DEFAULT_KAFKA_TOPIC,
      groupId: DEFAULT_KAFKA_GROUP_ID,
    });
  });

  it("takes the topic and the consumer group", () => {
    const cfg = eventBusConfig({ DM_EVENT_BUS: "kafka", DM_KAFKA_TOPIC: "dm.events", DM_KAFKA_GROUP_ID: "dm-runtime-2" });
    expect(cfg).toMatchObject({ topic: "dm.events", groupId: "dm-runtime-2" });
  });
});

/**
 * A setting that cannot be used is refused out loud at startup. The alternative is a runtime that
 * runs on a channel nobody chose: somebody who typed `DM_EVENT_BUS=Kafka` would be watching an
 * empty topic, and a broker list that is only commas would reach kafkajs as "no brokers".
 */
describe("a setting nobody can act on", () => {
  it("refuses a channel name it does not have, and names the ones it has", () => {
    for (const bad of ["Kafka", "KAFKA", "redis", "in-proc"]) {
      expect(() => eventBusConfig({ DM_EVENT_BUS: bad }), bad).toThrow(/DM_EVENT_BUS/);
    }
    expect(() => eventBusConfig({ DM_EVENT_BUS: "redis" })).toThrow(/inproc, kafka/);
  });

  it("refuses a broker list that is only commas", () => {
    for (const bad of [",", " , "]) {
      expect(() => eventBusConfig({ DM_EVENT_BUS: "kafka", DM_KAFKA_BROKERS: bad }), JSON.stringify(bad)).toThrow(
        /DM_KAFKA_BROKERS/,
      );
    }
  });

  it("refuses a broker address that is not one", () => {
    for (const bad of ["localhost", "localhost:nine", "localhost:9092/extra", "local host:9092", "a:99999"]) {
      expect(() => eventBusConfig({ DM_EVENT_BUS: "kafka", DM_KAFKA_BROKERS: bad }), bad).toThrow(/DM_KAFKA_BROKERS/);
    }
  });

  it("refuses a topic or a group a broker would not take", () => {
    for (const bad of ["has space", "has/slash", "x".repeat(250), "bell\u0007"]) {
      expect(() => eventBusConfig({ DM_EVENT_BUS: "kafka", DM_KAFKA_TOPIC: bad }), JSON.stringify(bad)).toThrow(
        /DM_KAFKA_TOPIC/,
      );
      expect(() => eventBusConfig({ DM_EVENT_BUS: "kafka", DM_KAFKA_GROUP_ID: bad }), JSON.stringify(bad)).toThrow(
        /DM_KAFKA_GROUP_ID/,
      );
    }
  });
});
