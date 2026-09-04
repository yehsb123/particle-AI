# Overnight run — 2026-08-31 (Concept v2 build-out)

Everything below was built, tested and pushed autonomously overnight and through the day.
Every commit is green (typecheck 0 · 543 unit/integration tests · 15 Playwright E2E tests across 14 specs · CI).

## Commits (oldest first)

- `11da56a` P2 slice: network shape in world model, MV3 extension (sensors/consent/side panel), web session/auto-connect
- `6faa731` docs: browser extension install/consent (README en/ko, extension README), STATUS P2
- `825687a` P2: network_failure incident kind from traffic shape (L2)
- `09dc21e` extension: NetworkShaper — send transitions (fail/recover), slowness and a sparse sample, never every request
- `4df34ce` extension: shaper — recovery counts as the window's sample; only 2xx are sampled (3xx proves recovery, never sampled)
- `492dfa2` P3: desktop agent (opt-in) — file-save shape + test/build transitions → runtime; fix extension repeat-key bug
- `7cb1d58` P4: learn from dismissals — two undos of the same augmentation withhold it for the session
- `176df66` web: 'Learned from you' banner (P4 visible), agent relPath portable (fixes Linux CI), learn E2E
- `b10d23e` Honest sensing indicator: sensors report their layers, the body only shows what was reported
- `85b3fa8` Concept v2: 'switching' intent (juggling a few contexts) + agent git branch sensing; fix: resolution beats augmentation
- `8412aae` E2E: real browser-extension test against the live runtime; CI runs connected + extension specs for real
- `809b0cf` README en/ko: reframe intro to Concept v2 (behavior layer; errors are one case), sensor layer table, current status
- `d6058ed` pitch: reframe copy to Concept v2 (behavior + traffic shape → intent; errors are one case; undo is feedback; shape only)
- `8c4f13e` Review fixes: runtime access control, extension consent-before-send, event-sourced replay clock, undo attribution
- `0056864` Honesty + i18n: web announces its own sensing layers and counts interactions; stuck card shows real facts, not a fixture diff
- `f9f4d8d` P4 persistence: learned preferences outlive the session (web dm_prefs, server memory snapshots + resume)
- `74effe5` agent: watch .git/HEAD instead of polling git (worktree gitdir followed, branch name only); Linux inotify notes
- `7bbf1da` i18n: generated sentences as template id + identifier params (summaryTpl/jugglingTpl), filled in the viewer's language by the renderer
- `3af5f6c` a11y: dark-mode axe audit (initial, context card, incident, dev mode) + 3 real contrast fixes
- `ae828bb` Second review (A): runtime reads protected, loopback bind, non-creating reads, targeted card dismissal, undo attribution over REST, MV3 sync listeners
- `458aaf8` Second review (B, web): restore gate for live events, per-session storage, connected undo attribution, StrictMode-safe restore, replay seeded with prefs; E2E de-flaked
- `f8df43a` extension: Korean options page (browser language, static dictionary), dark-mode tokens for options + side panel shell
- `cb54bb7` Reconcile after timing holds, ordered sensor sends, learned over WS, access-control docs
- `f8e677d` extension: side panel shows a bilingual hint while the body is unreachable (probe + auto-reload); agent README (ordered sends, reconcile); STATUS overnight summary
- `92e7ee4` e2e: 60s budget for the extension spec (boot + live runtime round-trips under load); verified stable 3x
- `522e10f` Third review: pending reconcile survives unrelated events; token mode no longer bricks the body; restore gate cannot deadlock; stale dismiss is a no-op
- `4898e14` fix CI: fake-timer reconcile test runs on an isolated in-memory SessionRuntime (faking timers hung the Postgres driver's awaits on CI); QUICKSTART.md (en/ko, 5-minute walkthrough) linked from both READMEs
- `c2201ca` web: restored log ending on a timing hold arms one reconcile tick; e2e: serial workers
- `1f2154d` docs: STATUS closing touches for the overnight run
- `6145c3b` pitch: two-act demo animation — act 1 shows the thesis (behavior alone → welcome-back card, no error), act 2 keeps the incident as one case of the same loop; 16s cycle, token-based colors for both themes
- `dc7fab5` docs: sensor→runtime→body ASCII diagram in both READMEs; Chrome Web Store release checklist (docs/EXTENSION_RELEASE.md)
- `1b4daa7` extension: icons (particle mark on M3 primary, 16/32/48/128) wired into manifest icons + action.default_icon; dist validation includes them — one store blocker down
- `1eaf308` e2e: retries:1 — live-extension specs occasionally flake under load; investigated failures always pass in isolation, a real regression still fails twice
- `bd5c982` docs: fourth review (docs vs implementation) — everything matched except the spec count; unify to 14 E2E tests / 13 specs, dedup .env.example NEXT_PUBLIC_DM_TOKEN
- `ae1315c` agent: one startup /health probe — a single stderr warning when the runtime is down (sensing stays best-effort); pure helper + tests (11)
- `72dbd19` fix: agent health-probe warning wrote a raw newline inside the string literal (typecheck break in ae1315c); verified live with the runtime down
- `f7a58a3` docs: overnight run report (commit list + summary)
- `0bae900` held banner shows when the body will catch up (~Ns, from retryAfterMs) — and held.spec now proves it DOES, in the browser
- `9dea913` docs: STATUS — held countdown/browser reconcile proof, icons, retries, health probe, fourth review
- `779b8a0` store screenshots (1280x800, options+side panel, light/dark, ko) via SHOTS=1 generator spec; CONCEPT_V2 P3 mentions git-branch sensing; agent README health probe
- `74e9ca1` extension: only http/https navigations are sensable — never its own chrome-extension pages or browser internals (found via a store screenshot showing site:<extension-id> as an entity); isSensableUrl + tests (10)
- `a38a85d` presence popover shows what the AI learned from you (dismissed:* preferences, top 3) outside developer mode; en/ko
- `b683755` e2e: test.step instrumentation in extension.spec — the next cumulative-slowness timeout will name the slow phase
- `e6a5028` docs: embed the dark side-panel screenshot in both READMEs; pitch footer links (GitHub / QUICKSTART / live demo)
- `0d6dae3` world-model: reconcile ticks stay out of the novelty window (recentEvents) — system bookkeeping must not dilute repetitive-event decay; pure reduce, replay determinism unchanged (world-model 10, runtime-core 29, runtime 17 green)
- `3c621d5` e2e: learn.spec proves the lesson is inspectable without developer mode — presence popover names the withheld kind (won't auto-offer: augment:stuck ×2)
- `2e15dae` docs: refresh the overnight report with the morning maintenance commits
- `5b763f3` connected mode is behaviorally equivalent: sim clicks carry their behavior key to the server (RuntimeClient.emit), so server sessions read repeats as stuck, learn from dismissals and notify the withheld morph — proven by connected-learn.spec (fresh server session per run)
- `5bb9861` docs: connected behavioral parity entry; spec counts 15 tests / 14 specs (full regression green)
- `28be3d4` P4: pattern->template memory persists across restarts — suggestions are offered once, ever
- `f739d2b` runtime test: a restarted server (fresh SessionRuntime over the shared snapshot store, resumed) never re-offers an already-seen template suggestion (18 tests)
- `30cd2ba` web: pattern suggestions are offered once, EVER — the suggested marks survive reloads
- `d582a98` docs: STATUS — suggestions offered once ever (web reload + server restart)
- `305cc92` docs: overnight report refreshed through the morning commits (P4 fully closed)
- `a2f4dc9` Redo: reversibility goes both ways — the undone morph can be re-applied, and a learned dismissal is handed back
- `83c32b6` docs: STATUS — redo entry
- `b11df20` docs: QUICKSTART mentions Redo (en/ko) — reversibility both ways in the walkthrough
- `368f222` store blockers: configurable runtime URL (options -> storage.sync -> background; never observes the runtime host, custom or not); PRIVACY.md; host_permissions decision documented
- `c4fef60` Fifth review fixes: refundable dismissals, no session creation via undo/redo, honest connected chains, replay-safe preference import
- `495f2c1` docs: STATUS — fifth review fixes + store blockers
- `7d50f98` docs: overnight report refreshed through the fifth-review fixes
- `04ffca4` Multi-session view v1: the connected body lists what this computer senses
- `88903ba` sessions view: other sessions link to their own body (?session=); STATUS documents the multi-session view + Korean-first repo description
- `e77e81e` docs: overnight report refreshed (multi-session view, session links, Korean description)
- `c3702ee` intelligence: provider HTTP contract tests without real keys (fake Messages / chat-completions server)
- `5cc7523` docs: STATUS — remove the last stale 'providers unexercised without keys' claim (contract tests run on every push)
- `48350e1` decision-engine: integration test over the REAL Anthropic adapter against a fake API — valid model decision used as-is; schema-invalid, HTTP failure and prose answers all fall back deterministically with reason codes
- `b1c45fd` docs: STATUS — real-provider end-to-end fallback proof + usability audit facts (env vars, scripts)
- `3cc7f64` fix: root pnpm dev/test/build dropped every env var (turbo strict env) — globalPassThroughEnv for DM_*/DATABASE_URL/provider keys/NEXT_PUBLIC_*/PORT; web scripts take PORT from env

## The short version

- **P2** browser extension (MV3): consent-gated sensors, traffic-shape incidents, side panel body, store icons/screenshots/privacy policy, configurable runtime URL, real-Chromium E2E
- **P3** desktop agent: file saves, git branch via .git/HEAD, piped test/build transitions, health probe — live-verified
- **P4 complete**: dismissal learning AND pattern→template memory, persisted across reloads/restarts; suggestions offered once ever; dismissals refundable; inspectable in the presence popover
- **Multi-session view**: the connected body lists every session this computer senses, each linking to its own body
- Undo/redo both ways with a correct learning ledger; reconcile ticks with a visible countdown; honest sensing indicator; connected mode behaviorally equivalent; ordered sensor sends
- Access control: origin allow-list, loopback bind, optional token end to end; reads never create sessions
- **Fact-based usability audit**: provider HTTP contracts + real-adapter fallback proven without keys; all env vars verified in use; turbo strict-env bug (root pnpm dev/test/build dropped env) found and fixed; docs corrected to measured facts
- 5 adversarial review passes (43+ defects fixed) + a docs-vs-implementation audit; Korean-first repo description
- QUICKSTART (bilingual), pitch two-act demo, ASCII architecture diagram, store release checklist
