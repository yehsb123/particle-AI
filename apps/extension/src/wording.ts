/**
 * The consent page in Korean.
 *
 * The page itself carries the English; this file carries the other half. It is a module of its
 * own rather than a constant inside `options.ts` because that file talks to `chrome` the moment
 * it loads, and the wording a person consents to has to be readable by a test that has no
 * browser. `wording.test.ts` holds the two halves against each other.
 */
export const KO: Record<string, string> = {
  title: "Particle AI가 감지할 수 있는 것",
  lead: "아래 계층은 전부 형태만 읽고 내용은 보지 않습니다. 런타임에서 원격 모델을 켜지 않는 한 이 컴퓨터 밖으로 아무것도 나가지 않습니다.",
  interactions: "상호작용 (L0)",
  interactions_desc: "클릭·스크롤·입력이 <em>있었다</em>는 사실과 시각만 — <em>무엇을</em> 했는지는 절대 아님",
  tabs: "탭·포커스 (L3)",
  tabs_desc: "이동한 사이트의 호스트명과 자리를 비운 시간 — 전체 URL이나 페이지 내용은 절대 아님",
  network: "통신 형태 (L2) — 옵트인",
  network_desc: "요청의 호스트명·상태 코드·지연시간 — 경로·쿼리·본문은 절대 아님",
  screenNote: "여기에 없는 계층이 하나 있습니다. 화면 캡처는 창 안의 내용을 읽고, 이 확장이 아니라 런타임에 속하며, 런타임에서 <code>DM_CAPTURE</code>를 설정하기 전까지 꺼져 있습니다. 이 페이지의 스위치로는 켜지지 않습니다.",
  token: "런타임 토큰 (선택)",
  token_desc: "런타임의 <code>DM_INGEST_TOKEN</code>과 일치해야 합니다. 런타임에 토큰이 없으면 비워 두세요",
  runtimeUrl: "런타임 URL",
  runtimeUrl_desc: "이벤트가 전송되는 곳 — 기본은 이 컴퓨터입니다. 비우면 <code>http://localhost:8787</code>",
  runtime: "런타임",
  runtimeFellBack: "주소로 읽을 수 없어 기본값을 씁니다",
  body: "바디: 사이드 패널",
};

