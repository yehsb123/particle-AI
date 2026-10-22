import { describe, it, expect } from "vitest";
import { DEFAULT_KAFKA_BROKERS, DEFAULT_KAFKA_GROUP_ID, DEFAULT_KAFKA_TOPIC, eventBusConfig } from "./config";

const kafka = (env: NodeJS.ProcessEnv) => eventBusConfig({ DM_EVENT_BUS: "kafka", ...env });

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
      ssl: false,
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
      ssl: false,
    });
  });

  it("takes the topic and the consumer group", () => {
    const cfg = eventBusConfig({ DM_EVENT_BUS: "kafka", DM_KAFKA_TOPIC: "dm.events", DM_KAFKA_GROUP_ID: "dm-runtime-2" });
    expect(cfg).toMatchObject({ topic: "dm.events", groupId: "dm-runtime-2" });
  });
});

/**
 * A broker is reached the way a broker is reached: TLS and SASL, both off by default because the
 * broker the compose file brings up is on loopback and speaks neither. The password comes from
 * the environment and goes nowhere else — not into a message, not into a log line.
 */
describe("reaching a broker that asks who you are", () => {
  it("speaks plaintext and says nothing about itself unless told to", () => {
    expect(kafka({})).toMatchObject({ ssl: false });
    expect(kafka({})).not.toHaveProperty("sasl");
  });

  it("takes TLS on its own", () => {
    expect(kafka({ DM_KAFKA_SSL: "1" })).toMatchObject({ ssl: true });
    expect(kafka({ DM_KAFKA_SSL: "0" })).toMatchObject({ ssl: false });
  });

  it("takes a mechanism with a username and a password", () => {
    expect(
      kafka({
        DM_KAFKA_SSL: "true",
        DM_KAFKA_SASL_MECHANISM: "scram-sha-512",
        DM_KAFKA_SASL_USERNAME: "runtime",
        DM_KAFKA_SASL_PASSWORD: "hunter2",
      }),
    ).toMatchObject({ ssl: true, sasl: { mechanism: "scram-sha-512", username: "runtime", password: "hunter2" } });
  });

  it("refuses a mechanism no broker has", () => {
    expect(() => kafka({ DM_KAFKA_SASL_MECHANISM: "kerberos", DM_KAFKA_SASL_USERNAME: "u", DM_KAFKA_SASL_PASSWORD: "p" })).toThrow(
      /DM_KAFKA_SASL_MECHANISM/,
    );
  });

  it("refuses half a login, naming the half that is missing", () => {
    expect(() => kafka({ DM_KAFKA_SASL_MECHANISM: "plain", DM_KAFKA_SASL_USERNAME: "u" })).toThrow(/DM_KAFKA_SASL_PASSWORD/);
    expect(() => kafka({ DM_KAFKA_SASL_MECHANISM: "plain", DM_KAFKA_SASL_PASSWORD: "p" })).toThrow(/DM_KAFKA_SASL_USERNAME/);
    expect(() => kafka({ DM_KAFKA_SASL_USERNAME: "u", DM_KAFKA_SASL_PASSWORD: "p" })).toThrow(/DM_KAFKA_SASL_MECHANISM/);
  });

  /** An error message is read in a terminal, pasted into an issue and kept in a log file. */
  it("never puts the password in the message when it refuses", () => {
    const tries: NodeJS.ProcessEnv[] = [
      { DM_KAFKA_SASL_MECHANISM: "kerberos", DM_KAFKA_SASL_USERNAME: "u", DM_KAFKA_SASL_PASSWORD: "hunter2" },
      { DM_KAFKA_SASL_USERNAME: "u", DM_KAFKA_SASL_PASSWORD: "hunter2" },
      { DM_KAFKA_SASL_MECHANISM: "plain", DM_KAFKA_SASL_PASSWORD: "hunter2" },
      { DM_KAFKA_SASL_MECHANISM: "plain", DM_KAFKA_SASL_USERNAME: "u", DM_KAFKA_SASL_PASSWORD: " " },
      { DM_KAFKA_BROKERS: "not a broker", DM_KAFKA_SASL_MECHANISM: "plain", DM_KAFKA_SASL_USERNAME: "u", DM_KAFKA_SASL_PASSWORD: "hunter2" },
    ];
    for (const env of tries) {
      try {
        kafka(env);
        expect.unreachable(`expected ${JSON.stringify(Object.keys(env))} to be refused`);
      } catch (err) {
        expect((err as Error).message, JSON.stringify(Object.keys(env))).not.toContain("hunter2");
      }
    }
  });
});

/**
 * `DM_INGEST_TOKEN` is how somebody says who may put events into this runtime, and the HTTP door
 * holds everyone to it. A topic is a second door into the same loop: anyone who can write to it
 * can hand the loop an event, and no token is asked for there. So a runtime that is holding
 * callers to a token and is pointed at a broker it does not authenticate to does not start.
 *
 * A loopback broker is excepted because reaching it already means being on this machine, which
 * is exactly what the runtime's default bind address assumes.
 */
describe("a token on the front door and a topic open at the back", () => {
  const token = { DM_INGEST_TOKEN: "s3cret" };

  it("stops, naming what is empty and what would fill it", () => {
    const fail = () => kafka({ ...token, DM_KAFKA_BROKERS: "broker.internal:9092" });
    expect(fail).toThrow(/DM_INGEST_TOKEN/);
    expect(fail).toThrow(/DM_KAFKA_SASL_MECHANISM/);
  });

  it("says nothing when the brokers are on this machine", () => {
    for (const brokers of ["127.0.0.1:9092", "localhost:9092", "[::1]:9092", "localhost:9092,127.0.0.1:9093"]) {
      expect(() => kafka({ ...token, DM_KAFKA_BROKERS: brokers }), brokers).not.toThrow();
    }
  });

  it("stops when only some of the brokers are on this machine", () => {
    expect(() => kafka({ ...token, DM_KAFKA_BROKERS: "127.0.0.1:9092,broker.internal:9092" })).toThrow(/DM_INGEST_TOKEN/);
  });

  it("is satisfied by a login to the broker", () => {
    expect(() =>
      kafka({
        ...token,
        DM_KAFKA_BROKERS: "broker.internal:9092",
        DM_KAFKA_SSL: "1",
        DM_KAFKA_SASL_MECHANISM: "scram-sha-512",
        DM_KAFKA_SASL_USERNAME: "runtime",
        DM_KAFKA_SASL_PASSWORD: "hunter2",
      }),
    ).not.toThrow();
  });

  it("leaves a runtime that holds nobody to a token alone", () => {
    expect(() => kafka({ DM_KAFKA_BROKERS: "broker.internal:9092" })).not.toThrow();
    expect(() => kafka({ DM_INGEST_TOKEN: "", DM_KAFKA_BROKERS: "broker.internal:9092" })).not.toThrow();
  });

  it("has nothing to say while the channel is the in-process one", () => {
    expect(eventBusConfig({ ...token, DM_KAFKA_BROKERS: "broker.internal:9092" })).toEqual({ kind: "inproc" });
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
