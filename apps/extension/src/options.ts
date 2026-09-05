import { DEFAULT_CONSENT, runtimeUrlFrom, type Consent } from "./shape";

const ids: (keyof Consent)[] = ["interactions", "tabs", "network"];
const box = (id: string) => document.getElementById(id) as HTMLInputElement;

/** Korean when the browser is Korean; English otherwise. Same wording as the body's i18n. */
const KO: Record<string, string> = {
  title: "Particle AI가 감지할 수 있는 것",
  lead: "형태만 — 내용은 절대 수집하지 않습니다. 런타임에서 원격 모델을 켜지 않는 한 이 컴퓨터 밖으로 아무것도 나가지 않습니다.",
  interactions: "상호작용 (L0)",
  interactions_desc: "클릭·스크롤·입력이 <em>있었다</em>는 사실과 시각만 — <em>무엇을</em> 했는지는 절대 아님",
  tabs: "탭·포커스 (L3)",
  tabs_desc: "이동한 사이트의 호스트명과 자리를 비운 시간 — 전체 URL이나 페이지 내용은 절대 아님",
  network: "통신 형태 (L2) — 옵트인",
  network_desc: "요청의 호스트명·상태 코드·지연시간 — 경로·쿼리·본문은 절대 아님",
  token: "런타임 토큰 (선택)",
  token_desc: "런타임의 <code>DM_INGEST_TOKEN</code>과 일치해야 합니다. 런타임에 토큰이 없으면 비워 두세요",
  runtimeUrl: "런타임 URL",
  runtimeUrl_desc: "이벤트가 전송되는 곳 — 기본은 이 컴퓨터입니다. 비우면 <code>http://localhost:8787</code>",
  runtime: "런타임",
  runtimeFellBack: "주소로 읽을 수 없어 기본값을 씁니다",
  body: "바디: 사이드 패널",
};

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
