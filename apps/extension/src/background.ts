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

const RUNTIME = "http://localhost:8787";
const SESSION = "ext";

const NONE: Consent = { interactions: false, tabs: false, network: false };
let consent: Consent = { ...NONE };
let token = "";

function applySettings(v: Record<string, unknown>): void {
  consent = { ...DEFAULT_CONSENT, ...((v.consent as Partial<Consent> | undefined) ?? {}) };
  token = typeof v.token === "string" ? v.token : "";
}

/** Resolves once consent has been read — every sender awaits this. */
const ready: Promise<void> = chrome.storage.sync
  .get(["consent", "token"])
  .then((v) => applySettings(v))
  .catch(() => applySettings({})) // storage unavailable → defaults (fail closed for network), never a stuck promise
  .then(() => announce());

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !(changes.consent || changes.token)) return;
  void chrome.storage.sync.get(["consent", "token"]).then((v) => {
    applySettings(v);
    announce();
  });
});

// Sends are serialized so events arrive in the order they were observed (a recovery must not
// overtake the failure it recovers from). One in-flight request at a time, best-effort.
let sendQueue: Promise<void> = Promise.resolve();
let sendPending = 0;
function send(event: ReturnType<typeof matterEvent>): Promise<void> {
  if (sendPending >= 500) return sendQueue; // hung/slow endpoint: drop the NEWEST (order beats completeness)
  sendPending += 1;
  sendQueue = sendQueue.then(async () => {
    await ready;
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token) headers["x-particle-token"] = token;
      await fetch(`${RUNTIME}/api/events`, {
        method: "POST",
        headers,
        body: JSON.stringify(event),
        signal: AbortSignal.timeout(5_000), // browser fetch has no default timeout — never wedge the queue
      });
    } catch {
      /* runtime offline — sensing is best-effort and local */
    } finally {
      sendPending -= 1;
    }
  });
  return sendQueue;
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
    if (isSelfHost(host) || d.type === "image" || d.type === "font" || d.type === "stylesheet") return;
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
    if (isSelfHost(host)) return;
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
    if (msg.kind === "interaction") void send(matterEvent(SESSION, "user", "user.interaction", "debug", msg.payload ?? {}));
    if (msg.kind === "idle") void send(matterEvent(SESSION, "user", "user.idle", "debug", msg.payload ?? {}));
    if (msg.kind === "visibility") void send(matterEvent(SESSION, "user", "user.visibility", "info", msg.payload ?? {}));
  })();
});

// Toolbar click opens the side panel (the body).
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
});
