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

/** Well-known event types used by the reference simulation. Not exhaustive. */
export const KNOWN_EVENT_TYPES = [
  "user.opened_file",
  "user.selected_component",
  "user.changed_goal",
  "user.focus_changed",
  "user.requested_undo",
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
] as const;
export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];
