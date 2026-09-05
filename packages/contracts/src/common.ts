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
export const MAX_IDENTIFIER = 120;

/**
 * The name of a session.
 *
 * Anything can name one: the body takes it from its own query string, the extension and the
 * desktop agent each carry a fixed one, and any process that can reach the runtime may invent one
 * in an event it posts. It is not a caption — it is a key. It selects a belief, a map entry, an
 * audit trail, a snapshot row and a broadcast, so it is refused rather than trimmed: two names cut
 * to the same length would be one session, and a name carrying control characters would be written
 * into every log line, every trace and every listing that names it.
 *
 * Unbounded it also travelled: a two-hundred-thousand character id made every world-state
 * broadcast for that session six hundred kilobytes of nothing but its own name.
 */
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/;
export const SessionId = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER)
  .refine((s) => !CONTROL_CHARACTER.test(s), {
    message: "a session name may not carry control characters",
  });
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
