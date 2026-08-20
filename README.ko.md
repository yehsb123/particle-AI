# Particle AI

AI가 맥락을 지속적으로 해석해 **자기 인터페이스·능력·지능을 사용자의 현재 상황에 맞춰 스스로 재구성**하는 실험적 적응형 컴퓨팅 런타임입니다.

AI에게 소프트웨어를 *사용하게* 하는 대신, **AI가 소프트웨어 자체**가 됩니다.

> ⚠️ 실험적 연구 소프트웨어입니다. 프로덕션용이 아닙니다.

[English README →](README.md)

## 핵심 아이디어

기존 생성형 AI는 `프롬프트 → 모델 → 응답` 구조입니다. Particle AI는 대신 다음 루프를 계속 돕니다:

```
관찰 → 이해 → 중요도 평가 → 의도 추론 → 결정
→ 지능 선택 → 능력 선택 → 실행 → 인터페이스 변형(morph)
→ 결과 관찰 → 반복
```

인터페이스는 AI의 **몸**입니다. 의미 있는 일이 벌어지면 — 빌드 실패, HTTP 500 — 런타임이 **스스로** 알아채고 그 사건에 맞춰 워크스페이스를 재구성합니다. 사용자는 "에러 대시보드 보여줘"라고 **한 번도 말하지 않습니다.**

안전을 보장하는 가드레일:

- 모델은 **검증된 UI 데이터**(`UIBlueprint` / `UIPatch`)만 내보내며, 실행 가능한 코드는 절대 생성하지 않습니다.
- **Morph Guard**가 UI가 튀지 않도록 막습니다: 쿨다운, dwell 시간, 포커스 보호, 미저장 작업 보호.
- 모든 변형은 **되돌릴 수 있고**(undo), 모든 결정은 **감사 가능**합니다.
- 전체가 **결정론적 mock 모드**로 API 키 없이 돌아갑니다.
- 프로바이더는 추상화되어 있어 — Anthropic / OpenAI / 로컬 모델을 코어 수정 없이 교체할 수 있습니다.
- 반복되는 상황은 **패턴으로 감지**되어 재사용 템플릿 후보로 제안됩니다(자동 변형은 하지 않음).

## 빠른 시작

```bash
pnpm install
pnpm test          # 유닛/통합 테스트
pnpm web           # http://localhost:3000 (다른 포트: pnpm --filter @particle/web start -- -p 4000)
pnpm runtime       # http://localhost:8787 (connected 모드용 백엔드 런타임)
```

API 키가 필요 없습니다 — 기본은 결정론적 mock 프로바이더입니다. 실제 프로바이더를 켜려면 `.env.example`을 `.env`로 복사하고 키를 넣으세요(`ANTHROPIC_API_KEY` 등). 서버는 자동으로 실제 두뇌를 사용하며 `GET /api/brain`에서 활성 프로바이더를 확인할 수 있습니다.

## 화면에서 확인하기

1. `pnpm web` → **http://localhost:3000** (또는 4000)
2. 우측 **Simulation Lab**에서 `HTTP 500` 클릭 → 아무 요청도 안 했는데 런타임이 인시던트 워크스페이스로 스스로 변형(에디터의 미저장 작업은 보존).
3. `Service recovered` → 개발 화면으로 원복. `Undo last morph` → 되돌리기.
4. `High CPU` / `Critical alert` → 현재 맥락과 무관하므로 **모프 없음**.
5. **Developer mode** 토글 → 이벤트 트레이스·월드 상태·구조화된 결정·감사 트레일 확인.
6. **Runtime: local ↔ server** 토글 → `pnpm runtime` 실행 시 UI가 백엔드 WebSocket `ui_patch`로 변형.

## 데이터 영속화 (선택)

`DATABASE_URL`이 설정되면 이벤트가 Postgres(Drizzle + postgres-js)에 durable하게 저장됩니다. 없으면 인메모리 + 결정론적 리플레이로 동작합니다.

```bash
docker compose up -d postgres   # 로컬 Postgres
```

## 아키텍처

전체 구조는 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), 런타임 루프는 [`docs/RUNTIME_LOOP.md`](docs/RUNTIME_LOOP.md), 설계 결정은 [`docs/adr/`](docs/adr/), 진행 상황은 [`docs/STATUS.md`](docs/STATUS.md)를 보세요.

내부 패키지는 `@particle/*` 네임스페이스이며, pnpm + Turborepo 모노레포로 구성됩니다.

## 상태

Phase 0–8(MVP) 완료 + 확장(전 컴포넌트 렌더러, Postgres 영속화, 실제 프로바이더 배선, 메모리/패턴 감지, 승인 플로우, Material 3 디자인). 유닛/통합 테스트 + Playwright E2E(로컬·connected) 전부 통과.
