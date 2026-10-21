/**
 * Particle AI — background service worker (MV3).
 * Sensors → shaped MatterEvents → local runtime (POST /api/events).
 * Three of the four layers are shape: hostnames, status codes, latency, tab focus — no URLs and
 * nothing off the page. The fourth is the page layer, which relays the names the content script
 * read off the page somebody is on; it is off unless consented and it is the one layer here that
 * does read content (docs/CONSENT_V2.md).
 *
 * MV3 kills this worker after ~30 s idle and restarts it on the next event, so module state is
 * ephemeral: consent is re-read from storage on every start and NOTHING is sent before that read
 * completes (defaults are "off", never "on"); cross-wake state (hidden-since) lives in
 * chrome.storage.session.
 */
import {
  RELAY_KINDS,
  relayPayload,
  createSendQueue,
  identifier,
  ingestUrl,
  dropNotice,
  droppedFromAck,
  hostOf,
  networkSeverity,
  matterEvent,
  isSelfHost,
  isSensableUrl,
  isTransientError,
  NetworkShaper,
  consentLayers,
  DEFAULT_CONSENT,
  type Consent,
  runtimeUrlFrom,
  DEFAULT_RUNTIME_URL,
} from "./shape";

let runtimeUrl = DEFAULT_RUNTIME_URL;
const SESSION = "ext";

const NONE: Consent = { interactions: false, tabs: false, network: false, page: false };
let consent: Consent = { ...NONE };
let token = "";

function applySettings(v: Record<string, unknown>): void {
  // Consent decides what may leave this machine, so it is four booleans and nothing else —
  // storage syncs across devices and can hold whatever an older build wrote there.
  const stored = (v.consent && typeof v.consent === "object" ? v.consent : {}) as Record<string, unknown>;
  const layer = (k: keyof Consent) => (typeof stored[k] === "boolean" ? (stored[k] as boolean) : DEFAULT_CONSENT[k]);
  consent = { interactions: layer("interactions"), tabs: layer("tabs"), network: layer("network"), page: layer("page") };
  token = typeof v.token === "string" ? v.token : "";
  runtimeUrl = runtimeUrlFrom(v.runtimeUrl).url;
}

/** Resolves once consent has been read — every sender awaits this. */
const ready: Promise<void> = chrome.storage.sync
  .get(["consent", "token", "runtimeUrl"])
  .then((v) => applySettings(v))
  .catch(() => applySettings({})) // storage unavailable → defaults (fail closed for network), never a stuck promise
  .then(() => announce());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !(changes.consent || changes.token || changes.runtimeUrl)) return;
  void chrome.storage.sync.get(["consent", "token", "runtimeUrl"]).then((v) => {
    applySettings(v);
    announce();
  });
});

/**
 * How many of this session's events the runtime last said it had let go.
 *
 * MV3 throws this worker away after thirty idle seconds, so the number starts again at zero on
 * the next wake and a loss can be reported twice. Reporting it twice is the cheap mistake; the
 * expensive one is a sensor that never says its observations are being thrown away.
 */
let dropsHeard = 0;

// Sends are serialized so events arrive in the order they were observed (a recovery must not
// overtake the failure it recovers from). One in-flight request at a time, best-effort.
const queue = createSendQueue(async (event) => {
  await ready; // never send before consent has been read
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-particle-token"] = token;
  const res = await fetch(ingestUrl(runtimeUrl), {
    method: "POST",
    headers,
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5_000), // browser fetch has no default timeout — never wedge the queue
  });
  // The runtime answers 202 without running the event, so arriving no longer means it survived.
  // The acknowledgement carries what this session has lost under load, and a sensor that does not
  // read it cannot tell that part of what it observed is being thrown away.
  const ack = await res.json().catch(() => null);
  const heard = dropNotice(dropsHeard, droppedFromAck(ack));
  dropsHeard = heard.seen;
  if (heard.note) console.warn(heard.note);
}, {
  // Say when an event did not make it. The queue is best-effort by design and does not retry, so
  // without this a lost event left no trace anywhere: not in the runtime, which never saw it, and
  // not here. A busy runtime answering slower than the five second timeout above is enough, and
  // that is how a flaky end-to-end run looked from the outside — an event that simply never came.
  onError: (err) => {
    const why = err instanceof Error ? err.message : String(err);
    console.warn(`[particle] an event was not delivered (${identifier(why) || "no reason given"}); ${queue.dropped()} not delivered so far`);
  },
});
function send(event: ReturnType<typeof matterEvent>): Promise<void> {
  return queue.send(event);
}

/** Tell the runtime what this sensor observes right now, so the body's indicator stays true. */
function announce(): void {
  void send(matterEvent(SESSION, "sensor", "sensor.layers_changed", "debug", { sensor: "extension", layers: consentLayers(consent) }));
}

// ── L3: window focus → visibility (returning after time away). hidden-since survives SW restarts. ──
chrome.windows.onFocusChanged.addListener((windowId) => {
  void (async () => {
    await ready;
    if (!consent.tabs) return;
    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      await chrome.storage.session.set({ hiddenAt: Date.now() });
      return;
    }
    const { hiddenAt } = (await chrome.storage.session.get("hiddenAt")) as { hiddenAt?: number };
    if (!hiddenAt) return;
    await chrome.storage.session.remove("hiddenAt");
    const away = Math.round((Date.now() - hiddenAt) / 1000);
    if (away >= 5) void send(matterEvent(SESSION, "user", "user.visibility", "info", { visible: true, awaySeconds: away }));
  })();
});

// ── L3: navigation → one entity event keyed by host (repeats → "stuck", breadth → "exploring", alternation → "switching") ──
chrome.webNavigation.onCommitted.addListener((d) => {
  void (async () => {
    await ready;
    if (!consent.tabs || d.frameId !== 0 || !isSensableUrl(d.url)) return; // never our own pages / chrome://
    const host = hostOf(d.url);
    if (isSelfHost(host)) return;
    void send(matterEvent(SESSION, "user", "user.opened_file", "debug", { path: `site:${host}` }));
  })();
});

// ── L2: network shape (host/status/latency only) — OPT-IN ──
// Listeners are registered synchronously at top level (MV3 only wakes the worker for events whose
// listeners exist at first evaluation); consent is checked inside, after storage has been read.
// Only transitions (fail/recover), slowness and a sparse sample are sent — never every request.
const shaper = new NetworkShaper();
const started = new Map<string, number>();
const FILTER = { urls: ["<all_urls>"] };

chrome.webRequest.onBeforeRequest.addListener((d) => {
  started.set(d.requestId, Date.now()); // timestamp only — cleared when the request settles
  if (started.size > 2000) started.delete(started.keys().next().value as string); // long-lived streams never complete
}, FILTER);
chrome.webRequest.onCompleted.addListener((d) => {
  const t0 = started.get(d.requestId);
  started.delete(d.requestId);
  const observedAt = Date.now();
  void (async () => {
    await ready;
    if (!consent.network) return;
    const host = hostOf(d.url);
    // never observe ourselves — including a custom runtime host (it may not be localhost)
    if (isSelfHost(host) || host === hostOf(runtimeUrl) || d.type === "image" || d.type === "font" || d.type === "stylesheet") return;
    const shape = { host, status: d.statusCode, ms: t0 ? observedAt - t0 : undefined };
    const why = shaper.admit(shape, observedAt);
    if (!why) return;
    void send(matterEvent(SESSION, "sensor", "network.request", networkSeverity(shape), { ...shape, why }));
  })();
}, FILTER);
chrome.webRequest.onErrorOccurred.addListener((d) => {
  started.delete(d.requestId);
  void (async () => {
    await ready;
    if (!consent.network || isTransientError(d.error)) return;
    const host = hostOf(d.url);
    if (isSelfHost(host) || host === hostOf(runtimeUrl)) return;
    const shape = { host, error: true };
    if (!shaper.admit(shape, Date.now())) return;
    void send(matterEvent(SESSION, "sensor", "network.request", "warning", { ...shape, why: "failure" }));
  })();
}, FILTER);

// ── L0 relay: content scripts report interaction shape ──
chrome.runtime.onMessage.addListener((msg: { kind?: string; payload?: Record<string, unknown> }) => {
  void (async () => {
    await ready;
    if (!msg?.kind) return;
    // each relayed kind is gated by the layer it belongs to: the page layer is its own consent,
    // not a wider reading of the interaction one, because it is the one that reads the page
    if (!(msg.kind === "page" ? consent.page : consent.interactions)) return;
    const kind = Object.hasOwn(RELAY_KINDS, msg.kind) ? RELAY_KINDS[msg.kind] : undefined;
    const payload = relayPayload(msg.kind, msg.payload);
    if (!kind || !payload) return;
    void send(matterEvent(SESSION, kind.source, kind.type, kind.severity, payload));
  })();
});

// Toolbar click opens the side panel (the body).
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
});
