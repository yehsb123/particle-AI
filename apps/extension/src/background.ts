/**
 * Particle AI — background service worker (MV3).
 * Sensors (L2/L3) → shaped MatterEvents → local runtime (POST /api/events).
 * Shape only: hostnames, status codes, latency, tab focus. No URLs, no page content.
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
} from "./shape";

const DEFAULT_RUNTIME = "http://localhost:8787";
let runtimeUrl = DEFAULT_RUNTIME;
const SESSION = "ext";

const NONE: Consent = { interactions: false, tabs: false, network: false };
let consent: Consent = { ...NONE };
let token = "";

function applySettings(v: Record<string, unknown>): void {
  // Consent decides what may leave this machine, so it is three booleans and nothing else —
  // storage syncs across devices and can hold whatever an older build wrote there.
  const stored = (v.consent && typeof v.consent === "object" ? v.consent : {}) as Record<string, unknown>;
  const layer = (k: keyof Consent) => (typeof stored[k] === "boolean" ? (stored[k] as boolean) : DEFAULT_CONSENT[k]);
  consent = { interactions: layer("interactions"), tabs: layer("tabs"), network: layer("network") };
  token = typeof v.token === "string" ? v.token : "";
  const u = typeof v.runtimeUrl === "string" ? v.runtimeUrl.trim() : "";
  runtimeUrl = /^https?:\/\//.test(u) ? u.replace(/\/$/, "") : DEFAULT_RUNTIME;
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

// Sends are serialized so events arrive in the order they were observed (a recovery must not
// overtake the failure it recovers from). One in-flight request at a time, best-effort.
const queue = createSendQueue(async (event) => {
  await ready; // never send before consent has been read
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-particle-token"] = token;
  await fetch(`${runtimeUrl}/api/events`, {
    method: "POST",
    headers,
    body: JSON.stringify(event),
    signal: AbortSignal.timeout(5_000), // browser fetch has no default timeout — never wedge the queue
  });
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
    if (!consent.interactions || !msg?.kind) return;
    const kind = Object.hasOwn(RELAY_KINDS, msg.kind) ? RELAY_KINDS[msg.kind] : undefined;
    const payload = relayPayload(msg.kind, msg.payload);
    if (!kind || !payload) return;
    void send(matterEvent(SESSION, "user", kind.type, kind.severity, payload));
  })();
});

// Toolbar click opens the side panel (the body).
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
});
