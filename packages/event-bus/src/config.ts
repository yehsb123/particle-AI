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

export type EventBusConfig =
  | { readonly kind: "inproc" }
  | { readonly kind: "kafka"; readonly brokers: string[]; readonly topic: string; readonly groupId: string };

/** `host:port`. Anything else reaches kafkajs as an address it will fail on later and vaguely. */
const BrokerAddress = z
  .string()
  .regex(/^[A-Za-z0-9._-]+:\d{1,5}$/, "each broker must be host:port")
  .refine((s) => {
    const port = Number(s.slice(s.lastIndexOf(":") + 1));
    return port >= 1 && port <= 65_535;
  }, "each broker's port must be between 1 and 65535");

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

  return {
    kind: "kafka",
    brokers,
    topic: setting(KafkaName, text(env.DM_KAFKA_TOPIC), DEFAULT_KAFKA_TOPIC, "DM_KAFKA_TOPIC"),
    groupId: setting(KafkaName, text(env.DM_KAFKA_GROUP_ID), DEFAULT_KAFKA_GROUP_ID, "DM_KAFKA_GROUP_ID"),
  };
}
