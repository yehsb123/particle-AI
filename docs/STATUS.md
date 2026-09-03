# Status

Updated at the end of each phase.

## Concept v2 — behavior layer (2026-08-31 ~) — see `CONCEPT_V2.md`

**Where it stands (end of the 2026-08-31 overnight run):** the thesis is implemented end to end.
Behavior (clicks, dwell, idle, returns, repeats, alternation) and traffic *shape* (host · status ·
latency, opt-in) flow from three sensors — the page, an MV3 browser extension, an opt-in desktop
agent (file saves, git branch via `.git/HEAD`, piped test/build transitions) — into one runtime
that keeps a continuous intent, prepares the screen before and without anything breaking, learns
from dismissals (persisted across reloads/restarts), reports honestly what it senses, reconciles
the body when a timing hold would leave it out of step, and answers only to its own origins/token.
Everything is event-sourced and replays deterministically. Verified by 191 unit/integration tests,
15 Playwright E2E tests across 14 specs (incl. a real extension in Chromium against the live runtime, dark-mode axe),
and two adversarial review passes (25 findings fixed). Remaining ideas live in the loop prompt.
- **P1 done**: the body reshapes from **behavior alone**. `BehaviorState` + `@particle/intent-engine`
  (continuous intent: exploring/focused/stuck/switching/idle/returning/debugging), behavior
  significance, intent-driven `augment` morphs (returning → live re-entry summary; stuck →
  related context), web sensors (tab visibility, idle, clicks-as-actions), intent visible in
  the rail/presence. Proven with zero errors in unit + browser E2E (`behavior.spec.ts`).
- **Next**: P2 browser extension (MV3: tabs/visibility/navigation + network *shape* + DOM
  interaction → local runtime; side-panel body), then P3 opt-in desktop agent.
- HTTP 500 / build / test / security incidents remain as **one case** (intent `debugging`
  with error signals), not the product story.

- **P2 in progress** (2026-08-31): `BehaviorState.network` + `network.request` shape reducer
  (`network_failure` problem opens on 5xx/error, clears on success); `apps/extension` MV3
  (background: focus/navigation/webRequest shape with per-layer consent; content: interaction
  counts/idle/visibility; options; side panel iframing the body with `?connect=1&session=ext`).
  Web reads `session`/`connect` URL params and auto-connects. 4 extension unit tests; full
  suite + 9 E2E green. Build note: `fs.cpSync` recursive segfaults on Node 22.17/Windows →
  file-by-file copy.
- **P2 `network_failure` layout** (2026-08-31): traffic *shape* is a first-class problem kind.
  `network.request` 5xx/error on a new host → significance `network_shape` → brain plans
  read-only `network.inspect_shape` + `workspace.get_state` → "Connection trouble" panel
  (failing-host table bound to the capability, honest assessment text, timeline, undo only —
  nothing to remediate on the user's side). Repeated failures to the same host do NOT
  re-deliberate; recovery of the last failing host closes the problem and restores the body.
  Sim palette (web + runtime) gained `API 503` / `API recovered`; E2E `network.spec.ts`
  (10/10 specs green).
- **P3 desktop agent (opt-in)** (2026-08-31): `apps/agent` — file saves under `DM_WATCH_PATHS`
  → `user.opened_file { path }` (relative only); piped tool output → test/build pass↔fail
  **transitions** (`OutputTracker`, summary lines only, output passed through). Repeated saves
  of one file now count as the "stuck" signal (significance + runtime-core test). Live-verified
  against the real runtime: piped `Tests 2 failed` opened the Test failure layout, a green run
  closed it. Fixed an extension bug: navigation sent `user.action` AND `user.opened_file`,
  alternating the repeat key so "stuck" could never trigger — one event now.
- **P4 learning from dismissals** (2026-08-31): undo is feedback. `RuntimeCore.undo` records
  `dismissed:<intent>:<variant>` in preference memory; after `DISMISS_THRESHOLD` (2) undos of the
  same augmentation variant the runtime withholds it for the session (`morph_suppressed` audit,
  `learned_preference` guard code, `IngestResult.learned`). Incidents are never suppressed —
  a real problem always surfaces. runtime-core: 20 tests.
- **Honest sensing indicator** (2026-08-31): `WorldState.sensing` (sensor → layers) fed by
  `sensor.layers_changed`, which the extension announces from its consent state (on start and on
  every change) and the agent announces from what it was asked to do (files / output). The body's
  presence popover renders "currently sensing — this page: …  · browser extension: …  · desktop
  agent: …" from that state, so the indicator can only say what the sensors actually reported
  (Concept v2 privacy rule #3). world-model 8 tests, extension 9.
- **"switching" intent** (2026-08-31): `BehaviorState.recentKeys` (last 8 action/entity keys);
  `isSwitching` = the last 6 keys all change yet span ≤3 contexts (A B A B A B) — juggling, as
  opposed to breadth ("exploring"). Intent transitions seen only *after* the reduce now trigger
  deliberation (`intent_transition` reason code) — deterministic, replay-safe. Brain augments with
  the "Juggling several things" card whose text is bound to `workspace.get_state:juggling` (the
  actual places being alternated). Agent senses git branch switches (`user.action branch:<name>`,
  name only) and announces the `git` layer. intent-engine 9, world-model 9, runtime-core 21.
- **Extension E2E** (2026-08-31): `apps/web/e2e/extension.spec.ts` loads the built MV3 extension
  into a Chromium persistent context against the live runtime: navigating to a (locally fulfilled)
  site becomes `site:<host>` + the announced layers; the event log provably contains no path/query
  and no `network.request` (opt-in off); the side panel page embeds the body already connected.
  CI e2e job now builds the extension and starts the runtime, so `connected` and `extension`
  specs run for real instead of skipping. 12 specs.
- **Review fixes** (2026-08-31, from a full read of the Concept v2 code paths):
  - runtime: CORS is an allow-list (`DM_ALLOWED_ORIGINS`, default the body's origins + any
    `chrome-extension://`); writes from other origins get 403; optional shared secret
    `DM_INGEST_TOKEN` (`x-particle-token`, sent by extension options / agent env); sessions are a
    bounded LRU (500); `/api/sessions/:id/approvals` is scoped to the session.
  - extension: consent defaults to OFF until read from storage on every service-worker start
    (previously the defaults were sent before the read); hidden-since survives SW restarts via
    `chrome.storage.session`; webRequest listeners exist only while network consent is on;
    dropped unused `tabs`/`alarms` permissions; options form writes atomically.
  - determinism: `replay()` uses an event-sourced clock by default (each event's timestamp is
    "now"), and the web restore path does the same — replaying morphs minutes apart no longer
    collapses into cooldown rejections; the history strip is rebuilt from the replayed steps.
  - undo attribution: Dismiss/undo buttons carry `payload.targetId`; `undo(session, { componentId,
    learn })` counts a dismissal only when the top morph introduced that component; multi-step
    "go back" never learns; apply-before-pop so a failing inverse loses nothing; `hydrate` resets
    the undo stack; `morphMeta` bounded with the history.
  - agent: watcher errors no longer crash the daemon; token header. web: `dm_events` bounded (500).
  - runtime-core 25 tests, runtime 13; 12/12 E2E.
  - honesty: the web page now announces its own layers (`sensor.layers_changed` web: interactions /
    idle / visibility) and batches interaction COUNTS every 10 s; the indicator is derived only from
    what sensors reported (no hard-coded line). The "stuck" card lost its fixture diff — it shows a
    table of the real facts (`workspace.get_state:stuckRows`: repeated key ×N, open problems,
    recent places). Korean coverage: augment card strings, autonomy level labels, runtime
    server/local, typing, fallback.
- **P4 persistence** (2026-08-31): learned preferences outlive the session. `RuntimeCore.exportMemory /
  importMemory` (preferences only — never events or content; `PreferenceMemory.load` takes the max,
  ignores garbage). Web: `dm_prefs` saved on every undo and imported BEFORE the event log is
  replayed, so the restored session is judged the way the person taught it; Reset clears it.
  Server: a `memory` snapshot is saved with every morph snapshot and on undo; `resume` imports it.
  E2E `learn.spec` now reloads and proves the card stays withheld with zero new dismissals.
  runtime-core 26, runtime 13, memory 6.
- **Agent git sensing without polling** (2026-08-31): `.git/HEAD` is watched (worktree `gitdir:`
  pointers followed); `branchFromHead` parses the ref (detached → `detached@<sha7>`), no `git`
  process is spawned. Linux inotify limits documented. agent 10 tests.
- **Localized generated sentences** (2026-08-31): capabilities emit a template id + identifier-only
  params (`summaryTpl`, `jugglingTpl`) next to the English text; blueprints bind `tpl` as well as
  `text`; the renderer fills `t(tpl.id)` in the viewer's language (`fillTemplate`, unknown slots
  stay visible). No generated sentence is ever translated as a string. web 5 tests.
- **Dark-mode accessibility audit** (2026-08-31): `a11y.spec` now audits dark mode too (initial,
  behavior context card, incident, developer mode). It found three real AA contrast failures that
  the light audit could not see: the code editor textarea inherited the UA default (black on the
  dark panel), the `ok` badge (#81C784 on #1B5E20 ≈ 3.9:1 → #A5D6A7, 5.0:1), and the reason tags
  (primary-700 on accent-low, 1.4:1 → primary-200, also under `prefers-color-scheme: dark`). 13 specs.
- **Second review, batch A** (2026-08-31): runtime reads are protected too — a non-allow-listed
  browser Origin is refused for every method (WebSocket upgrades are not covered by CORS and the
  world state lists every host you visited); when `DM_INGEST_TOKEN` is set it guards reads and
  writes (`?token=` accepted for WS), `/health` excepted; the server binds loopback by default
  (`DM_HOST`); GET/WS reads use non-creating `peekWorld/peekBlueprint`, so junk ids cannot evict
  real sessions. Undo attribution travels over REST (`{componentId, learn}`) and a dismissal of a
  card that is not the newest morph removes just that card (an undoable step, counted against the
  morph that introduced it) instead of reverting something else; server undo also snapshots the UI
  so resume cannot resurrect a dismissed card. Extension webRequest listeners are registered
  synchronously (MV3 wake-ups) with consent checked inside, and `ready` always resolves.
  `environment.files` bounded (50). Agent: first readable HEAD is a baseline, not a switch.
  runtime 16 tests, runtime-core 26.
- **Second review, batch B** (2026-08-31, web): live events wait on a restore gate until the saved
  log is replayed and in state (no event is stamped with a replayed timestamp, nothing overwrites
  the log mid-restore); storage is per session (`dm_events:<id>`, `dm_prefs:<id>`) and another
  session's events are never replayed; the embedded/connected body skips local restore; StrictMode's
  double-mounted effect replays once; connected-mode undo carries `{componentId}` to the server;
  `replay(events, clock?, { memory })` seeds the preferences that were in force at restore so
  Replay & verify cannot report a false "differs"; `.app[data-restored]` marks restore completion.
  E2E: no Reset-click/reload races (fresh context per test), learn.spec waits for `data-restored`,
  extension.spec judges only this run's events. 13/13.
- **Extension options/side panel** (2026-08-31): options page localized (Korean when the browser is
  Korean, via `data-i18n` + a static dictionary — never page content), dark-mode tokens for options
  and the side panel shell (no flash before the body paints), focus ring on inputs.
- **Reconcile after a timing hold** (2026-08-31): found live via the agent pipe — a build that fails
  again 1 s after recovering is held by the 5 s cooldown, and with no further output the body stayed
  out of step with the world forever. Now a hold on timing alone (cooldown / dwell) reports
  `IngestResult.retryAfterMs`; the server (per-session timer) and the local web body ingest one
  `runtime.reconcile` event at that time; significance deliberates on it only while a problem is
  open, so the brain re-surfaces the incident and the guard now allows it. It is an ordinary event,
  so the log and replay see exactly what happened. Verified live: "Build failure" absent right after
  the third transition, present ~6 s later. WS now also carries `learned` (connected-mode banner).
  Agent pipe verified: 13 repeated tsc-style lines → 3 transition events. runtime-core 27.
- **Third review (10 findings, all addressed)** (2026-08-31): a pending reconcile now SURVIVES
  unrelated events (cancelled only when the morph applies; the fixed bug had silently returned for
  any session with live sensors); token mode no longer bricks the body — the web client sends
  `x-particle-token` (from `NEXT_PUBLIC_DM_TOKEN` or `?token=`, which the side panel appends from
  extension storage) and the WS URL carries `?token=` (now honoured ONLY on `/ws/`); the restore
  gate opens in `finally` so a stale saved log can never deadlock all ingestion; a stale targeted
  dismiss (card already gone) is a quiet no-op instead of a MorphApplyError → 500; reconcile ticks
  are never recorded as user patterns; the web reconcile timer is cleared on unmount and a real
  remount restores again (WeakSet per core); attention-held morphs get their second chance on focus
  release; sensor send queues have a 5 s timeout and a 500-event cap (drop newest — order beats
  completeness); evicted sessions get no tick; fake-timer server test proves the tick survives
  unrelated events. runtime-core 29, runtime 17.
- **Closing touches** (2026-08-31): `QUICKSTART.md` (bilingual 5-minute walkthrough) linked from
  both READMEs; CI fix — the fake-timer reconcile test now runs on an isolated in-memory
  SessionRuntime (faking timers hung the Postgres driver's awaits on the CI runner); a restored
  log that ENDS on a timing hold arms one reconcile tick (the body catches up without a live
  event); Playwright workers serialized — options.spec and extension.spec share the live
  runtime's `ext` session, and parallel workers raced each other's consent toggles (the
  intermittent extension failure). 14 specs green, serial.
- **Pattern memory persists** (2026-08-31): `exportMemory/importMemory` now carry the pattern
  table (counts + the `suggested` flag), and the server's `memory` snapshots/resume restore it —
  a restart never re-offers a template suggestion the person already saw, and counting continues
  where it left off. The web restore imports preferences only (its event-log replay re-observes
  patterns; importing both would double-count). memory 7, runtime-core 30 tests.
- **Usability bug found by the audit: `pnpm dev` dropped every env var** (2026-08-31). Turbo 2's
  strict env mode strips undeclared variables, so `DM_PORT`, `DATABASE_URL`, `ANTHROPIC_API_KEY`,
  the ingest token and `NEXT_PUBLIC_*` never reached the apps when started through the root
  `pnpm dev`/`pnpm test`/`pnpm build` (the direct `pnpm web`/`pnpm runtime` paths bypass turbo,
  which is why nothing showed earlier). Fixed with `globalPassThroughEnv` (`DM_*`, `DATABASE_URL`,
  provider keys, `NEXT_PUBLIC_*`, `PORT`, `SHOTS`, `CI`) + `NEXT_PUBLIC_*` as build `env`; the web
  scripts no longer hard-code `-p 3000` so `PORT` works. Verified live: `DM_PORT=8790 PORT=3010
  pnpm dev` answers on both ports in 4 s. CI was never affected (it runs `pnpm -r`, not turbo).
- **Real-provider path, end to end, without keys** (2026-08-31): `decision-engine` now routes to
  the actual `AnthropicProvider` against a fake Messages API: a schema-valid model decision is used
  as-is; a schema-INVALID one (bad intent / autonomy), an HTTP 503, and a prose answer with no JSON
  all fall back to the deterministic decision with a reason code — the "invalid model output can
  never corrupt the runtime" guarantee proven on the real adapter, not a stub. Usability audit
  facts: all 15 documented env vars are read by code (no dead variables); root scripts
  (`pnpm web/runtime/agent/test:e2e`) resolve; `pnpm agent` runs from the repo root.
- **Provider HTTP contracts proven without keys** (2026-08-31): a fake Messages / chat-completions
  server records what the Anthropic and OpenAI-compatible adapters send and answers like the
  real services. Verified on every push: wire shape, `x-api-key`/`anthropic-version` and Bearer
  headers, `json_object` mode, fenced-JSON extraction with prose ignored, usage mapping, and the
  failure paths that feed the deterministic fallback — HTTP 500, no JSON in a structured answer,
  latency-target timeout — plus the local-model path (no key, no Authorization, still healthy).
  The live Anthropic test still runs when a key is present. FACT CHECK: the Postgres persistence
  path is exercised by CI on every push (Postgres service + `DATABASE_URL`), not "pending".
  intelligence 23 tests.
- **Multi-session view v1** (2026-08-31): the connected body lists what THIS computer senses —
  every session on the runtime (web / side panel / desktop) with its intent, open problems and
  reported layers ("Sensed on this computer", en/ko, 8 s poll). `listSessions` is peek-based
  (never creates sessions — tested); other sessions link to their own body (`?session=`).
  The GitHub repo description is now Korean-first bilingual. runtime-core 34, runtime 21.
- **Fifth review (core sound; 8 edge fixes)** (2026-08-31): the review traced the undo/redo
  learning ledger and stack pairing as CORRECT, and found the edges: dismissals are now
  refundable (undoing a dismissal hands the lesson back, redoing re-teaches — mind-changing
  loops never accumulate toward suppression); undo/redo/canRedo never create sessions (the new
  endpoint inherited the eviction hole); redo drains stale entries in one truthful call; the
  junk-key meta fallback is gone; connected emitSim tolerates a behavior-key blip without
  dropping the sim and its final catch tells the truth; connected redo reports
  redone/no-op/unreachable; the history strip pairs with the real stack (a targeted dismissal
  GROWS it) and redo chips keep their real intent; web restore imports `dismissed:*` preferences
  only (morph:* counters would compound each reload); reversals leave `morph_undone`/`morph_redone`
  audit records and persist memory before UI; `pattern_suggestions` now travel over WS so a
  headless emitter's threshold crossing is seen before being marked suggested. Store blockers:
  runtime URL configurable (options), `docs/PRIVACY.md`, host-permission decision documented.
  runtime-core 33, runtime 20; 15 E2E green.
- **Redo** (2026-08-31): reversibility goes both ways. `RuntimeCore.redo` re-applies the most
  recently undone morph (stale entries dropped quietly); any NEW morph or dismissal invalidates
  the redo stack; a dismissal the undo taught is handed back on redo (weights clamp at zero).
  Wired over REST (`/api/morph/:id/redo`) with UI/memory snapshots, a Redo button (en/ko), and
  `incident.spec` round-trips undo→redo→undo in the browser. runtime-core 31, runtime 19.
- **Suggestions offered once, ever — web too** (2026-08-31): the web persists memory whenever a
  suggestion surfaces, and its restore imports the patterns as suggested MARKS only (count 1 —
  the log replay re-observes the real counts, the sticky flag prevents any re-offer).
  `pattern.spec` reloads and repeats the flow: the banner stays gone. Server restarts were already
  covered (runtime 18). runtime-core 30, memory 7.
- **Connected behavioral parity** (2026-08-31): sim clicks now carry their behavior key to the
  SERVER too (`RuntimeClient.emit`), so a server session reads repeats as "stuck", learns from
  dismissals (undo attribution over REST) and notifies the withheld morph — `connected-learn.spec`
  proves the full loop against a fresh server session per run. The presence popover lesson is
  E2E-verified as well (learn.spec).
- **Reconcile ticks out of the novelty window** (2026-08-31): `runtime.reconcile` no longer enters
  `recentEvents`, so repeated REAL events keep their anti-thrash repetitive-event decay; reduce is
  pure either way (replay determinism proven by the existing suite). world-model 10 tests.
- **Held banner countdown + browser proof** (2026-08-31): the "morph held" banner now says when
  the body will catch up (`retryAfterMs` exposed on REST responses, en/ko), and `held.spec`
  asserts the whole story in a real browser: hold explained → countdown shown → the reconcile
  tick re-surfaces the still-open Build failure on its own. Extension store icons generated
  (manifest `icons` + `action.default_icon`, dist-validated); Playwright `retries: 1` absorbs
  live-extension environment flakes (isolated failures always pass); agent warns once at startup
  when the runtime is unreachable. Fourth review (docs vs implementation): all claims verified,
  spec-count wording unified (14 tests / 13 specs).
- **Ordered sends** (2026-08-31): the same smoke exposed that agent/extension sends were parallel
  fetches — a recovery could overtake the failure it recovered from (observed: failed, failed,
  succeeded). Both sensors now serialize sends (one in-flight request); verified 3/3 back-to-back
  runs arrive in observed order.

## Autonomous-loop additions (2026-08-29 ~)
- **AI presence inspector (spec §23)**: clicking the presence chip opens a popover — current
  state, what it observes, autonomy level, why the UI last changed, capabilities awaiting
  approval. E2E-covered.
- **Pattern suggestion banner (spec §20)**: when a flow repeats to the threshold, a
  dismissible banner suggests a reusable workspace template (suggest-only).
- **Recurring incidents**: per-session episodic memory marks a repeated incident with a
  `recurring ×N` badge — experience visibly shapes the morph.
- **Security scenario (4th incident kind)**: `security.vulnerability_detected/patched`
  full-stack — CVE table layout, `security.scan_dependencies` (read, auto) +
  `security.update_dependency` (external effect, approval-gated).
- **i18n**: EN/KO toggle in the header; chrome + blueprint content translated; audit test
  (`i18n.test.ts`) guards against untranslated strings/raw keys.
- **UX**: first-run coach mark; language/theme persisted (localStorage); morph-in animation
  with staggered cells; Escape closes popover/coach; global focus-visible ring.
- **One-pager**: `/pitch.html` (also published as a Claude artifact) with a self-playing
  before→incident→recover demo and how-to-explain copy.
- **Data bindings (spec §5)**: `resolvePatchBindings` feeds capability outputs into the
  morphed body — incident logs and the CVE table are live, not hardcoded.
- **Replay & verify (spec §21)**: Developer mode button replays the session's event log
  through a fresh core and reports whether the UI is reproduced exactly.
- **Browser event sourcing**: the event log is persisted (localStorage) and replayed on load,
  so the morphed workspace survives a refresh; `Reset session` clears it.
- **Morph history strip**: every applied morph is a clickable step; clicking undoes back to
  before it (multi-step undo) — reversibility made visible.
- **Held-morph explanations**: when the guard holds a change (cooldown, dwell, focus/unsaved
  protection, low confidence) the body says why in plain language (EN/KO).
- **Accessibility audit (axe-core)**: E2E fails on serious/critical WCAG A/AA violations across
  initial, incident and developer-mode states; fixed accessible names, focusable scroll
  regions, and light-theme contrast (warn/ok badges, primary hover).
- **CI runs the full Playwright suite** (7 specs); connected mode self-skips without a server.
- **Connected-mode parity**: server responses carry patternSuggestions; held reasons and
  pattern banners render in server mode too.

## Completion sprint (all committed)
- **@particle/memory** (§20): working/episodic/preference stores + `PatternDetector` that
  suggests reusable-template candidates (suggest-only). Fed by `RuntimeCore` on each morph;
  `IngestResult.patternSuggestions`.
- **Approval flow end-to-end** (§18, criterion J): `development.revert_diff` (external_effect)
  is planned, gated to `needs_approval` at level 2, surfaced as an `ApprovalRequest`, shown in
  the web "Approval required" UI, and **executed on approve** (`RuntimeCore.approve`, server
  `/api/approvals/:id/approve`). Verified in unit + server + E2E.
- **Snapshot persistence**: world + ui snapshots saved to `SnapshotStore` on morph
  (`/api/sessions/:id/snapshots`); live-verified against Postgres.
- **Material 3 redesign**: purple (#6750A4) token system, light + dark; served on :4000.
- **CI**: GitHub Actions (typecheck + tests w/ Postgres service + web build + Playwright E2E).
  LICENSE (MIT), CONTRIBUTING, README badges + Korean README.

## Post-MVP additions (name: **Particle AI**)
- Rebranded the product to **Particle AI** (repo `particle-AI`); internal namespace stays `@particle/*`.
- **Developer Inspector** (spec §31): toggleable in-UI panel — event trace, world state,
  structured decision, and audit trail.
- **Connected mode**: the web app can drive the runtime **server** over WebSocket
  (`RuntimeClient`), morphing the UI from `ui_patch` frames. Verified end to end in a real
  browser (`e2e/connected.spec.ts`) and via a WS protocol probe. Local (client-loop) mode
  remains the default so the demo is self-contained.

## Phase 0 — Architecture — ✅ in progress → done when skeleton installs
- Implemented: monorepo skeleton, root config (pnpm/turbo/tsconfig), CLAUDE.md, README,
  core docs (VISION, ARCHITECTURE, RUNTIME_LOOP, UI_PROTOCOL, MORPH_ENGINE), ADRs 0001–0003,
  `.env.example`, docker-compose.
- Remaining: fill remaining docs as their phases land.
- Known limitations: docs describe the target; later phases implement them.
- Next: Phase 1 — UI Matter.

## Phase 1 — UI Matter — ✅ done
- Implemented:
  - `@particle/ui-protocol`: blueprint/patch validation + tree helpers (find, collect, unique-ids).
  - `@particle/morph-engine`: pure `applyPatch` with inverse generation, `MorphGuard`
    (confidence gates, cooldown, major-dwell, focus protection, unsaved-state protection,
    critical bypass), `computeDiff`, and `MorphHistory` (undo).
  - `apps/web` (Next.js 15 / React 19): schema-driven `Render`er over the approved registry,
    a Simulation Lab, AI presence indicator, Inspector ("why did the UI change?"), Undo,
    and dark/light theming.
  - Phase-1 deterministic `decide()` (no LLM) wiring event → decision → guard → morph.
- Tested: 27 unit + integration tests pass; web builds and prerenders; headless loop test
  proves incident→recover→undo with the editor never destroyed.
- Known limitations: `decide()` is a stand-in for the Phase 3/4 significance + decision
  engines; events are UI-simulated (no event store / WebSocket yet); morph timing uses the
  wall clock in the app shell (pure engine stays clock-free).
- Next: Phase 2 — Perception (event contract already in `contracts`; add event store,
  world model, simulator source, WebSocket in `apps/runtime`).

## Phase 2 — Perception — ✅ done
- Implemented:
  - `@particle/contracts`: `WorldState`, `Problem`, `Goal`, `ProcessState`, `IntentHypothesis`,
    `AutonomyState` + `emptyWorldState`.
  - `@particle/event-core`: append-only `EventStore` (validates, session-indexed, subscribable).
  - `@particle/world-model`: pure `reduce(prev, event)` — opens/closes problems, tracks process
    health, files, goal, and attention.
  - `apps/runtime` (Fastify 5 + `@fastify/websocket`): `SessionRuntime`, REST
    (`/api/events`, `/api/sessions/:id/{state,events,ui}`, `/api/sim/:id/:key`), and
    `/ws/sessions/:id` broadcasting `world_state_changed` / `ui_patch`.
- Tested: event-core (2), world-model (5), runtime REST/sim (6). Live smoke: HTTP 500 →
  runtime_error problem + API failed; recovery clears it. Typecheck clean across 8 projects.
- Known limitations: store is in-memory (Postgres in Phase 8); runtime does not yet run the
  significance/decision/morph loop (Phases 3–4, 7); WS verified via unit + design, not E2E.
- Next: Phase 3 — Reflex (significance engine + transitions + guard already in morph-engine).

## Phase 3 — Reflex — ✅ done
- Implemented: `@particle/significance-engine` — pure `evaluateSignificance(event, world, config)`
  (severity + relevance + novelty + problem-transition under configurable weights, anti-thrash
  novelty decay), `suggestMode`, `nextPresence`. `SignificanceResult` added to contracts.
  MorphGuard + focus/unsaved protection already shipped in `@particle/morph-engine` (Phase 1).
- Tested: 5 tests (critical deliberation, reflex-only repetition, recovery-only-when-open,
  configurable threshold, mode switch). Typecheck clean.
- Next: Phase 4 — Deep Brain (provider abstraction, mock+real adapters, decision engine, router).

## Phase 4 — Deep Brain — ✅ done
- Implemented:
  - Contracts: `RuntimeDecision` (structured, never prose), `UIMorphPlan` (intent, not a
    patch — keeps intelligence UI-free), `CapabilityPlan`, `AutonomyRequirement`, and the
    `Intelligence*` types (`IntelligenceProvider` request/result, `ModelRouteDecision`).
  - `@particle/intelligence`: `IntelligenceProvider` interface; `MockProvider` (deterministic
    brain, no key needed); real fetch adapters `AnthropicProvider`, `OpenAIProvider`,
    `LocalModelProvider` (OpenAI-compatible); `IntelligenceRouter` (cheap→reflex,
    capable→deliberation, local→privacy, always-mock fallback); `buildDefaultProviders`.
  - `@particle/decision-engine`: routes → provider.evaluate → **validates** output; any invalid
    model output is discarded for the deterministic decision (a bad model can't corrupt state).
- Tested: 11 tests (deterministic decision, mock structured output, router selection across
  tiers/privacy/health, fallback-to-deterministic on junk output). Typecheck clean.
- Known limitations: real providers are exercised against a fake API server on every push (adapters.contract.test.ts); the live Anthropic test additionally runs when a key is present; prompts are minimal.
- Next: Phase 5 — Capability Matter (registry, execution, permissions, audit).

## Phase 5 — Capability Matter — ✅ done
- Implemented:
  - Contracts: `CapabilityManifest`, `CapabilityResult`, `CapabilityRun`, `ApprovalRequest`,
    `AuditRecord`.
  - `@particle/permission-engine`: autonomy rules (`canAutoRun`/`classify`), pure `evaluatePlan`
    (authorized / needs-approval / denied), `ApprovalStore`, `AuditLog`.
  - `@particle/capability-core`: `Capability` interface, `CapabilityRegistry`, `CapabilityExecutor`
    (auditable runs), and 9 built-in capabilities (read-only + `memory.store` safe_write to
    exercise gating). External-effect/destructive deliberately omitted until the flow is wired.
- Tested: 10 tests (autonomy gating by risk×level, plan split, approvals, audit, execution,
  memory store/search, multi-capability plan). Typecheck clean.
- Next: Phase 6 — MCP adapter (normalise MCP tools into capabilities).

## Phase 6 — MCP — ✅ done
- Implemented: `@particle/mcp-adapter` — `McpClient` interface (transport-agnostic),
  `inferRisk` (annotations → override → name heuristic → external default),
  `mcpToolToCapability` (namespaced `mcp.<server>.<tool>`), `discoverMcpCapabilities`.
  MCP tools become ordinary capabilities; MCP specifics stay out of the core.
- Tested: 4 tests (risk inference, tool→capability call, registry+executor integration).
- Next: Phase 7 — wire the full loop end to end.

## Phase 7 — Integrated demo — ✅ done
- Implemented: `@particle/ui-registry.planMorph` (intent→patch, idempotent); `@particle/runtime-core`
  `RuntimeCore` — the canonical loop (perception→significance→decision→permission→capability
  →morphology→guard→apply→audit) + `createRuntimeCore` factory. The web app now drives the
  real loop; the runtime server composes the same core over REST/WebSocket
  (`ui_patch`/`world_state_changed`/`decision_created`), with `/api/morph/:id/undo` and
  `/api/approvals/*`.
- Fix: significance is judged against the pre-reduce world; de-escalations bypass cooldown+dwell.
- Tested: runtime-core loop, web integration, and the runtime server all exercise
  incident→capabilities→morph→recovery→undo.
- Next: Phase 8 hardening.

## Phase 8 — Reliability — ✅ done
- Implemented:
  - `@particle/runtime-core.replay` — deterministic event-sourced replay (reconstructs identical
    UI/world from the log).
  - `@particle/observability` — structured logger + `TraceStore` (developer inspector rows).
  - `@particle/persistence` — `EventLogStore`/`SnapshotStore` seams + in-memory impls (Postgres/
    Drizzle deferred behind the same interfaces).
  - Playwright E2E (`apps/web/e2e`) — incident→morph→recover→undo + no-morph on unrelated event.
  - Remaining docs: PRODUCT_SPEC, MVP (acceptance table A–O), CAPABILITY_PROTOCOL,
    AUTONOMY_AND_SECURITY, DATA_MODEL, TEST_STRATEGY, INTELLIGENCE_ROUTER.
  - Project subagents in `.claude/agents` (architecture/security/test/ui-morphology/runtime).
- Tested: 77 unit/integration tests + Playwright E2E, all green. Typecheck clean.
- Known limitations: durable Postgres backing is deferred (in-memory + deterministic replay
  satisfy the "persisted & replayable" bar); real LLM providers' HTTP contracts are
  tested against a fake server on every push (live test additionally when a key is present); the web app runs the loop client-side (the server offers the same loop too).
