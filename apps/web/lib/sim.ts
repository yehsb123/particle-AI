import type { MatterEvent } from "@particle/contracts";

export type SimSpec = {
  label: string;
  /** server-side sim key (POST /api/sim/:id/:key) for connected mode */
  key: string;
  type: string;
  source: MatterEvent["source"];
  severity: MatterEvent["severity"];
  payload?: Record<string, unknown>;
};

/** The simulation lab palette — trigger runtime events without external infrastructure. */
export const SIM_EVENTS: SimSpec[] = [
  { label: "HTTP 500", key: "http-500", type: "development.server_error", source: "development", severity: "critical", payload: { status: 500, route: "/users/42" } },
  { label: "Build failed", key: "build-failed", type: "development.build_failed", source: "development", severity: "warning", payload: { errors: 1 } },
  { label: "Test failed", key: "test-failed", type: "development.test_failed", source: "development", severity: "warning", payload: { failing: 2 } },
  { label: "Service recovered", key: "recovered", type: "development.server_recovered", source: "development", severity: "info" },
  { label: "Build succeeded", key: "build-ok", type: "development.build_succeeded", source: "development", severity: "info" },
  { label: "High CPU", key: "high-cpu", type: "system.resource_warning", source: "system", severity: "warning", payload: { cpu: 0.94 } },
  { label: "Critical alert", key: "critical-alert", type: "external.alert", source: "external", severity: "critical" },
];

export function buildEvent(spec: SimSpec, sessionId: string, id: string, timestamp: string): MatterEvent {
  return {
    id,
    sessionId,
    timestamp,
    source: spec.source,
    type: spec.type,
    severity: spec.severity,
    payload: spec.payload ?? {},
  };
}
