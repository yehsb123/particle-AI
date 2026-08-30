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

/**
 * Chromium error codes that are part of normal browsing (cancelled navigations, ad blockers,
 * cache probes) - not a failing dependency. Never reported.
 */
const TRANSIENT_ERRORS = new Set([
  "net::ERR_ABORTED",
  "net::ERR_BLOCKED_BY_CLIENT",
  "net::ERR_BLOCKED_BY_ORB",
  "net::ERR_BLOCKED_BY_RESPONSE",
  "net::ERR_CACHE_MISS",
  "net::ERR_INCOMPLETE_CHUNKED_ENCODING",
]);
export function isTransientError(code: string | undefined): boolean {
  return !!code && TRANSIENT_ERRORS.has(code);
}

export type ShaperConfig = {
  /** minimum gap between two reported failures of the same host */
  failureCooldownMs: number;
  /** latency at/above which a successful request counts as "slow" */
  slowMs: number;
  /** one ordinary success per host per this window keeps request counts alive without a firehose */
  successSampleMs: number;
  /** bound on remembered hosts (oldest sample forgotten first) */
  maxHosts: number;
};
export const DEFAULT_SHAPER: ShaperConfig = { failureCooldownMs: 5_000, slowMs: 2_000, successSampleMs: 30_000, maxHosts: 200 };

export type Admission = "failure" | "recovery" | "slow" | "sample";

/**
 * Decides which network observations are worth sending. The runtime cares about TRANSITIONS
 * (a host starts failing, a failing host recovers) and about slowness; a page load's hundreds
 * of ordinary 200s are sampled, not streamed. Pure state machine - no I/O.
 */
export class NetworkShaper {
  private readonly failing = new Set<string>();
  private readonly lastFailureAt = new Map<string, number>();
  private readonly lastSampleAt = new Map<string, number>();
  constructor(private readonly cfg: ShaperConfig = DEFAULT_SHAPER) {}

  admit(shape: NetworkShape, now: number): Admission | null {
    const { host } = shape;
    const status = shape.status ?? 0;
    const failed = shape.error === true || status >= 500;
    if (failed) {
      const last = this.lastFailureAt.get(host) ?? -Infinity;
      if (now - last < this.cfg.failureCooldownMs) return null;
      this.lastFailureAt.set(host, now);
      this.failing.add(host);
      this.prune();
      return "failure";
    }
    // any non-error answer (1xx-3xx) proves the host is back; only 2xx are worth sampling
    const answered = status > 0 && status < 400;
    if (answered && this.failing.has(host)) {
      this.failing.delete(host);
      this.lastFailureAt.delete(host);
      this.lastSampleAt.set(host, now); // the recovery IS this window's sample
      return "recovery";
    }
    const ok = status >= 200 && status < 300;
    if (ok && (shape.ms ?? 0) >= this.cfg.slowMs) {
      return this.sample(host, now, "slow");
    }
    return ok ? this.sample(host, now, "sample") : null;
  }

  private sample(host: string, now: number, kind: Admission): Admission | null {
    const last = this.lastSampleAt.get(host) ?? -Infinity;
    if (now - last < this.cfg.successSampleMs) return null;
    this.lastSampleAt.set(host, now);
    this.prune();
    return kind;
  }

  private prune(): void {
    for (const m of [this.lastSampleAt, this.lastFailureAt]) {
      while (m.size > this.cfg.maxHosts) {
        const oldest = m.keys().next().value;
        if (oldest === undefined) break;
        m.delete(oldest);
      }
    }
  }
}

/** Whether a hostname belongs to the local runtime/body itself (we never observe ourselves). */
export function isSelfHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1";
}
