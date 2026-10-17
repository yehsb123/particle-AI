import { DEFAULT_CONSENT, runtimeUrlFrom, type Consent } from "./shape";
import { KO } from "./wording";

const ids: (keyof Consent)[] = ["interactions", "tabs", "network"];
const box = (id: string) => document.getElementById(id) as HTMLInputElement;

function localize(): void {
  if (!navigator.language.toLowerCase().startsWith("ko")) return;
  document.documentElement.lang = "ko";
  document.title = "Particle AI — 감지 동의";
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-i18n]"))) {
    const key = el.dataset.i18n ?? "";
    // static strings from this file only — never user/page content, and an own key only, so a
    // data-i18n of "toString" cannot put a function's source into the page
    if (Object.hasOwn(KO, key)) el.innerHTML = KO[key] ?? "";
  }
}

/**
 * Say where events will actually go.
 *
 * This line promised the runtime's address and printed the default no matter what was configured,
 * while the box above it showed whatever had been typed. Somebody who typed an address the sensor
 * could not read was told twice that it was in use, and their events went somewhere else.
 *
 * It is drawn from what is stored, because that is what the background reads. Drawn from the box
 * instead it moved with every keystroke, so half-way through typing a new address the line already
 * named it while events still went to the old one — and the box only saves when the field is left,
 * so closing the tab with the caret still in it saved nothing at all. Where a sensor sends what it
 * observes is not a thing to be provisional about.
 */
function showDestination(stored: unknown): void {
  const el = document.getElementById("runtimeDestination");
  if (!el) return;
  const { url, fellBack } = runtimeUrlFrom(stored);
  const ko = document.documentElement.lang === "ko";
  const note = fellBack ? ` (${ko ? KO.runtimeFellBack : "not readable as an address, so the default is used"})` : "";
  el.textContent = url + note;
}

/** Read the whole form synchronously and write it as one object — no read-modify-write race. */
function save(): void {
  const consent: Consent = { interactions: box("interactions").checked, tabs: box("tabs").checked, network: box("network").checked };
  const token = box("token").value.trim();
  const runtimeUrl = box("runtimeUrl").value.trim();
  // the line below redraws from storage.onChanged, once the write has actually landed
  void chrome.storage.sync.set({ consent, token, runtimeUrl });
}

async function load(): Promise<void> {
  const v = await chrome.storage.sync.get(["consent", "token", "runtimeUrl"]);
  const c: Consent = { ...DEFAULT_CONSENT, ...((v.consent as Partial<Consent> | undefined) ?? {}) };
  for (const id of ids) box(id).checked = c[id];
  box("token").value = typeof v.token === "string" ? v.token : "";
  box("runtimeUrl").value = typeof v.runtimeUrl === "string" ? v.runtimeUrl : "";
  showDestination(v.runtimeUrl);
}

localize();
for (const id of ids) box(id).addEventListener("change", save);
box("token").addEventListener("change", save);
box("runtimeUrl").addEventListener("change", save);
// another options tab, or anything else that writes it, is describing this sensor too
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.runtimeUrl) showDestination(changes.runtimeUrl.newValue);
});
void load();
