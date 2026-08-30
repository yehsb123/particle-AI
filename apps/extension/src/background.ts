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
const ready: Promise<void> = chrome.storage.sync.get(["consent", "token"]).then((v) => {
  applySettings(v);
  syncNetworkListeners();
  announce();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !(changes.consent || changes.token)) return;
  void chrome.storage.sync.get(["consent", "token"]).then((v) => {
    applySettings(v);
    syncNetworkListeners();
    announce();
  });
});

async function send(event: ReturnType<typeof matterEvent>): Promise<void> {
  await ready;
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (token) headers["x-particle-token"] = token;
    await fetch(`${RUNTIME}/api/events`, { method: "POST", headers, body: JSON.stringify(event) });
  } catch {
    /* runtime offline — sensing is best-effort and local */
  }
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
    if (!consent.tabs || d.frameId !== 0) return;
    const host = hostOf(d.url);
    if (isSelfHost(host)) return;
    void send(matterEvent(SESSION, "user", "user.opened_file", "debug", { path: `site:${host}` }));
  })();
});

// ── L2: network shape (host/status/latency only) — OPT-IN. Listeners exist only while consented. ──
// Only transitions (fail/recover), slowness and a sparse sample are sent — never every request.
const shaper = new NetworkShaper();
const started = new Map<string, number>();
let networkAttached = false;
const FILTER = { urls: ["<all_urls>"] };

const onBeforeRequest = (d: chrome.webRequest.WebRequestBodyDetails): void => {
  started.set(d.requestId, Date.now());
  if (started.size > 2000) started.delete(started.keys().next().value as string); // long-lived streams never complete
};
const onCompleted = (d: chrome.webRequest.WebResponseCacheDetails): void => {
  const t0 = started.get(d.requestId);
  started.delete(d.requestId);
  const host = hostOf(d.url);
  if (isSelfHost(host) || d.type === "image" || d.type === "font" || d.type === "stylesheet") return;
  const now = Date.now();
  const shape = { host, status: d.statusCode, ms: t0 ? now - t0 : undefined };
  const why = shaper.admit(shape, now);
  if (!why) return;
  void send(matterEvent(SESSION, "sensor", "network.request", networkSeverity(shape), { ...shape, why }));
};
const onErrorOccurred = (d: chrome.webRequest.WebResponseErrorDetails): void => {
  started.delete(d.requestId);
  if (isTransientError(d.error)) return;
  const host = hostOf(d.url);
  if (isSelfHost(host)) return;
  const shape = { host, error: true };
  if (!shaper.admit(shape, Date.now())) return;
  void send(matterEvent(SESSION, "sensor", "network.request", "warning", { ...shape, why: "failure" }));
};

function syncNetworkListeners(): void {
  if (consent.network && !networkAttached) {
    chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, FILTER);
    chrome.webRequest.onCompleted.addListener(onCompleted, FILTER);
    chrome.webRequest.onErrorOccurred.addListener(onErrorOccurred, FILTER);
    networkAttached = true;
  } else if (!consent.network && networkAttached) {
    chrome.webRequest.onBeforeRequest.removeListener(onBeforeRequest);
    chrome.webRequest.onCompleted.removeListener(onCompleted);
    chrome.webRequest.onErrorOccurred.removeListener(onErrorOccurred);
    started.clear();
    networkAttached = false;
  }
}

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
