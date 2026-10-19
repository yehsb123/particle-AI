export type Lang = "en" | "ko";

/** UI chrome strings (the React shell) keyed by a short id. */
const CHROME: Record<string, { en: string; ko: string }> = {
  tagline: { en: "adaptive runtime · integrated loop", ko: "적응형 런타임 · 통합 루프" },
  simLab: { en: "Simulation lab", ko: "시뮬레이션 랩" },
  simIntro: {
    en: "You never ask for a dashboard. Emit an event; the runtime judges significance, decides, runs read-only capabilities, and reshapes its own body — reversibly.",
    ko: "대시보드를 요청하지 않습니다. 이벤트를 발생시키면 런타임이 중요도를 판단하고, 결정하고, 읽기 전용 능력을 실행한 뒤 스스로 몸을 재구성합니다. 그 변경은 되돌릴 수 있습니다.",
  },
  controls: { en: "Controls", ko: "컨트롤" },
  undo: { en: "Undo last morph", ko: "마지막 변형 취소" },
  redo: { en: "Redo morph", ko: "변형 다시 실행" },
  theme: { en: "Theme", ko: "테마" },
  devMode: { en: "Developer mode", ko: "개발자 모드" },
  runtime: { en: "Runtime", ko: "런타임" },
  connectedNote: {
    en: "Events are sent to the runtime server; the UI morphs from WebSocket ui_patch messages. Start it with pnpm runtime.",
    ko: "이벤트가 런타임 서버로 전송되고, UI는 WebSocket ui_patch 메시지로 변형됩니다. pnpm runtime 으로 실행하세요.",
  },
  mode: { en: "mode", ko: "모드" },
  focus: { en: "focus", ko: "포커스" },
  autonomy: { en: "autonomy", ko: "자율성" },
  autonomyHint: {
    en: "Change it, then emit HTTP 500 and watch what the runtime does with the remediation.",
    ko: "레벨을 바꾼 뒤 HTTP 500을 눌러, 런타임이 조치를 어떻게 처리하는지 보세요.",
  },
  autonomyRunsNothing: {
    en: "does not act on its own — it answers when you ask",
    ko: "스스로 움직이지 않습니다. 직접 요청할 때만 답합니다",
  },
  autonomyRunsThese: {
    en: "runs {risks} on its own; asks before anything more",
    ko: "{risks}까지는 스스로 실행하고, 그보다 큰 일은 먼저 물어봅니다",
  },
  risk_read: { en: "reads", ko: "읽기" },
  risk_safe_write: { en: "safe writes", ko: "안전한 쓰기" },
  risk_external_effect: { en: "external effects", ko: "외부 효과" },
  risk_destructive: { en: "destructive actions", ko: "파괴적 작업" },
  approvalTitle: { en: "Approval required", ko: "승인 필요" },
  approvalNote: {
    en: "The AI proposed a risky action. External effects never run without your consent.",
    ko: "AI가 위험한 작업을 제안했습니다. 외부 효과는 동의 없이 절대 실행되지 않습니다.",
  },
  approval_risk_above_autonomy: {
    en: "riskier than this autonomy level runs on its own",
    ko: "현재 자율성 레벨이 스스로 실행할 수 있는 범위를 넘습니다",
  },
  approval_permission_not_granted: {
    en: "needs a permission nobody has granted yet",
    ko: "아직 아무도 허가하지 않은 권한이 필요합니다",
  },
  approve: { en: "Approve", ko: "승인" },
  reject: { en: "Reject", ko: "거절" },
  inspectorTitle: { en: "Inspector — why did the UI change?", ko: "인스펙터: UI가 바뀐 이유" },
  significance: { en: "significance", ko: "중요도" },
  deliberated: { en: "deliberated", ko: "심의됨" },
  provider: { en: "provider", ko: "프로바이더" },
  confidence: { en: "confidence", ko: "신뢰도" },
  morph: { en: "morph", ko: "변형" },
  applied: { en: "applied", ko: "적용됨" },
  none: { en: "none", ko: "없음" },
  yes: { en: "yes", ko: "예" },
  no: { en: "no", ko: "아니오" },
  logTitle: { en: "Event / morph log", ko: "이벤트 / 변형 로그" },
  noEvents: { en: "No events yet.", ko: "아직 이벤트가 없습니다." },
  // developer inspector
  tabTrace: { en: "Event trace", ko: "이벤트 트레이스" },
  tabWorld: { en: "World state", ko: "월드 상태" },
  tabDecision: { en: "Decision", ko: "결정" },
  tabMemory: { en: "Memory", ko: "메모리" },
  tabAudit: { en: "Audit", ko: "감사" },
  memEpisodic: { en: "Episodic", ko: "에피소드" },
  memPreferences: { en: "Preferences (reinforced)", ko: "선호 (강화됨)" },
  memPatterns: { en: "Pattern candidates (reusable-template suggestions)", ko: "패턴 후보 (재사용 템플릿 제안)" },
  memNone: { en: "No experience yet — emit a few events.", ko: "아직 경험이 없습니다. 이벤트를 몇 개 발생시켜 보세요." },
  langButton: { en: "한국어", ko: "English" },
  coachText: {
    en: "👉 Click a button on the right (try HTTP 500). You never ask for a screen — the AI notices the event and rebuilds the workspace by itself.",
    ko: "오른쪽 버튼을 눌러보세요 (HTTP 500 추천). 화면을 요청하지 않아도 AI가 이벤트를 감지해 워크스페이스를 스스로 재구성합니다.",
  },
  coachDismiss: { en: "Got it", ko: "확인" },
  // AI presence inspector popover (spec §23)
  presenceTitle: { en: "What is the AI doing?", ko: "AI가 지금 하는 일" },
  presenceState: { en: "state", ko: "상태" },
  presenceWatching: { en: "observing", ko: "관찰 대상" },
  presenceWatchingValue: { en: "workspace events (builds, tests, runtime)", ko: "워크스페이스 이벤트 (빌드·테스트·런타임)" },
  presenceLastReason: { en: "why the UI changed", ko: "UI가 바뀐 이유" },
  presenceNoReason: { en: "no morph yet — emit an event", ko: "아직 변형 없음. 이벤트를 발생시켜 보세요" },
  presencePlanned: { en: "awaiting your approval", ko: "승인 대기 중" },
  presenceNothingPlanned: { en: "nothing pending", ko: "대기 중인 작업 없음" },
  presenceAutonomy: { en: "autonomy level", ko: "자율성 레벨" },
  // pattern suggestion banner (spec §20 — suggest-only, never auto-mutates)
  patternTitle: { en: "Pattern noticed", ko: "패턴 감지" },
  patternText: {
    en: "This flow keeps repeating. It could become a reusable workspace template.",
    ko: "이 흐름이 계속 반복되고 있어요. 재사용 워크스페이스 템플릿으로 만들 수 있습니다.",
  },
  patternTimes: { en: "times", ko: "회 반복" },
  patternLater: { en: "Maybe later", ko: "나중에" },
  // learned-preference banner (Concept v2 P4 — undo is feedback)
  learnedTitle: { en: "Learned from you", ko: "학습했어요" },
  learnedText: {
    en: "You dismissed this kind of change twice, so it won't be offered automatically again this session:",
    ko: "이런 종류의 변경을 두 번 닫으셔서 이 세션에서는 더 이상 자동으로 띄우지 않습니다:",
  },
  learnedOk: { en: "Got it", ko: "확인" },
  // replay (spec §21)
  replayBtn: { en: "Replay & verify", ko: "리플레이 & 검증" },
  replayIdentical: { en: "deterministic ✓ — replaying the event log reproduced this exact UI", ko: "결정론 확인: 이벤트 로그 리플레이가 현재 UI를 정확히 재현했습니다" },
  replayDiffers: { en: "differs — undo/approvals are not events, so the replay diverged (expected)", ko: "불일치: undo 와 승인은 이벤트가 아니므로 리플레이가 달라짐 (정상)" },
  replayNone: { en: "no events to replay yet", ko: "리플레이할 이벤트가 없습니다" },
  // session persistence (local mode)
  resetSession: { en: "Reset session", ko: "세션 초기화" },
  restoredNote: { en: "session restored from the event log", ko: "이벤트 로그에서 세션을 복원했습니다" },
  // morph history strip
  historyTitle: { en: "Morph history", ko: "변형 기록" },
  historyHint: { en: "click a step to undo back to before it", ko: "단계를 클릭하면 그 이전으로 되돌립니다" },
  historyEmpty: { en: "no morphs yet", ko: "아직 변형 없음" },
  // morph held (guard) explanations
  heldTitle: { en: "Morph held", ko: "변형 보류" },
  held_cooldown_active: { en: "the interface just changed — waiting a moment so it doesn't jump around", ko: "방금 화면이 바뀌어서 튀지 않도록 잠시 기다리는 중" },
  held_major_dwell_active: { en: "a major change happened recently — letting it settle first", ko: "최근 큰 변경이 있어 먼저 안정될 때까지 대기" },
  held_protects_focus: { en: "you are typing — not restructuring around your cursor", ko: "입력 중이라 커서 주변을 재구성하지 않음" },
  held_protects_unsaved_state: { en: "unsaved work here — never discarded", ko: "미저장 작업이 있어 절대 버리지 않음" },
  held_confidence_below_min: { en: "not confident enough to change the layout", ko: "레이아웃을 바꿀 만큼 확신이 없음" },
  heldRetry: { en: "catches up on its own in ~{s}s", ko: "약 {s}초 후 스스로 따라잡습니다" },
  presenceLearned: { en: "learned from you", ko: "학습한 내용" },
  prefDismissed: { en: "won't auto-offer", ko: "자동 표시 안 함" },
  held_structural_confidence_below_min: { en: "not confident enough for a structural change", ko: "구조 변경을 할 만큼 확신이 없음" },
  held_learned_preference: { en: "you have dismissed this kind of card before — not offering it again", ko: "이런 카드를 전에 닫으셔서 다시 제안하지 않음" },
  held_structurally_impossible: { en: "the change did not fit the screen as it is now — nothing was half-applied", ko: "지금 화면 구조와 맞지 않아 반쯤 적용된 부분은 없음" },
  // intent (Concept v2)
  intentTitle: { en: "intent", ko: "의도" },
  // the morph history strip: what each step did, in words rather than an identifier
  step_surface_incident: { en: "surfaced the incident", ko: "인시던트를 띄움" },
  step_restore_normal: { en: "back to normal", ko: "평소 화면으로" },
  step_augment: { en: "added context", ko: "컨텍스트 추가" },
  step_none: { en: "no change", ko: "변경 없음" },
  step_dismiss: { en: "dismissed a card", ko: "카드를 닫음" },
  step_morph: { en: "changed the layout", ko: "레이아웃 변경" },
  intent_exploring: { en: "exploring", ko: "탐색 중" },
  intent_focused: { en: "focused", ko: "집중 중" },
  intent_stuck: { en: "stuck", ko: "막힘" },
  intent_switching: { en: "switching", ko: "전환 중" },
  intent_idle: { en: "idle", ko: "유휴" },
  intent_returning: { en: "returning", ko: "복귀" },
  intent_debugging: { en: "debugging", ko: "디버깅 중" },
  sensingNote: { en: "sensing: clicks, dwell, idle, tab visibility — these four read shape only, never content", ko: "감지 중: 클릭, 체류, 유휴, 탭 가시성. 이 넷은 형태만 읽고 내용은 보지 않습니다" },
  sensingPrefix: { en: "currently sensing", ko: "현재 감지 중" },
  // The caption used to speak for the whole product. It speaks for the layers listed beside it,
  // and the screen layer is named as the exception rather than covered by it (docs/CONSENT_V2.md).
  sensingShapeOnly: { en: "these layers read shape only — never content", ko: "이 계층들은 형태만 읽고 내용은 보지 않습니다" },
  sensingScreenExcepted: { en: "except screen capture, which reads what is in the window it names", ko: "화면 캡처만 예외입니다. 이름이 적힌 창 안의 내용을 읽습니다" },
  // The browser's counterpart to that exception: the extension's page layer reads the names on
  // the page somebody is on, so the caption may not sweep it into "shape only" either.
  sensingPageExcepted: { en: "except page structure, which reads the names on the page you are on", ko: "페이지 구조 계층도 예외입니다. 보고 있는 페이지의 제목과 이름들을 읽습니다" },
  // The screen layer's own consent wording: what it takes, where it lands, where it goes, how to
  // stop it. Shown in the presence popover whether or not capture is running, because wording a
  // person only meets once the camera is already on is wording they never agreed to.
  screenConsentTitle: { en: "Screen capture (off until DM_CAPTURE and DM_CAPTURE_APPS are both set)", ko: "화면 캡처 (DM_CAPTURE 와 DM_CAPTURE_APPS 를 둘 다 채우기 전까지는 꺼져 있습니다)" },
  screenConsentWhat: { en: "What it takes: a picture of one window of an app you listed. It reads what is in that window — text, numbers, messages. No other layer does.", ko: "찍는 대상: 목록에 적은 앱의 창 하나를 그림으로 찍습니다. 그 창 안의 글자와 숫자와 메시지를 읽습니다. 다른 계층은 이렇게 하지 않습니다." },
  screenConsentWhere: { en: "Where it lands: a png on this machine, under DM_CAPTURE_DIR, or the system temp directory when that names nothing.", ko: "저장 위치: 이 컴퓨터에 png 로 저장됩니다. 위치는 DM_CAPTURE_DIR 이고, 비어 있으면 시스템 임시 폴더입니다." },
  screenConsentLeaves: { en: "Where it goes: the runtime is handed the file name, never the pixels. With DM_SCREEN_READ set the picture itself is handed to a model, which is a separate switch and off until you set it; with it unset the picture stays on this disk, unread.", ko: "나가는 곳: 런타임에는 파일 이름만 전달되고 픽셀은 가지 않습니다. DM_SCREEN_READ 를 채우면 그림 자체가 모델로 가며, 이 스위치는 캡처와 별개이고 채우기 전까지는 꺼져 있습니다. 비워 두면 그림은 이 디스크에 남고 아무도 읽지 않습니다." },
  screenConsentOff: { en: "How to stop it: clear DM_SCREEN_READ to stop a model being handed the pictures, clear DM_CAPTURE_APPS to drop one app or all of them, or clear DM_CAPTURE to turn the camera off. Pictures already taken stay in that directory until you delete them.", ko: "끄는 방법: DM_SCREEN_READ 를 지우면 그림이 모델로 가지 않고, DM_CAPTURE_APPS 에서 앱을 빼거나 전부 지우면 그 앱은 더 찍지 않고, DM_CAPTURE 를 지우면 카메라 자체가 꺼집니다. 이미 찍은 그림은 직접 지우기 전까지 그 폴더에 남습니다." },
  sensor_web: { en: "this page", ko: "이 페이지" },
  sensor_extension: { en: "browser extension", ko: "브라우저 확장" },
  sensor_agent: { en: "desktop agent", ko: "데스크톱 에이전트" },
  sensor_unknown: { en: "a sensor that did not say what it is", ko: "이름을 밝히지 않은 센서" },
  layer_interactions: { en: "interactions", ko: "상호작용" },
  layer_idle: { en: "idle", ko: "유휴" },
  layer_visibility: { en: "visibility", ko: "탭 가시성" },
  layer_dwell: { en: "dwell", ko: "체류" },
  layer_tabs: { en: "tabs & focus", ko: "탭·포커스" },
  layer_network: { en: "communication shape", ko: "통신 형태" },
  layer_files: { en: "file saves", ko: "파일 저장" },
  layer_output: { en: "test/build output", ko: "테스트/빌드 출력" },
  layer_git: { en: "git branch", ko: "git 브랜치" },
  layer_windows: { en: "active window", ko: "활성 창" },
  layer_screen: { en: "screen capture", ko: "화면 캡처" },
  layer_page: { en: "page structure", ko: "페이지 구조" },
  sensingNone: { en: "nothing reported yet", ko: "아직 보고된 센서 없음" },
  sessionsTitle: { en: "Sensed on this computer", ko: "이 컴퓨터에서 감지 중" },
  sessionsProblems: { en: "open", ko: "열림" },
  sessionsNoLayers: { en: "no layers reported", ko: "보고된 레이어 없음" },
  // templates for generated sentences (params are identifiers/numbers only)
  tpl_problems_open: { en: "{n} open problem(s): {list}.", ko: "열린 문제 {n}건: {list}." },
  tpl_calm_files: { en: "Nothing broke while you were away. Recent files: {files}.", ko: "자리를 비운 동안 깨진 것은 없습니다. 최근 파일: {files}." },
  tpl_calm: { en: "Nothing broke while you were away. Workspace is calm.", ko: "자리를 비운 동안 깨진 것은 없습니다. 워크스페이스는 조용합니다." },
  tpl_juggling: {
    en: "Moving between: {places}. Pinned here so you don't have to hold them in your head.",
    ko: "{places} 사이를 오가고 있어요. 머릿속에 붙들고 있지 않도록 여기 고정해 두었습니다.",
  },
  tpl_juggling_none: {
    en: "You keep moving between a few places. They are pinned here so you don't have to hold them in your head.",
    ko: "몇 곳을 계속 오가고 있어요. 머릿속에 붙들고 있지 않도록 여기 고정해 두었습니다.",
  },
  runtimeServer: { en: "server", ko: "서버" },
  runtimeLocal: { en: "local", ko: "로컬" },
  typing: { en: "typing", ko: "입력 중" },
  fallback: { en: "fallback", ko: "폴백" },
  autonomy_0: { en: "manual", ko: "수동" },
  autonomy_1: { en: "suggestive", ko: "제안만" },
  autonomy_2: { en: "adaptive UI", ko: "적응형 UI" },
  autonomy_3: { en: "assisted", ko: "보조 실행" },
  autonomy_4: { en: "autonomous", ko: "자율" },
  // linked AI accounts (contracts: ACCOUNT_LINK_KINDS / _STATES / _REASONS — both languages or
  // the Korean screen shows the vocabulary word itself)
  accountLinksTitle: { en: "Linked AI accounts", ko: "연동된 AI 계정" },
  link_kind_api_key: { en: "API key", ko: "API 키" },
  link_kind_browser_session: { en: "signed-in browser session", ko: "로그인된 브라우저 세션" },
  link_state_linked: { en: "linked", ko: "연결됨" },
  link_state_not_linked: { en: "not linked", ko: "연결 안 됨" },
  link_state_not_operable: { en: "declared, but unusable for now", ko: "등록했지만 아직 쓸 수 없음" },
  link_reason_api_key_present: { en: "a key for this account is configured", ko: "이 계정의 키가 설정되어 있습니다" },
  link_reason_credential_absent: { en: "nothing is configured for this account", ko: "이 계정에 설정된 것이 없습니다" },
  link_reason_session_control_not_built: {
    en: "using a session you are already signed into is not built yet — nothing touches your browser",
    ko: "이미 로그인된 세션을 사용하는 기능은 아직 없습니다. 브라우저를 건드리지 않습니다",
  },
  // presence states
  observing: { en: "observing", ko: "관찰 중" },
  evaluating: { en: "evaluating", ko: "평가 중" },
  acting: { en: "acting", ko: "실행 중" },
  waiting_for_approval: { en: "waiting for approval", ko: "승인 대기" },
  idle: { en: "idle", ko: "대기" },
};

export function t(key: string, lang: Lang): string {
  // own keys only — a lookup table is a table, not a prototype chain (see `tr` below)
  return Object.hasOwn(CHROME, key) ? (CHROME[key]?.[lang] ?? key) : key;
}

/**
 * Generated sentences are never translated as strings. Capabilities emit a template id plus
 * identifier-only params; the renderer fills the localized template here. Unknown `{slots}` stay
 * visible so a missing param is noticed, not hidden.
 */
export function fillTemplate(tpl: string, params: Record<string, unknown> = {}): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => {
    // `in` walks the prototype chain, so {toString} used to render the source of a native
    // function into a sentence someone reads. A param that is present but undefined has nothing
    // to say either, and the slot staying visible is the point of this function.
    if (!Object.hasOwn(params, k)) return m;
    const v = params[k];
    return v === undefined ? m : String(v);
  });
}

/** Content strings that live inside blueprints (titles, badges, status). English → Korean. */
const CONTENT: Record<string, string> = {
  Workspace: "워크스페이스",
  development: "개발",
  CRITICAL: "위험",
  BUILD: "빌드",
  TESTS: "테스트",
  "Build failed": "빌드 실패",
  "Test failed": "테스트 실패",
  "Service recovered": "서비스 복구",
  "Build succeeded": "빌드 성공",
  "High CPU": "높은 CPU",
  "Critical alert": "심각 경보",
  Files: "파일",
  "Development status": "개발 상태",
  "Build: passing": "빌드: 통과",
  "Tests: 42 passing": "테스트: 42개 통과",
  unsaved: "미저장",
  editor: "에디터",
  // incident (runtime)
  "Runtime incident": "런타임 인시던트",
  "Error logs": "에러 로그",
  "Recent changes": "최근 변경",
  "Service state": "서비스 상태",
  "AI assessment": "AI 진단",
  "Incident timeline": "인시던트 타임라인",
  "Errors / min": "분당 에러",
  "Suggested actions": "제안된 조치",
  "Revert recent diff": "최근 변경 되돌리기",
  "Undo this change": "이 변경 취소",
  confidence: "신뢰도",
  Service: "서비스",
  State: "상태",
  failed: "실패",
  healthy: "정상",
  // build failure
  "Build failure": "빌드 실패",
  "Compiler errors": "컴파일 에러",
  "Build timeline": "빌드 타임라인",
  // test failure
  "Test failure": "테스트 실패",
  "Failing tests": "실패한 테스트",
  Assertion: "단언(assertion)",
  "Test timeline": "테스트 타임라인",
  Test: "테스트",
  Status: "상태",
  passed: "통과",
  // incident content sentences
  "Probable cause: `db.users` renamed to `db.user` in the recent diff. Confidence 82%.":
    "추정 원인: 최근 변경에서 `db.users`가 `db.user`로 변경됨. 신뢰도 82%.",
  "First 500 on GET /users/42": "GET /users/42 첫 500 발생",
  "Error rate spike detected": "에러율 급증 감지",
  "Probable cause localized to recent diff": "추정 원인을 최근 변경으로 좁힘",
  "The rename `db.users` → `db.user` broke the type check. Revert or fix the reference.":
    "`db.users` → `db.user` 변경이 타입 체크를 깨뜨렸습니다. 되돌리거나 참조를 수정하세요.",
  "Build started": "빌드 시작",
  "Type error in src/routes.ts": "src/routes.ts 타입 에러",
  "getUser returns a user": "getUser가 사용자를 반환한다",
  "getUser handles missing id": "getUser가 없는 id를 처리한다",
  "`getUser` returns undefined — the `db.user` lookup likely misses. Confidence 78%.":
    "`getUser`가 undefined 반환. `db.user` 조회 실패 추정. 신뢰도 78%.",
  "Test run started": "테스트 실행 시작",
  "Suite failed": "스위트 실패",
  recurring: "반복 발생",
  // security scenario
  "Security alert": "보안 경보",
  SECURITY: "보안",
  "Vulnerable dependency": "취약 의존성",
  Package: "패키지",
  Severity: "심각도",
  Advisory: "권고",
  critical: "심각",
  "`lodash@4.17.20` has a known prototype-pollution vulnerability. Updating to 4.17.21 resolves it.":
    "`lodash@4.17.20`에 알려진 프로토타입 오염 취약점이 있습니다. 4.17.21로 업데이트하면 해결됩니다.",
  "Security timeline": "보안 타임라인",
  "Advisory published": "권고 공개됨",
  "Dependency matched in lockfile": "락파일에서 의존성 일치 확인",
  "Awaiting your decision": "사용자 결정 대기",
  "Update dependency": "의존성 업데이트",
  "Vulnerability found": "취약점 발견",
  "Vulnerability patched": "취약점 패치됨",
  // network shape scenario (Concept v2, L2)
  "Connection trouble": "연결 문제",
  NETWORK: "네트워크",
  "Failing hosts": "실패 중인 호스트",
  Host: "호스트",
  failing: "실패 중",
  "A service you depend on is failing. Nothing on your side changed - this was read from the shape of your traffic (host, status, latency), never its content.":
    "의존하는 서비스가 실패하고 있습니다. 사용자 쪽에서 바뀐 것은 없습니다 - 통신의 형태(호스트·상태·지연시간)만 읽었고, 내용은 절대 보지 않았습니다.",
  "Connection timeline": "연결 타임라인",
  "First failing response": "첫 실패 응답",
  "Host marked as failing": "호스트를 실패 상태로 표시",
  "Watching for recovery": "복구 감시 중",
  "API 503": "API 503",
  "API recovered": "API 복구",
  // augment cards (behavior-driven, no error involved)
  "Welcome back": "다시 오셨네요",
  "You were away. Nothing broke while you were gone — here is where you left off.":
    "자리를 비우셨었네요. 그동안 깨진 곳은 없습니다. 여기서 이어가시면 됩니다.",
  "You seem stuck on this": "여기서 막힌 것 같아요",
  "The same action has repeated several times. Related context is now beside your work.":
    "같은 행동이 여러 번 반복됐습니다. 관련 컨텍스트를 작업 옆에 두었습니다.",
  Dismiss: "닫기",
  "What repeated": "반복된 것",
  Signal: "신호",
  Detail: "내용",
  "Repeated action": "반복한 행동",
  "Open problems": "열린 문제",
  none: "없음",
  "Recent places": "최근 위치",
  // switching (augment)
  "Juggling several things": "여러 가지를 오가는 중",
  "You keep moving between a few places. They are pinned here so you don't have to hold them in your head.":
    "몇 곳을 계속 오가고 있어요. 머릿속에 붙들고 있지 않도록 여기 고정해 두었습니다.",
};

/** Translate a blueprint content string when in Korean; unknown strings (code, logs) pass through. */
export function tr(text: string, lang: Lang): string {
  if (lang === "en") return text;
  // Every content string in a blueprint comes through here, and the model chooses those strings.
  // `CONTENT[text]` walked the prototype chain, so a component whose text was "toString" got a
  // FUNCTION back — which React refuses to render, taking the whole screen down with it.
  return Object.hasOwn(CONTENT, text) ? (CONTENT[text] ?? text) : text;
}
