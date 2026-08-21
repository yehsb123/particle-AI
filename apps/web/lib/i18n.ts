export type Lang = "en" | "ko";

/** UI chrome strings (the React shell) keyed by a short id. */
const CHROME: Record<string, { en: string; ko: string }> = {
  tagline: { en: "adaptive runtime · integrated loop", ko: "적응형 런타임 · 통합 루프" },
  simLab: { en: "Simulation lab", ko: "시뮬레이션 랩" },
  simIntro: {
    en: "You never ask for a dashboard. Emit an event; the runtime judges significance, decides, runs read-only capabilities, and reshapes its own body — reversibly.",
    ko: "대시보드를 요청하지 않습니다. 이벤트를 발생시키면 런타임이 중요도를 판단하고, 결정하고, 읽기 전용 능력을 실행한 뒤 스스로 몸을 재구성합니다 — 되돌릴 수 있게.",
  },
  controls: { en: "Controls", ko: "컨트롤" },
  undo: { en: "Undo last morph", ko: "마지막 변형 취소" },
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
    en: "Higher levels let more capability risks run without asking. Change it, then emit HTTP 500: at L4 the remediation auto-runs; at L0/L1 even reads need consent.",
    ko: "레벨이 높을수록 더 많은 위험 능력이 승인 없이 실행됩니다. 바꾼 뒤 HTTP 500을 눌러보세요: L4에선 조치가 자동 실행되고, L0·L1에선 읽기도 동의가 필요합니다.",
  },
  approvalTitle: { en: "Approval required", ko: "승인 필요" },
  approvalNote: {
    en: "The AI proposed a risky action. External effects never run without your consent.",
    ko: "AI가 위험한 작업을 제안했습니다. 외부 효과는 동의 없이 절대 실행되지 않습니다.",
  },
  approve: { en: "Approve", ko: "승인" },
  reject: { en: "Reject", ko: "거절" },
  inspectorTitle: { en: "Inspector — why did the UI change?", ko: "인스펙터 — UI가 왜 바뀌었나?" },
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
  memNone: { en: "No experience yet — emit a few events.", ko: "아직 경험이 없습니다 — 이벤트를 몇 개 발생시켜 보세요." },
  langButton: { en: "한국어", ko: "English" },
  // presence states
  observing: { en: "observing", ko: "관찰 중" },
  evaluating: { en: "evaluating", ko: "평가 중" },
  acting: { en: "acting", ko: "실행 중" },
  waiting_for_approval: { en: "waiting for approval", ko: "승인 대기" },
  idle: { en: "idle", ko: "대기" },
};

export function t(key: string, lang: Lang): string {
  return CHROME[key]?.[lang] ?? key;
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
};

/** Translate a blueprint content string when in Korean; unknown strings (code, logs) pass through. */
export function tr(text: string, lang: Lang): string {
  if (lang === "en") return text;
  return CONTENT[text] ?? text;
}
