import { z } from "zod";
import { IsoTimestamp, MAX_IDENTIFIER, MAX_PAYLOAD_FIELDS, Severity } from "./common";

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

export const MatterEvent = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  timestamp: IsoTimestamp,
  source: EventSource,
  /** dotted type, e.g. "development.server_error", "user.opened_file" */
  type: z.string().min(1),
  severity: Severity,
  payload: z.record(z.unknown()),
  metadata: z.record(z.unknown()).optional(),
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
