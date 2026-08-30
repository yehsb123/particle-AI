import type { MatterEvent } from "@particle/contracts";

export type SimSpec = {
  label: string;
  type: string;
  source: MatterEvent["source"];
  severity: MatterEvent["severity"];
  payload?: Record<string, unknown>;
};

/** Server-side simulation palette (mirrors the web lab) for infra-free demos. */
export const SIM_EVENTS: Record<string, SimSpec> = {
  "http-500": { label: "HTTP 500", type: "development.server_error", source: "development", severity: "critical", payload: { status: 500, route: "/users/42" } },
  "build-failed": { label: "Build failed", type: "development.build_failed", source: "development", severity: "warning" },
  "test-failed": { label: "Test failed", type: "development.test_failed", source: "development", severity: "warning" },
  "recovered": { label: "Service recovered", type: "development.server_recovered", source: "development", severity: "info" },
  "build-ok": { label: "Build succeeded", type: "development.build_succeeded", source: "development", severity: "info" },
  "high-cpu": { label: "High CPU", type: "system.resource_warning", source: "system", severity: "warning", payload: { cpu: 0.94 } },
  "vuln": { label: "Vulnerability found", type: "security.vulnerability_detected", source: "external", severity: "critical", payload: { advisory: "CVE-2026-1234" } },
  "vuln-patched": { label: "Vulnerability patched", type: "security.vulnerability_patched", source: "external", severity: "info" },
  "critical-alert": { label: "Critical alert", type: "external.alert", source: "external", severity: "critical" },
  "api-503": { label: "API 503", type: "network.request", source: "sensor", severity: "warning", payload: { host: "api.example.com", status: 503, ms: 1800 } },
  "api-ok": { label: "API recovered", type: "network.request", source: "sensor", severity: "info", payload: { host: "api.example.com", status: 200, ms: 140 } },
  "open-file": { label: "Open file", type: "user.opened_file", source: "user", severity: "info", payload: { path: "src/db.ts" } },
};
