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

/**
 * Hand one report to the worker, and say whether it took it.
 *
 * MV3 throws the worker away after thirty idle seconds and starts it again on the next message,
 * and a message sent into that gap is refused. Every counter below used to be cleared on the
 * line after the send rather than after its answer, so whatever went into that gap was gone: the
 * worker never saw it and nothing here remembered it either.
 */
async function relay(kind: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    await chrome.runtime.sendMessage({ kind, payload });
    return true;
  } catch {
    return false; // the worker is restarting; whatever this carried stays counted for next time
  }
}

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
const consentRead: Promise<void> = chrome.storage.sync
  .get("consent")
  .then((v) => readConsent(v.consent))
  .catch(() => readConsent(null));
chrome.storage.onChanged.addListener((changes, area) => {
  // Behind the first read, always. A change that overtook it was undone by it moments later: the
  // script starts, the read is in flight, somebody turns the page layer off, and the answer that
  // was already on its way turns it back on with nothing to say it had happened.
  if (area === "sync" && changes.consent) void consentRead.then(() => readConsent(changes.consent?.newValue));
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

async function reportPage(now: number): Promise<void> {
  if (!pageConsent || document.hidden) return; // only the page somebody is actually looking at
  if (now - lastPageAt < PAGE_GAP_MS) return;
  const shape = pageShape(readPage(document));
  const key = JSON.stringify(shape);
  if (key === lastShape) return; // the same page, unchanged, is not news
  if (!(await relay("page", { ...shape, host: location.hostname }))) return; // read again next cycle
  lastShape = key;
  lastPageAt = now;
}

/** A return from an absence nobody has heard about yet, kept until somebody has. */
let awayPending: number | null = null;
let reportingAway = false;
async function reportAway(): Promise<void> {
  if (reportingAway) return;
  reportingAway = true;
  try {
    const away = awayPending;
    if (away === null) return;
    if (!(await relay("visibility", { visible: true, awaySeconds: away }))) return;
    // A longer absence recorded while this was in flight is not cleared by this one arriving.
    if (awayPending === away) awayPending = null;
  } finally {
    reportingAway = false;
  }
}

let reporting = false;
async function tick(): Promise<void> {
  // A cycle still waiting on a worker that is restarting must not be joined by the next one:
  // both would send the same batch, and the person's interactions would be counted twice.
  if (reporting) return;
  reporting = true;
  try {
    if (count > 0) {
      const batch = count;
      // Subtracted rather than zeroed: what happened while the send was in flight is still
      // waiting to be reported, and it did not go out with this batch.
      if (await relay("interaction", { count: batch, host: location.hostname })) count -= batch;
    }
    const idle = Math.round((Date.now() - last) / 1000);
    if (idle >= 60 && !idleReported) idleReported = await relay("idle", { seconds: idle });
    await reportAway();
    await reportPage(Date.now());
  } finally {
    reporting = false;
  }
}
setInterval(() => void tick(), 10_000);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    hiddenAt = Date.now();
    return;
  }
  const away = hiddenAt ? Math.round((Date.now() - hiddenAt) / 1000) : 0;
  hiddenAt = null;
  if (away < 5) return;
  // The longest unreported absence, not the latest: two returns before either is taken means an
  // hour away and a glance at another tab, and the hour is the one that says what happened.
  awayPending = Math.max(awayPending ?? 0, away);
  void reportAway();
});
