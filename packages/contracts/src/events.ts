import { z } from "zod";
import { Identifier, IsoTimestamp, MAX_IDENTIFIER, MAX_PAYLOAD_FIELDS, SessionId, Severity } from "./common";

/** Control characters: a name carrying an escape sequence is read by a terminal, not a person. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

export const EventSource = z.enum([
  "user",
  "system",
  "application",
  "tool",
  "model",
  "sensor",
  "development",
  "external",
]);
export type EventSource = z.infer<typeof EventSource>;

/**
 * An event with its payload reduced to the shape a payload is supposed to be: a path, a host, a
 * status. Strings are held to the length every other identifier is and stripped of what is not
 * writing; anything nested or listed is content rather than shape and is left behind.
 *
 * Two places need this, and they need the same answer. The belief keeps a short list of recent
 * events, and that list is broadcast, snapshotted and put in every prompt. The decision engine
 * hands a provider the event being decided about, and one event carrying a hundred kilobytes was
 * ninety per cent of the prompt on its own.
 *
 * What is NOT shaped is what the runtime decides with: the significance reflex reads the raw
 * event, because that is the sensor's report and the numbers in it are the signal.
 */
export function shapeOfEvent(event: MatterEvent): MatterEvent {
  const payload: Record<string, unknown> = {};
  let kept = 0;
  for (const [key, value] of Object.entries(event.payload)) {
    if (kept >= MAX_PAYLOAD_FIELDS) break;
    if (typeof value === "string") {
      const clean = value.replace(CONTROL_CHARACTERS, "");
      payload[key] = clean.length > MAX_IDENTIFIER ? `${clean.slice(0, MAX_IDENTIFIER)}…` : clean;
      kept += 1;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean" || value === null) {
      payload[key] = value;
      kept += 1;
    }
  }
  return { ...event, payload };
}

/**
 * How much of a payload the cleaning walk will visit.
 *
 * A payload is a shape — a path, a host, a status, a count — and the belief keeps at most
 * MAX_PAYLOAD_FIELDS of one. These are far above that on purpose: they are not a working limit,
 * they are the point past which a payload is not a shape at all and the walk stops rather than
 * running as deep as whatever arrived.
 */
export const MAX_PAYLOAD_NODES = 2_000;
export const MAX_PAYLOAD_DEPTH = 32;

/**
 * A payload with the characters that are not writing taken out of its strings, at any depth.
 *
 * A payload was cleaned on the way into the belief and nowhere else, so one event became three
 * different events: the belief held `src/a.ts`, the durable log was handed `src/a<NUL>.ts`, and
 * the caller was answered with the second. On Postgres the stored one is worse than different —
 * a NUL cannot go into a jsonb value at all, so the append throws, and since the append is
 * deliberately best-effort the event is dropped from durable storage with nothing but a warn
 * line. Six such events in a row, six lost, no ingest failed.
 *
 * So it is cleaned once, here, at the door every path comes through — the REST route, the socket,
 * and the body's own in-browser core all parse the same schema. Strings are cleaned rather than
 * dropped and nothing is shortened: the log is meant to keep what a sensor reported, and the
 * shaping the belief needs is still `shapeOfEvent`'s job further in.
 *
 * The walk is iterative and bounded. `undefined` means the payload is past being a shape.
 */
function cleanedDeep(value: unknown): unknown {
  if (typeof value === "string") return value.replace(CONTROL_CHARACTERS, "");
  if (!value || typeof value !== "object") return value;
  const root: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {};
  let visited = 0;
  const pending: { from: unknown; to: unknown[] | Record<string, unknown>; depth: number }[] = [
    { from: value, to: root, depth: 1 },
  ];
  while (pending.length > 0) {
    const step = pending.pop();
    if (!step) break;
    if (step.depth > MAX_PAYLOAD_DEPTH) return undefined;
    for (const [key, child] of Object.entries(step.from as Record<string, unknown>)) {
      if (++visited > MAX_PAYLOAD_NODES) return undefined;
      const put = (v: unknown) => {
        // a payload key may be "__proto__"; an own property is written whatever the name is
        Object.defineProperty(step.to, key, { value: v, enumerable: true, writable: true, configurable: true });
      };
      if (typeof child === "string") put(child.replace(CONTROL_CHARACTERS, ""));
      else if (child && typeof child === "object") {
        const nested: unknown[] | Record<string, unknown> = Array.isArray(child) ? [] : {};
        put(nested);
        pending.push({ from: child, to: nested, depth: step.depth + 1 });
      } else put(child);
    }
  }
  return root;
}

/** The record a payload and a metadata block are: cleaned, or refused for not being a shape. */
const PayloadRecord = z
  .record(z.unknown())
  .transform((record, ctx) => {
    const cleaned = cleanedDeep(record);
    if (cleaned === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "deeper or wider than a payload is" });
      return z.NEVER;
    }
    return cleaned as Record<string, unknown>;
  });

export const MatterEvent = z.object({
  /**
   * An event's own name and its type are things the runtime acts on rather than shows, and both
   * were unbounded. A two-hundred-thousand character type made the trace behind that event four
   * hundred kilobytes, and the same again in the world-state broadcast, the events listing, the
   * snapshot and the prompt — the belief keeps a recent event whole apart from its payload. An
   * escape sequence in a type reached the inspector row a person reads to find out why their body
   * changed. The longest type this runtime knows is thirty-one characters.
   */
  id: Identifier,
  sessionId: SessionId,
  timestamp: IsoTimestamp,
  source: EventSource,
  /** dotted type, e.g. "development.server_error", "user.opened_file" */
  type: Identifier,
  severity: Severity,
  payload: PayloadRecord,
  metadata: PayloadRecord.optional(),
});
export type MatterEvent = z.infer<typeof MatterEvent>;

/**
 * The event types the runtime knows how to read: what a person does, what their work does, what
 * the sensors report, and its own bookkeeping. A type outside this list is still accepted — the
 * vocabulary is open, and an unknown type simply opens no problem and changes no behaviour.
 */
export const KNOWN_EVENT_TYPES = [
  // what a person does
  "user.opened_file",
  "user.selected_component",
  "user.changed_goal",
  "user.focus_changed",
  "user.requested_undo",
  "user.requested_action",
  "user.interaction",
  "user.idle",
  "user.visibility",
  "user.action",
  // what the work does
  "development.build_started",
  "development.build_failed",
  "development.build_succeeded",
  "development.test_failed",
  "development.test_passed",
  "development.server_error",
  "development.server_recovered",
  "system.resource_warning",
  "tool.execution_started",
  "tool.execution_failed",
  "tool.execution_completed",
  // what the sensors report (Concept v2): traffic shape, security, and what each sensor watches
  "network.request",
  "security.vulnerability_detected",
  "security.vulnerability_patched",
  "external.alert",
  "sensor.layers_changed",
  // the runtime's own bookkeeping
  "runtime.reconcile",
] as const;
export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];
