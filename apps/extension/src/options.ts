import { DEFAULT_CONSENT, type Consent } from "./shape";

const ids: (keyof Consent)[] = ["interactions", "tabs", "network"];
const box = (id: string) => document.getElementById(id) as HTMLInputElement;

/** Read the whole form synchronously and write it as one object — no read-modify-write race. */
function save(): void {
  const consent: Consent = { interactions: box("interactions").checked, tabs: box("tabs").checked, network: box("network").checked };
  const token = box("token").value.trim();
  void chrome.storage.sync.set({ consent, token });
}

async function load(): Promise<void> {
  const v = await chrome.storage.sync.get(["consent", "token"]);
  const c: Consent = { ...DEFAULT_CONSENT, ...((v.consent as Partial<Consent> | undefined) ?? {}) };
  for (const id of ids) box(id).checked = c[id];
  box("token").value = typeof v.token === "string" ? v.token : "";
}

for (const id of ids) box(id).addEventListener("change", save);
box("token").addEventListener("change", save);
void load();
