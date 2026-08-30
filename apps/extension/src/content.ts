/**
 * Particle AI — content script (L0 interaction shape). Counts THAT interaction happened;
 * never reads keys, text, selection, or DOM content.
 */
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
