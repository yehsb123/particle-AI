/**
 * Privacy-preserving shaping (Concept v2 rule #1: shape, never content).
 * Everything the extension sends is derived through these pure helpers so a review of this
 * file is a review of what can possibly leave the page.
 */

/** Hostname only — never path, query, hash, credentials, or port. */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname || "unknown";
  } catch {
    return "unknown";
  }
}

export type NetworkShape = { host: string; status?: number; ms?: number; error?: boolean };

/** Severity for a network observation: 5xx/errors warn, everything else is informational. */
export function networkSeverity(shape: NetworkShape): "info" | "warning" {
  return shape.error || (shape.status ?? 0) >= 500 ? "warning" : "info";
}

/** Sensing layers the user can consent to. Network is OFF by default (it is the widest). */
export type Consent = { interactions: boolean; tabs: boolean; network: boolean };
export const DEFAULT_CONSENT: Consent = { interactions: true, tabs: true, network: false };

/** Small helper to build a MatterEvent-shaped object without importing the monorepo. */
export function matterEvent(
  sessionId: string,
  source: "user" | "sensor",
  type: string,
  severity: "debug" | "info" | "warning",
  payload: Record<string, unknown>,
  now = new Date(),
) {
  return {
    id: `ext-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    timestamp: now.toISOString(),
    source,
    type,
    severity,
    payload,
  };
}

/** Whether a hostname belongs to the local runtime/body itself (we never observe ourselves). */
export function isSelfHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1";
}
