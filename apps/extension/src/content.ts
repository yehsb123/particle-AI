/**
 * Particle AI — content script. Two layers live here and they do not make the same promise.
 *
 * L0 interaction shape counts THAT interaction happened; it never reads keys, text, selection or
 * the DOM. The page layer does read the page: its title, a few headings, the labels of its boxes
 * and the names of its buttons. It is off until somebody turns it on in the options page, it
 * never reads a value anybody typed, and it never describes a box that could hold a password or
 * a card number — see `isSecretField` in shape.ts and `docs/CONSENT_V2.md`.
 */
import { pageShape, isSecretField, type PageField } from "./shape";

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
/** How many elements of one kind are looked at. A page with more than this is a page, not a form. */
const SCAN_LIMIT = 400;
let lastShape = "";
let lastPageAt = 0;

const textOf = (el: Element | null): string => (el ? (el.textContent ?? "").replace(/\s+/g, " ").trim() : "");

/** Only what somebody can actually see is described — a hidden input is machinery, not a question. */
const onScreen = (el: Element): boolean => el.getClientRects().length > 0;

/**
 * The name a person reads beside a box.
 *
 * The element's own `name` attribute is deliberately NOT a fallback: the probe found it carries
 * machinery rather than language (`authenticity_token`, `webauthn-iuvpaa-support`), and a box
 * nobody labelled says nothing worth sending.
 */
function labelOf(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const id = el.getAttribute("id");
  const tied = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
  return textOf(tied) || textOf(el.closest("label")) || el.getAttribute("placeholder") || "";
}

function take<T>(selector: string, map: (el: HTMLElement) => T): T[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).slice(0, SCAN_LIMIT).filter(onScreen).map(map);
}

/** What this page is, in names: read here, bounded and shaped in shape.ts. */
function readPage(): { title: string; headings: string[]; fields: PageField[]; actions: string[] } {
  return {
    title: document.title,
    headings: take("h1, h2, h3, [role=heading]", textOf),
    fields: take("input, textarea, select", (el) => {
      const box: PageField = {
        type: el.getAttribute("type") ?? el.tagName,
        autocomplete: el.getAttribute("autocomplete"),
        name: el.getAttribute("name"),
        id: el.getAttribute("id"),
      };
      // a box that can hold a secret is not labelled at all: its name is never read, only counted
      return isSecretField(box) ? box : { ...box, label: labelOf(el) };
    }),
    // the caption of a button: its own words, or the value attribute an <input> button carries
    // instead of text. That attribute is written by the page, never typed by anybody.
    actions: take("button, [role=button], input[type=submit], input[type=button]", (el) =>
      el.getAttribute("aria-label") || textOf(el) || el.getAttribute("value") || "",
    ),
  };
}

function reportPage(now: number): void {
  if (!pageConsent || document.hidden) return; // only the page somebody is actually looking at
  if (now - lastPageAt < PAGE_GAP_MS) return;
  const shape = pageShape(readPage());
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
