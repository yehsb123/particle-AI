import { DEFAULT_CONSENT, type Consent } from "./shape";

const ids: (keyof Consent)[] = ["interactions", "tabs", "network"];

async function current(): Promise<Consent> {
  const v = await chrome.storage.sync.get("consent");
  return { ...DEFAULT_CONSENT, ...((v.consent as Consent | undefined) ?? {}) };
}

async function load(): Promise<void> {
  const c = await current();
  for (const id of ids) (document.getElementById(id) as HTMLInputElement).checked = c[id];
}

for (const id of ids) {
  document.getElementById(id)?.addEventListener("change", async () => {
    const c = await current();
    c[id] = (document.getElementById(id) as HTMLInputElement).checked;
    await chrome.storage.sync.set({ consent: c });
  });
}

void load();
