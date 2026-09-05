import type { MatterEvent } from "./events";

/**
 * The simulation palette: the events a person can trigger by hand to watch the runtime react,
 * with no external infrastructure at all.
 *
 * It lives here because both sides of the demo need it and neither can be the source. The body
 * builds these itself in local mode, where there is no runtime to ask, and the runtime builds
 * them in connected mode, where the body only sends a key. Each side used to carry its own copy,
 * and they had already drifted: the same two buttons sent different payloads depending on which
 * mode the person happened to be in, which is exactly the difference connected mode is supposed
 * not to have.
 */
export type SimSpec = {
  /** what the button says */
  label: string;
  /** how the body names this event to the runtime: POST /api/sim/:session/:key */
  key: string;
  type: string;
  source: MatterEvent["source"];
  severity: MatterEvent["severity"];
  payload?: Record<string, unknown>;
};

export const SIM_EVENTS: readonly SimSpec[] = [
  { label: "HTTP 500", key: "http-500", type: "development.server_error", source: "development", severity: "critical", payload: { status: 500, route: "/users/42" } },
  { label: "Build failed", key: "build-failed", type: "development.build_failed", source: "development", severity: "warning", payload: { errors: 1 } },
  { label: "Test failed", key: "test-failed", type: "development.test_failed", source: "development", severity: "warning", payload: { failing: 2 } },
  { label: "Service recovered", key: "recovered", type: "development.server_recovered", source: "development", severity: "info" },
  { label: "Build succeeded", key: "build-ok", type: "development.build_succeeded", source: "development", severity: "info" },
  { label: "High CPU", key: "high-cpu", type: "system.resource_warning", source: "system", severity: "warning", payload: { cpu: 0.94 } },
  { label: "Vulnerability found", key: "vuln", type: "security.vulnerability_detected", source: "external", severity: "critical", payload: { advisory: "CVE-2026-1234" } },
  { label: "Vulnerability patched", key: "vuln-patched", type: "security.vulnerability_patched", source: "external", severity: "info" },
  { label: "Critical alert", key: "critical-alert", type: "external.alert", source: "external", severity: "critical" },
  // Concept v2 (L2) — traffic SHAPE only: host / status / latency
  { label: "API 503", key: "api-503", type: "network.request", source: "sensor", severity: "warning", payload: { host: "api.example.com", status: 503, ms: 1800 } },
  { label: "API recovered", key: "api-ok", type: "network.request", source: "sensor", severity: "info", payload: { host: "api.example.com", status: 200, ms: 140 } },
  { label: "Open file", key: "open-file", type: "user.opened_file", source: "user", severity: "info", payload: { path: "src/db.ts" } },
];

/**
 * The event a key names, or nothing.
 *
 * The key comes off a URL the runtime was asked to act on, so this is a search rather than a
 * lookup: a palette held as an object answered to `toString` and `constructor` with something
 * truthy that was not an event, and the person got a complaint about their request instead of
 * being told that no such event exists.
 */
export function simEvent(key: unknown): SimSpec | undefined {
  if (typeof key !== "string" || !key) return undefined;
  return SIM_EVENTS.find((spec) => spec.key === key);
}

/** One simulated event, ready to ingest. Both sides build it the same way. */
export function buildSimEvent(spec: SimSpec, sessionId: string, id: string, timestamp: string): MatterEvent {
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
