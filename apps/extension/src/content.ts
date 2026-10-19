/**
 * Particle AI — content script. Two layers live here and they do not make the same promise.
 *
 * L0 interaction shape counts THAT interaction happened; it never reads keys, text, selection or
 * the DOM. The page layer does read the page: its title, a few headings, the labels of its boxes
 * and the names of its buttons. It is off until somebody turns it on in the options page, it
 * never reads a value anybody typed, and it never describes a box that could hold a password or
 * a card number — see `isSecretField` in shape.ts and `docs/CONSENT_V2.md`.
 *
 * The reading itself is in `page.ts`, where it can be held against a real page by a test; this
 * file is the half that talks to `chrome`, keeps the consent and the clock, and sends.
 */
import { pageShape } from "./shape";
import { readPage } from "./page";

let count = 0;
let last = Date.now();
let idleReported = false;
let hiddenAt: number | null = null;

const bump = (): void => {
  count += 1;
  last = Date.now();
  idleReported = false;
};
window.addEventListener("pointerdown", bump, true);
window.addEventListener("keydown", bump, true); // counts a keypress, not which key
window.addEventListener("scroll", bump, true);

// ── the page layer: off unless consented, and consent is re-read whenever it changes ──
let pageConsent = false;
/** Anything but an explicit yes is no: a build that never read storage must sense nothing here. */
function readConsent(stored: unknown): void {
  const c = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  pageConsent = c.page === true;
}
chrome.storage.sync
  .get("consent")
  .then((v) => readConsent(v.consent))
  .catch(() => readConsent(null));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.consent) readConsent(changes.consent.newValue);
});

/**
 * How long between two reports of the same tab, at the least.
 *
 * `DESIGN_V2.md` records the trap from the window sensor: a title that animates changes every
 * half second, and comparing it makes a signal that never stops. A page does the same thing with
 * an unread count in its title or a clock in a heading. The shape is compared so an unchanged
 * page is silent, and this floor means even a page that changes constantly costs at most two
 * events a minute per tab.
 */
const PAGE_GAP_MS = 30_000;
let lastShape = "";
let lastPageAt = 0;

function reportPage(now: number): void {
  if (!pageConsent || document.hidden) return; // only the page somebody is actually looking at
  if (now - lastPageAt < PAGE_GAP_MS) return;
  const shape = pageShape(readPage(document));
  const key = JSON.stringify(shape);
  if (key === lastShape) return; // the same page, unchanged, is not news
  lastShape = key;
  lastPageAt = now;
  chrome.runtime.sendMessage({ kind: "page", payload: { ...shape, host: location.hostname } }).catch(() => {});
}

setInterval(() => {
  if (count > 0) {
    chrome.runtime.sendMessage({ kind: "interaction", payload: { count, host: location.hostname } }).catch(() => {});
    count = 0;
  }
  const idle = Math.round((Date.now() - last) / 1000);
  if (idle >= 60 && !idleReported) {
    idleReported = true;
    chrome.runtime.sendMessage({ kind: "idle", payload: { seconds: idle } }).catch(() => {});
  }
  reportPage(Date.now());
}, 10_000);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  const away = hiddenAt ? Math.round((Date.now() - hiddenAt) / 1000) : 0;
  hiddenAt = null;
  if (away >= 5) chrome.runtime.sendMessage({ kind: "visibility", payload: { visible: true, awaySeconds: away } }).catch(() => {});
});
