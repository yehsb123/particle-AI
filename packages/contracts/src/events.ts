import { z } from "zod";
import { IsoTimestamp, Severity } from "./common";

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
