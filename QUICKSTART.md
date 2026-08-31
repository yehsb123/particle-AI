# Quickstart — feel it in 5 minutes · 5분 체험

Particle AI is a layer over your computer that infers what you're doing and reshapes its own
interface **before and without anything breaking**. This walkthrough makes each claim visible.
파티클 AI는 컴퓨터 위에 씌우는 레이어입니다. 아래 순서대로 하면 각 주장에 해당하는 화면 변화를 직접 보게 됩니다.

```bash
pnpm install
pnpm runtime     # the brain server · 런타임 (localhost:8787)
pnpm web         # the body · 바디 (localhost:3000)
```

## 1 — Behavior, not errors · 에러 없이 행동만으로 (30s)

Open http://localhost:3000 and click **High CPU** three times.
Nothing is broken — but you repeated yourself, so a **"You seem stuck on this"** card appears
beside your work, listing what actually repeated. Click **Dismiss** to send it away (that's
feedback — see step 4). Switch to another tab for 30+ seconds and come back: a **"Welcome back"**
re-entry summary is waiting.

`High CPU`를 세 번 클릭하세요. 아무것도 깨지지 않았지만 같은 행동이 반복됐으므로 **"여기서 막힌 것
같아요"** 카드가 작업 옆에 나타납니다(실제로 반복한 것을 표로 보여줌). 30초 이상 다른 탭에 다녀오면
**복귀 요약**이 기다리고 있습니다. 우측 상단 🌐로 전체 UI를 한국어로 바꿀 수 있습니다.

## 2 — Traffic shape, never content · 통신은 '형태'만 (30s)

Click **API 503**: a dependency started failing. The runtime read only the *shape* of traffic
(host · status · latency) and opened a **Connection trouble** view. Click **API recovered** —
it closes itself. Click **HTTP 500** then **Service recovered** to see the classic incident
case: it is just *one case* of the same loop.

`API 503` → 통신의 형태만으로 **연결 문제** 화면이 열립니다. `API recovered` → 스스로 닫힙니다.

## 3 — The whole browser and the desktop · 브라우저 전체와 데스크톱 (2m)

```bash
pnpm --filter @particle/extension build
```

`chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/dist`.
Click the toolbar icon: the body opens in a **side panel**, already connected. Browse normally —
sites you alternate between read as *switching* and get pinned. What is being sensed is always
shown (and controlled) honestly: right-click the icon → **Options** (Korean UI on Korean browsers).

```bash
DM_WATCH_PATHS=. pnpm agent      # file saves + git branch switches (names only)
pnpm test 2>&1 | pnpm agent      # test/build pass↔fail transitions
```

Open http://localhost:3000/?connect=1&session=desktop — save the same file three times, or pipe a
failing test run, and watch the body react to your *desktop*.

확장을 로드하면 사이드 패널에 바디가 뜨고, 평소처럼 브라우징만 해도 오가는 사이트가 고정 카드로
나타납니다. 에이전트를 켜면 파일 저장·브랜치 전환·테스트 결과 전이가 감각이 됩니다.

## 4 — It learns from you · 되돌리기가 곧 학습 (1m)

Trigger the stuck card (3× High CPU) and **Dismiss** it. Trigger it again, dismiss again.
The third time, the card is **withheld** and a "Learned from you" banner explains why.
Reload the page — the lesson survives. Changed your mind? **Redo morph** re-applies what you
undid and hands the lesson back. **Reset session** forgets everything.

같은 카드를 두 번 닫으면 세 번째부터는 자동으로 띄우지 않고, 이유를 배너로 설명합니다.
새로고침해도 학습은 유지됩니다. 마음이 바뀌면 **변형 다시 실행(Redo)** — 되돌린 변형이 재적용되고 학습도 반환됩니다.

## 5 — Look inside · 안을 들여다보기 (1m)

Toggle **Developer mode**: every event, the world state, each decision's reason, what the AI
remembers, and a **Replay & verify** button that reconstructs the whole session from the event log
and proves it lands on the identical UI — the runtime is deterministic and auditable.

**Developer mode**를 켜면 모든 이벤트·월드 상태·결정 이유·기억, 그리고 이벤트 로그만으로 세션을
재구성해 완전히 같은 UI가 나오는지 증명하는 **Replay & verify**가 있습니다.

---

No API key needed for any of the above (deterministic mock brain). Providers, persistence, tokens:
see [README](README.md) · 위 전부 API 키 없이 동작합니다. 상세 설정은 [README.ko](README.ko.md).
