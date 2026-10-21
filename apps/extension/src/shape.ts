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

/**
 * Where an event is handed over — and the fact that this sensor is not waiting for the answer.
 *
 * The runtime runs a whole loop per event (world, significance, intent, a model call, permissions,
 * capabilities, the morph) before it answers, and this sensor held the connection open through all
 * of it for a result it never reads. `wait=0` gets an acknowledgement instead; the event is still
 * run, in the order this sensor sent it. The runtime answers the old way when nobody says this,
 * which is what the body wants and what every caller written before this did.
 */
export function ingestUrl(runtimeUrl: string): string {
  return `${runtimeUrl}/api/events?wait=0`;
}

/**
 * How many of this session's events the runtime has let go, read out of its acknowledgement.
 *
 * Since this sensor stopped waiting for the loop, every answer is a 202 whether the event ran or
 * was thrown away under load, so `res.ok` says nothing about either. The count is the one thing
 * that still comes back, and it is read strictly rather than trusted: the body of an answer is
 * outside data like any other, and a proxy's error page or an older runtime is not a count.
 *
 * This module takes no runtime dependencies on purpose - reviewing it is reviewing what can leave
 * the machine - so the check is spelled out here instead of being handed to a schema library.
 */
export function droppedFromAck(body: unknown): number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const n = (body as { dropped?: unknown }).dropped;
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/**
 * One line, the moment the count goes up, and silence otherwise.
 *
 * A count that went DOWN is a runtime that restarted, not events coming back, so it is followed
 * without a word rather than reported as a recovery.
 */
export function dropNotice(seen: number, reported: number | null): { seen: number; note: string | null } {
  if (reported === null) return { seen, note: null };
  if (reported <= seen) return { seen: reported, note: null };
  const now = reported - seen;
  return {
    seen: reported,
    note: `[particle] the runtime let go of ${now} more of this session's events (${reported} in total): it is behind, and what they observed is gone`,
  };
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
          // An event that did not arrive is gone whether the queue refused it or the send failed;
          // the count is what this sensor lost, not how it lost it. Before this, a send that timed
          // out left dropped() reading zero, and the fetch here carries a five second timeout, so
          // a busy runtime silently cost events while the counter said none were lost.
          dropped += 1;
          try {
            options.onError?.(err); // best-effort: the far end being down is not our problem to solve
          } catch {
            // A handler that throws used to reject this link of the chain, which meant no later
            // send ever ran and every event after the first failure was lost — with an unhandled
            // rejection as the only sign. Nothing called from a failure path may end the queue.
          }
        } finally {
          pending -= 1;
        }
      });
      return chain;
    },
    /** How many sends are queued or in flight. */
    pending: () => pending,
    /** How many this sensor did not deliver: refused at the ceiling, or failed on the way. */
    dropped: () => dropped,
  };
}

/**
 * The page layer: how much of a page this sensor will describe.
 *
 * Measured rather than guessed. A probe read the structure of real pages — a store checkout, a
 * login form, a wiki front page, a news front page — and found at most eight headings, six
 * buttons and a handful of labelled boxes, with the longest single name at thirty-six
 * characters. These counts sit just above what was there, and `item` leaves room for a name half
 * as long again before it is shortened.
 *
 * One field of the payload is held to MAX_NAME, which is the runtime's own MAX_IDENTIFIER: a
 * payload string longer than that is trimmed by the runtime before the belief, the snapshot or
 * any prompt ever sees it, so sending more would be sending something that is cut somewhere else
 * without anybody being told. A whole page therefore arrives as four names of at most a hundred
 * and twenty characters and one count — around six hundred characters, which is small enough
 * for a person to read the whole of it and decide whether that much is all right.
 */
export const PAGE_LIMITS = { headings: 5, fields: 8, actions: 6, item: 60 } as const;

/** What the content script found out about one box on a page. Never its value. */
export type PageField = { type?: unknown; autocomplete?: unknown; name?: unknown; id?: unknown; label?: unknown };

/**
 * Words that mean this box can hold a secret: a password, or a card.
 *
 * A box matching this is left out of the payload entirely — not its value, which this sensor
 * never reads at all, but its label too. Over-matching costs one label; under-matching sends the
 * name of a box somebody is about to type a card number into, and the two are not comparable.
 */
const SECRET_FIELD =
  /password|passwd|비밀번호|암호|card.?number|cardnumber|credit.?card|\bcard\b|\bcvc\b|\bcvv\b|security.code|카드번호|유효기간|보안코드/i;

/** Is this a box whose very existence this sensor keeps to itself? */
export function isSecretField(field: PageField): boolean {
  const f = (field && typeof field === "object" ? field : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const autocomplete = str(f.autocomplete).trim().toLowerCase();
  // the autocomplete tokens for a card are all spelled cc-something (cc-number, cc-exp, cc-csc)
  if (autocomplete.startsWith("cc-")) return true;
  if (str(f.type).trim().toLowerCase() === "password") return true;
  return SECRET_FIELD.test(`${autocomplete} ${str(f.name)} ${str(f.id)} ${str(f.label)}`);
}

/**
 * The last thing done to a name before it leaves: a long run of digits becomes nothing.
 *
 * Nine digits in a row is not a heading or a button anybody reads — it is a card, an account or
 * a phone number that got into a label. The numbers a page really shows a person (a year, a
 * price, a count of articles) are shorter than that or carry separators, so they survive.
 */
export function maskLongDigits(text: unknown): string {
  return typeof text === "string" ? text.replace(/\d{9,}/g, "…") : "";
}

/** A name fit to send: no control characters, no long digit run, no longer than `cap`. */
function pageName(raw: unknown, cap: number): string {
  const clean = maskLongDigits(identifier(raw));
  return clean.length > cap ? `${clean.slice(0, cap - 1)}…` : clean;
}

const SEPARATOR = " · ";

/**
 * One payload field: the names of up to `max` things, in the order the page had them.
 *
 * It stops before a name rather than cutting one in half, so what arrives is always a whole list
 * of whole names — a reader can tell there was more, and cannot be shown half a word as if it
 * were the word.
 */
export function nameList(names: readonly unknown[], max: number): string {
  if (!Array.isArray(names)) return "";
  const out: string[] = [];
  let length = 0;
  for (const raw of names) {
    if (out.length >= max) break;
    const name = pageName(raw, PAGE_LIMITS.item);
    if (!name || out.includes(name)) continue; // a page repeats its own button names
    const grown = out.length === 0 ? name.length : length + SEPARATOR.length + name.length;
    if (grown > MAX_NAME) break;
    out.push(name);
    length = grown;
  }
  return out.join(SEPARATOR);
}

/**
 * A page as this sensor will describe it: what it is called, what it says in large letters, what
 * it asks for, and what it offers to do. Enough for the runtime to tell a job board from a
 * ticket queue; far short of the page itself.
 *
 * `omitted` is how many boxes were left undescribed for being able to hold a password or a card.
 * Without it a login page and a page with no boxes at all would look the same, and somebody
 * reading the event could not tell that something had been held back.
 */
export function pageShape(raw: { title?: unknown; headings?: unknown; fields?: unknown; actions?: unknown }): {
  title: string;
  headings: string;
  fields: string;
  actions: string;
  omitted: number;
} {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const described: unknown[] = [];
  let omitted = 0;
  for (const field of Array.isArray(source.fields) ? source.fields : []) {
    if (isSecretField(field as PageField)) {
      omitted += 1;
      continue;
    }
    described.push((field as PageField | null)?.label);
  }
  return {
    title: pageName(source.title, MAX_NAME),
    headings: nameList(source.headings as unknown[], PAGE_LIMITS.headings),
    fields: nameList(described, PAGE_LIMITS.fields),
    actions: nameList(source.actions as unknown[], PAGE_LIMITS.actions),
    omitted,
  };
}

/**
 * What a relayed message may carry, per kind: counts, seconds, a hostname, the names on a page.
 * Nothing else. `source` is who the runtime hears it from — a person did the interacting, a
 * sensor did the reading.
 */
export const RELAY_KINDS: Record<string, { type: string; severity: "debug" | "info"; source: "user" | "sensor" }> = {
  interaction: { type: "user.interaction", severity: "debug", source: "user" },
  idle: { type: "user.idle", severity: "debug", source: "user" },
  visibility: { type: "user.visibility", severity: "info", source: "user" },
  page: { type: "sensor.read_page", severity: "info", source: "sensor" },
};

function count(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), 1_000_000) : fallback;
}

/** A hostname as a browser spells one, or nothing. Never a path, a scheme or anything with a slash. */
function hostname(v: unknown): string {
  return typeof v === "string" && /^[A-Za-z0-9.\-[\]:]{1,253}$/.test(v) ? v.toLowerCase() : "";
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
    const host = hostname(p.host);
    return { count: count(p.count, 1), ...(host ? { host } : {}) };
  }
  if (kind === "page") {
    // The page the content script read, rebuilt from its names. A page can run its own code in
    // the same world as the content script, so the shaping done there is re-done here, at the
    // edge: lengths held, digit runs masked, and a name the page did not have left out rather
    // than sent empty. What cannot be re-done here is the rule about boxes that hold secrets —
    // only the side holding the element knows what kind of box it was — so that one is kept
    // where the DOM is read, in content.ts, and tested there.
    const out: Record<string, unknown> = { omitted: count(p.omitted, 0) };
    const host = hostname(p.host);
    if (host) out.host = host;
    for (const key of ["title", "headings", "fields", "actions"] as const) {
      const name = pageName(p[key], MAX_NAME);
      if (name) out[key] = name;
    }
    return out;
  }
  if (kind === "idle") return { seconds: count(p.seconds, 0) };
  return { visible: p.visible === true, awaySeconds: count(p.awaySeconds, 0) };
}

export type NetworkShape = { host: string; status?: number; ms?: number; error?: boolean };

/** Severity for a network observation: 5xx/errors warn, everything else is informational. */
export function networkSeverity(shape: NetworkShape): "info" | "warning" {
  return shape.error || (shape.status ?? 0) >= 500 ? "warning" : "info";
}

/**
 * Sensing layers the user can consent to.
 *
 * Network is off by default for being the widest of the shape layers. Page is off for a
 * different reason: it is the only one here that reads what is on a page rather than the shape
 * of the browsing around it, so it is not a wider version of the others and is never on because
 * nobody said no (docs/CONSENT_V2.md).
 */
export type Consent = { interactions: boolean; tabs: boolean; network: boolean; page: boolean };
export const DEFAULT_CONSENT: Consent = { interactions: true, tabs: true, network: false, page: false };

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
  // last, and named apart from the rest: the indicator in the body says this one reads content
  if (c.page) out.push("page");
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
