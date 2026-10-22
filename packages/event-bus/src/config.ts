import { z } from "zod";
import { EVENT_BUS_KINDS } from "./bus";

/**
 * Which channel to use, and where the broker is, as the environment says it.
 *
 * Every value here comes from outside this process and every one of them is acted on: a channel
 * name selects an implementation, a broker list is dialled, a topic and a group are sent to
 * somebody else's cluster. So they are parsed, not read — a value that cannot be used stops the
 * runtime at startup with its own name in the message, rather than becoming a channel nobody
 * chose. An empty value is how an env file says nothing, and means the default.
 */
export const DEFAULT_KAFKA_BROKERS = "127.0.0.1:9092";
export const DEFAULT_KAFKA_TOPIC = "digital-matter.events";
export const DEFAULT_KAFKA_GROUP_ID = "digital-matter-runtime";

/** What a broker may ask for. Both off by default: a loopback broker asks for neither. */
export const SASL_MECHANISMS = ["plain", "scram-sha-256", "scram-sha-512"] as const;
export type SaslMechanism = (typeof SASL_MECHANISMS)[number];
export type KafkaLogin = { readonly mechanism: SaslMechanism; readonly username: string; readonly password: string };

export type EventBusConfig =
  | { readonly kind: "inproc" }
  | {
      readonly kind: "kafka";
      readonly brokers: string[];
      readonly topic: string;
      readonly groupId: string;
      readonly ssl: boolean;
      readonly sasl?: KafkaLogin;
    };

/**
 * `host:port`, with `[::1]:9092` for an address that has colons of its own. Anything else reaches
 * kafkajs as an address it will fail on later and vaguely.
 */
const BrokerAddress = z
  .string()
  .regex(/^(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:]+\]):\d{1,5}$/, "each broker must be host:port")
  .refine((s) => {
    const port = Number(s.slice(s.lastIndexOf(":") + 1));
    return port >= 1 && port <= 65_535;
  }, "each broker's port must be between 1 and 65535");

/** The names that mean "this machine", which is where the compose file's broker lives. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

function hostOf(broker: string): string {
  const port = broker.lastIndexOf(":");
  const host = port === -1 ? broker : broker.slice(0, port);
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

/**
 * A switch somebody put in the environment, read the way every other switch here is read
 * (`envFlag` in `packages/screen-capture/src/config.ts`): nothing means off, a value that says no
 * means off, and a value that says neither is refused rather than guessed at.
 */
const TRUE_WORDS = new Set(["1", "true", "yes", "on"]);
const FALSE_WORDS = new Set(["0", "false", "no", "off"]);
function flag(raw: string | undefined, name: string): boolean {
  if (raw === undefined) return false;
  const value = raw.toLowerCase();
  if (TRUE_WORDS.has(value)) return true;
  if (FALSE_WORDS.has(value)) return false;
  throw new Error(`${name} must be one of 1/true/yes/on or 0/false/no/off; got ${JSON.stringify(raw)}`);
}

/** What a broker accepts as a topic or a group name: letters, digits, dot, underscore, dash. */
const KafkaName = z.string().min(1).max(249).regex(/^[A-Za-z0-9._-]+$/, "may only contain letters, digits, . _ -");

const BusKind = z.enum(EVENT_BUS_KINDS);

function text(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim();
  return value ? value : undefined;
}

/** Parse one setting, or say which setting was wrong and what it would have to be. */
function setting<T>(schema: z.ZodType<T>, raw: string | undefined, fallback: T, name: string): T {
  if (raw === undefined) return fallback;
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const why = parsed.error.issues.map((i) => i.message).join("; ");
    throw new Error(`${name} is not usable: ${why}; got ${JSON.stringify(raw)}`);
  }
  return parsed.data;
}

export function eventBusConfig(env: NodeJS.ProcessEnv): EventBusConfig {
  const named = text(env.DM_EVENT_BUS);
  if (named === undefined) return { kind: "inproc" };
  const kind = BusKind.safeParse(named);
  if (!kind.success) {
    throw new Error(`DM_EVENT_BUS must be one of ${EVENT_BUS_KINDS.join(", ")}; got ${JSON.stringify(named)}`);
  }
  if (kind.data === "inproc") return { kind: "inproc" };

  const rawBrokers = text(env.DM_KAFKA_BROKERS);
  const brokers = setting(
    // A list is split before it is parsed, so the message names the address that is wrong rather
    // than refusing the whole line. Empty pieces are a person's commas, not addresses.
    z
      .string()
      .transform((s) => s.split(",").map((p) => p.trim()).filter(Boolean))
      .pipe(z.array(BrokerAddress).min(1, "needs at least one host:port")),
    rawBrokers,
    [DEFAULT_KAFKA_BROKERS],
    "DM_KAFKA_BROKERS",
  );

  const sasl = login(env);
  const config: EventBusConfig = {
    kind: "kafka",
    brokers,
    topic: setting(KafkaName, text(env.DM_KAFKA_TOPIC), DEFAULT_KAFKA_TOPIC, "DM_KAFKA_TOPIC"),
    groupId: setting(KafkaName, text(env.DM_KAFKA_GROUP_ID), DEFAULT_KAFKA_GROUP_ID, "DM_KAFKA_GROUP_ID"),
    ssl: flag(text(env.DM_KAFKA_SSL), "DM_KAFKA_SSL"),
    ...(sasl ? { sasl } : {}),
  };
  refuseAnOpenBackDoor(env, config);
  return config;
}

/**
 * How this runtime says who it is to a broker, or nothing when it says nothing.
 *
 * The three settings are one thing: a mechanism with no password is not "half configured", it is
 * a runtime that will fail to connect for a reason nobody can see from the outside. The password
 * is never put in a message here, because a message is read in a terminal, pasted into an issue
 * and kept in a log file.
 */
function login(env: NodeJS.ProcessEnv): KafkaLogin | undefined {
  const mechanism = text(env.DM_KAFKA_SASL_MECHANISM);
  const username = text(env.DM_KAFKA_SASL_USERNAME);
  const hasPassword = text(env.DM_KAFKA_SASL_PASSWORD) !== undefined;
  if (mechanism === undefined && username === undefined && !hasPassword) return undefined;
  if (mechanism === undefined) throw new Error("DM_KAFKA_SASL_MECHANISM is needed alongside the SASL username and password");
  const parsed = z.enum(SASL_MECHANISMS).safeParse(mechanism);
  if (!parsed.success) {
    throw new Error(`DM_KAFKA_SASL_MECHANISM must be one of ${SASL_MECHANISMS.join(", ")}; got ${JSON.stringify(mechanism)}`);
  }
  if (username === undefined) throw new Error("DM_KAFKA_SASL_USERNAME is needed alongside DM_KAFKA_SASL_MECHANISM");
  if (!hasPassword) throw new Error("DM_KAFKA_SASL_PASSWORD is needed alongside DM_KAFKA_SASL_MECHANISM");
  return { mechanism: parsed.data, username, password: env.DM_KAFKA_SASL_PASSWORD as string };
}

/**
 * A topic is a second door into the same loop.
 *
 * `DM_INGEST_TOKEN` is how somebody says who may put events into this runtime, and every HTTP
 * read and write is held to it. Nothing holds a topic to it: whoever can write to the topic can
 * hand the loop an event, and the consumer will run it. Leaving that open while the front door is
 * locked is worse than having no lock, because the person who set the token believes there is one.
 *
 * So: a runtime holding callers to a token, pointed at a broker it does not authenticate to,
 * does not start. A loopback broker is excepted — reaching it already means being on this
 * machine, which is what the runtime's own default bind address assumes.
 */
function refuseAnOpenBackDoor(env: NodeJS.ProcessEnv, config: EventBusConfig): void {
  if (config.kind !== "kafka") return;
  if (text(env.DM_INGEST_TOKEN) === undefined) return;
  if (config.sasl) return;
  const remote = config.brokers.filter((b) => !LOOPBACK.has(hostOf(b)));
  if (!remote.length) return;
  throw new Error(
    `DM_INGEST_TOKEN holds every HTTP caller to a token, but the kafka topic is a second way into the same loop ` +
      `and ${remote.join(", ")} is not on this machine: set DM_KAFKA_SASL_MECHANISM, DM_KAFKA_SASL_USERNAME and ` +
      `DM_KAFKA_SASL_PASSWORD (with DM_KAFKA_SSL=1), point DM_KAFKA_BROKERS at a loopback broker, or unset DM_INGEST_TOKEN.`,
  );
}
