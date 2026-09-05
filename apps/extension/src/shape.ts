/**
 * Privacy-preserving shaping (Concept v2 rule #1: shape, never content).
 * Everything the extension sends is derived through these pure helpers so a review of this
 * file is a review of what can possibly leave the page.
 */

/** Only the web is sensed: extension pages, chrome:// internals, files etc. are never observed. */
export function isSensableUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

/** Hostname only — never path, query, hash, credentials, or port. */
/**
 * How much of a name this sensor will send. The same bound the runtime keeps (MAX_IDENTIFIER in
 * the contracts, asserted by this package's tests): a sensor sends a shape, and a shape has a
 * size. Trimming here as well as there means what leaves this machine is already a shape, rather
 * than something the receiver has to cut down after it has already been sent.
 */
export const MAX_NAME = 120;

/** Control characters: a name carrying an escape sequence is read by a terminal, not a person. */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;
const WHITESPACE = /\s+/g;

/**
 * A name this machine observed, made fit to send and to print.
 *
 * These come from outside: a branch name out of a file git wrote, a path out of the OS watcher, a
 * host out of a URL. None of them are bounded at the source, and a name is written into an event,
 * into cards someone reads, and into this process's own stderr — where an escape sequence is an
 * instruction to their terminal rather than a name anybody chose.
 */
export function identifier(name: unknown): string {
  if (typeof name !== "string") return "";
  const clean = name.replace(CONTROL_CHARACTERS, "").replace(WHITESPACE, " ").trim();
  return clean.length > MAX_NAME ? `${clean.slice(0, MAX_NAME)}…` : clean;
}

/** Where events go when nobody has said otherwise: the runtime on this machine. */
export const DEFAULT_RUNTIME_URL = "http://localhost:8787";

/**
 * Where this sensor will send what it observes, from what somebody typed.
 *
 * It was decided by a prefix test rather than by parsing, so "192.168.1.20:8787" — a reasonable
 * thing to type for a runtime on another machine — fell back to this one while the options page
 * went on showing what was typed, and "http://" became "http:/" which is not an address at all.
 * Somebody who believes their events are going to one machine while they go to another has been
 * told something untrue about their own data.
 *
 * `fellBack` is what lets the page say so.
 */
export function runtimeUrlFrom(typed: unknown): { url: string; fellBack: boolean } {
  const raw = typeof typed === "string" ? typed.trim() : "";
  if (!raw) return { url: DEFAULT_RUNTIME_URL, fellBack: false };
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { url: DEFAULT_RUNTIME_URL, fellBack: true };
    if (!parsed.hostname) return { url: DEFAULT_RUNTIME_URL, fellBack: true };
    return { url: `${parsed.origin}${parsed.pathname}`.replace(/\/$/, ""), fellBack: false };
  } catch {
    return { url: DEFAULT_RUNTIME_URL, fellBack: true };
  }
}

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    // a URL parses with a hostname of any length; what this sensor reports is a shape
    return identifier(u.hostname) || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * A queue that sends one thing at a time, in the order it was handed them. Transitions only mean
 * something in order — a recovery must never overtake the failure it recovers from — so a second
 * send waits for the first rather than racing it.
 *
 * When the far end is hung or slow the queue fills, and at the ceiling the NEWEST item is dropped
 * rather than the oldest: what is already queued is the earlier part of the story, and a story
 * with its beginning is worth more than one with its end.
 */
export function createSendQueue(
  post: (payload: unknown) => Promise<void>,
  options: { maxPending?: number; onError?: (err: unknown) => void } = {},
) {
  const maxPending = options.maxPending ?? 500;
  let chain: Promise<void> = Promise.resolve();
  let pending = 0;
  let dropped = 0;

  return {
    send(payload: unknown): Promise<void> {
      if (pending >= maxPending) {
        dropped += 1;
        return chain;
      }
      pending += 1;
      chain = chain.then(async () => {
        try {
          await post(payload);
        } catch (err) {
          options.onError?.(err); // best-effort: the far end being down is not our problem to solve
        } finally {
          pending -= 1;
        }
      });
      return chain;
    },
    /** How many sends are queued or in flight. */
    pending: () => pending,
    /** How many were dropped at the ceiling, for an honest indicator. */
    dropped: () => dropped,
  };
}

/** What a relayed message may carry, per kind: counts, seconds, a hostname. Nothing else. */
export const RELAY_KINDS: Record<string, { type: string; severity: "debug" | "info" }> = {
  interaction: { type: "user.interaction", severity: "debug" },
  idle: { type: "user.idle", severity: "debug" },
  visibility: { type: "user.visibility", severity: "info" },
};

function count(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 1_000_000) : fallback;
}

/**
 * Rebuild a content script's message from scratch, keeping only the fields that kind is allowed
 * to have. The content script counts interactions and never reads text — but this file is where
 * that promise is kept, and a message forwarded as-is is a promise kept somewhere else. Anything
 * unknown, and any kind nobody declared, ends here.
 */
export function relayPayload(kind: string, payload: unknown): Record<string, unknown> | null {
  if (!Object.hasOwn(RELAY_KINDS, kind)) return null;
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  if (kind === "interaction") {
    const host = typeof p.host === "string" && /^[A-Za-z0-9.\-[\]:]{1,253}$/.test(p.host) ? p.host.toLowerCase() : undefined;
    return { count: count(p.count, 1), ...(host ? { host } : {}) };
  }
  if (kind === "idle") return { seconds: count(p.seconds, 0) };
  return { visible: p.visible === true, awaySeconds: count(p.awaySeconds, 0) };
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

/** The layer names a consent state actually enables — what the body will show as "sensing". */
export function consentLayers(c: Consent): string[] {
  const out: string[] = [];
  if (c.interactions) out.push("interactions", "idle", "visibility");
  if (c.tabs) out.push("tabs");
  if (c.network) out.push("network");
  return out;
}

/**
 * Whether a hostname belongs to the runtime or the body itself — we never observe ourselves.
 * Covers the whole loopback family, including the IPv6 form a browser may hand us in brackets
 * and the 127.0.0.0/8 range, not just the two spellings people usually type.
 */
export function isSelfHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || h === "0:0:0:0:0:0:0:1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}
