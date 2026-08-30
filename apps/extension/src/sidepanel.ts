/**
 * Side panel shell: shows a hint when the body (web app on :3000) is not reachable, instead of a
 * silent blank panel. Probe only — no content is read. Korean when the browser is Korean.
 */
const hint = document.getElementById("offline") as HTMLElement;
const frame = document.querySelector("iframe") as HTMLIFrameElement;

const ko = navigator.language.toLowerCase().startsWith("ko");
const TEXT = ko
  ? "바디에 연결할 수 없습니다.\n\npnpm web    (바디 · localhost:3000)\npnpm runtime (런타임 · localhost:8787)\n\n두 프로세스를 켜면 이 패널이 자동으로 연결됩니다."
  : "The body is not reachable.\n\npnpm web    (body · localhost:3000)\npnpm runtime (runtime · localhost:8787)\n\nStart both and this panel connects on its own.";
hint.textContent = TEXT;

/** The body cannot read chrome.storage — pass the runtime token (if any) in its URL. */
async function bodySrc(): Promise<string> {
  const base = String(frame.dataset.src);
  try {
    const v = await chrome.storage.sync.get("token");
    const token = typeof v.token === "string" ? v.token.trim() : "";
    return token ? `${base}&token=${encodeURIComponent(token)}` : base;
  } catch {
    return base;
  }
}

let loaded = false;
async function probe(): Promise<void> {
  try {
    await fetch("http://localhost:3000/", { mode: "no-cors", cache: "no-store" });
    hint.hidden = true;
    if (!loaded) {
      loaded = true;
      frame.src = await bodySrc(); // (re)load the body once it is reachable
    }
  } catch {
    hint.hidden = false;
    loaded = false; // reload the body when it comes back
  }
}

void probe();
setInterval(() => void probe(), 3_000);
