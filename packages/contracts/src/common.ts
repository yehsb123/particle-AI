import { z } from "zod";

/** ISO-8601 timestamp string. We pass time in explicitly (never Date.now() in pure code). */
/**
 * A timestamp the runtime can turn back into a clock. Replay derives its clock from these, so a
 * value `Date.parse` cannot read would make every guard comparison false and quietly drop the
 * cooldowns. The format is checked here rather than trusted.
 */
export const IsoTimestamp = z
  .string()
  .min(1)
  .refine((s) => Number.isFinite(Date.parse(s)), { message: "not a readable timestamp" });
export type IsoTimestamp = z.infer<typeof IsoTimestamp>;

export const Confidence = z.number().min(0).max(1);
export type Confidence = z.infer<typeof Confidence>;

export const Severity = z.enum([
  "debug",
  "info",
  "notice",
  "warning",
  "critical",
]);
export type Severity = z.infer<typeof Severity>;

/** Ordinal used by significance/guard math. Higher = more severe. */
export const SEVERITY_RANK: Record<Severity, number> = {
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  critical: 4,
};

/**
 * How much of a name travels: a path, a host, a branch, an action key. The sensors observe names
 * this machine already holds, and a name long enough to be prose is no longer a shape. Each
 * sensor trims to this before sending and the world model trims again on the way in, because a
 * sensor is not the only thing that can post an event.
 */
/**
 * A number somebody put in the environment, or the default when they did not.
 *
 * `Number()` alone is the wrong reader for this. An empty value is the ordinary way an env file
 * says nothing — `.env.example` ships several — and `Number("")` is 0, not "unset". Measured,
 * before this: `DM_AGENT_DEBOUNCE_MS=` made the debounce 0 and the sensor sent an event per save
 * instead of one per burst, and `DM_PORT=` opened the runtime on a random free port that nothing
 * else in the system knows how to reach. Both silently.
 *
 * So: nothing means the default, and something unusable is refused out loud rather than turned
 * into a number nobody asked for. A person who typed a value meant it, and the answer to a value
 * that cannot be used is to say so at startup, not to run differently and never mention it.
 */
export function envNumber(raw: unknown, fallback: number, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (raw === undefined || raw === null) return fallback;
  const text = String(raw).trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number between ${min} and ${max}; got ${JSON.stringify(text)}`);
  }
  return value;
}

export const MAX_IDENTIFIER = 120;

/**
 * How many sensors one session tracks, and how many layers one of them may declare.
 *
 * There are three sensors — the body, the extension, the desktop agent — and both the name and the
 * layer list come from an event payload, so these are ceilings rather than limits anyone should
 * meet. They live here because two places have to agree on them: the reducer that folds a live
 * event into the belief, and the schema that reads a belief back off a snapshot.
 */
/**
 * A name in restored memory: a preference key or a pattern key.
 *
 * Both are composed the same way — a short fixed prefix plus a name this runtime already holds to
 * MAX_IDENTIFIER (an event type, or the variant a model chose). The longest the live path can make
 * is around a hundred and forty characters, so this has room and is a ceiling rather than a limit.
 *
 * It matters because memory is restored from the browser's own storage and from snapshots, which
 * the live path never touches. A key is a key: it selects a learned behaviour and it is written
 * back out again on every export, so it is refused rather than cut — two keys cut to the same
 * length would be one learned preference.
 */
export const MAX_MEMORY_KEY = 200;

/** The characters that are not writing; shared by every name rule below. */
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/;

/**
 * A composed key: a short fixed prefix plus a name already held to MAX_IDENTIFIER. Identifier
 * itself is the wrong rule here — its length is meant for one name, and the longest key the live
 * path composes is a hundred and thirty nine characters, which Identifier would refuse.
 */
export const MemoryKey = z
  .string()
  .min(1)
  .max(MAX_MEMORY_KEY)
  .refine((s) => !CONTROL_CHARACTER.test(s), {
    message: "a key the runtime acts on may not carry control characters",
  });
export type MemoryKey = z.infer<typeof MemoryKey>;

/**
 * How much reinforcement one memory entry may claim. Both are counts that grow by one at a time:
 * a dismissal of the same variant, or a repetition of the same flow. A person would have to do
 * either a thousand times to reach this, and the threshold that acts on them is two.
 */
export const MAX_MEMORY_WEIGHT = 1_000;

export const MAX_SENSORS = 16;
export const MAX_SENSOR_LAYERS = 16;


/**
 * A name the runtime acts on: it selects something, or the runtime routes on it.
 *
 * Unlike a caption, such a name is refused rather than trimmed. Trimming makes different things
 * identical — two names cut to the same length would be one session, one event, one type — and a
 * name carrying control characters is written into every log line, trace and listing showing it.
 */
export const Identifier = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER)
  .refine((s) => !CONTROL_CHARACTER.test(s), {
    message: "a name the runtime acts on may not carry control characters",
  });
export type Identifier = z.infer<typeof Identifier>;

/**
 * The name of a session.
 *
 * Anything can name one: the body takes it from its own query string, the extension and the
 * desktop agent each carry a fixed one, and any process that can reach the runtime may invent one
 * in an event it posts. It is not a caption — it is a key. It selects a belief, a map entry, an
 * audit trail, a snapshot row and a broadcast.
 *
 * Unbounded it also travelled: a two-hundred-thousand character name made every world-state
 * broadcast for that session six hundred kilobytes of nothing but itself.
 */
export const SessionId = Identifier;
export type SessionId = z.infer<typeof SessionId>;

/**
 * How many fields of an event's payload the belief keeps.
 *
 * The belief holds a short list of recent events so the runtime can tell a repeat from a novelty.
 * It kept each one whole, and that list is sent to every body watching the session on every
 * change, written into every snapshot, and serialised into every prompt a provider is given —
 * so one noisy sender's payloads rode along in all three. A payload is meant to be shape: a path,
 * a host, a status. This is far past any of that.
 */
export const MAX_PAYLOAD_FIELDS = 24;

/**
 * What a capability can do to the world outside the runtime, from least to most. The order is
 * the order: the permission engine decides what runs on its own by how far down this list a
 * capability sits, and the body names each of them to the person being asked to allow one.
 */
export const RISK_LEVELS = ["read", "safe_write", "external_effect", "destructive"] as const;

export const RiskLevel = z.enum(RISK_LEVELS);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const AutonomyLevel = z.union([
  z.literal(0), // manual
  z.literal(1), // suggestive
  z.literal(2), // adaptive UI (MVP default)
  z.literal(3), // assisted action
  z.literal(4), // autonomous
]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;
