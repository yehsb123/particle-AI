/**
 * Particle AI — background service worker (MV3).
 * Sensors (L2/L3) → shaped MatterEvents → local runtime (POST /api/events).
 * Shape only: hostnames, status codes, latency, tab focus. No URLs, no page content.
 */
import { hostOf, networkSeverity, matterEvent, isSelfHost, isTransientError, NetworkShaper, DEFAULT_CONSENT, type Consent } from "./shape";

const RUNTIME = "http://localhost:8787";
const SESSION = "ext";

let consent: Consent = { ...DEFAULT_CONSENT };
void chrome.storage.sync.get("consent").then((v) => {
  if (v.consent) consent = { ...DEFAULT_CONSENT, ...(v.consent as Consent) };
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.consent?.newValue) consent = { ...DEFAULT_CONSENT, ...(changes.consent.newValue as Consent) };
});

async function send(event: ReturnType<typeof matterEvent>): Promise<void> {
  try {
    await fetch(`${RUNTIME}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
  } catch {
    /* runtime offline — sensing is best-effort and local */
  }
}

// ── L3: window focus → visibility (returning after time away) ──
let hiddenAt: number | null = null;
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (!consent.tabs) return;
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    hiddenAt = Date.now();
    return;
  }
  const away = hiddenAt ? Math.round((Date.now() - hiddenAt) / 1000) : 0;
  hiddenAt = null;
  if (away >= 5) void send(matterEvent(SESSION, "user", "user.visibility", "info", { visible: true, awaySeconds: away }));
});

// ── L3: navigation → semantic action keyed by host (repeats → "stuck", breadth → "exploring") ──
chrome.webNavigation.onCommitted.addListener((d) => {
  if (!consent.tabs || d.frameId !== 0) return;
  const host = hostOf(d.url);
  if (isSelfHost(host)) return;
  // one event only: sending user.action AND user.opened_file alternated the repeat key and reset the count
  void send(matterEvent(SESSION, "user", "user.opened_file", "debug", { path: `site:${host}` }));
});

// ── L2: network shape (host/status/latency only) — OPT-IN ──
// Only transitions (fail/recover), slowness and a sparse sample are sent — never every request.
const shaper = new NetworkShaper();
const started = new Map<string, number>();
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    started.set(d.requestId, Date.now());
  },
  { urls: ["<all_urls>"] },
);
chrome.webRequest.onCompleted.addListener(
  (d) => {
    const t0 = started.get(d.requestId);
    started.delete(d.requestId);
    if (!consent.network) return;
    const host = hostOf(d.url);
    if (isSelfHost(host) || d.type === "image" || d.type === "font" || d.type === "stylesheet") return;
    const now = Date.now();
    const shape = { host, status: d.statusCode, ms: t0 ? now - t0 : undefined };
    const why = shaper.admit(shape, now);
    if (!why) return;
    void send(matterEvent(SESSION, "sensor", "network.request", networkSeverity(shape), { ...shape, why }));
  },
  { urls: ["<all_urls>"] },
);
chrome.webRequest.onErrorOccurred.addListener(
  (d) => {
    started.delete(d.requestId);
    if (!consent.network || isTransientError(d.error)) return;
    const host = hostOf(d.url);
    if (isSelfHost(host)) return;
    const shape = { host, error: true };
    if (!shaper.admit(shape, Date.now())) return;
    void send(matterEvent(SESSION, "sensor", "network.request", "warning", { ...shape, why: "failure" }));
  },
  { urls: ["<all_urls>"] },
);

// ── L0 relay: content scripts report interaction shape ──
chrome.runtime.onMessage.addListener((msg: { kind?: string; payload?: Record<string, unknown> }) => {
  if (!consent.interactions || !msg?.kind) return;
  if (msg.kind === "interaction") void send(matterEvent(SESSION, "user", "user.interaction", "debug", msg.payload ?? {}));
  if (msg.kind === "idle") void send(matterEvent(SESSION, "user", "user.idle", "debug", msg.payload ?? {}));
  if (msg.kind === "visibility") void send(matterEvent(SESSION, "user", "user.visibility", "info", msg.payload ?? {}));
});

// Toolbar click opens the side panel (the body).
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
});
