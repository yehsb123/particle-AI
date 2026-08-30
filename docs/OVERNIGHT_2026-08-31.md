# Overnight run — 2026-08-31 (Concept v2 build-out)

Everything below was built, tested and pushed autonomously during the night. Every commit is green
(typecheck 0 · 168 unit/integration tests · 14 Playwright E2E tests across 13 specs · CI).

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

## The short version

- **P2** browser extension (MV3): consent-gated sensors, traffic-shape incidents, side panel body, real-Chromium E2E
- **P3** desktop agent: file saves, git branch via .git/HEAD, piped test/build transitions — live-verified against the runtime
- **P4** learning from dismissals + persistence across reloads/restarts
- Honest sensing indicator (sensors report; the body only shows what was reported)
- switching intent, network_failure layout, reconcile ticks (holds can never strand the body), ordered sensor sends
- Access control: origin allow-list, loopback bind, optional token wired end to end
- 4 adversarial review passes: 35+ defects found and fixed, then a docs-vs-implementation audit (all claims verified)
- QUICKSTART (bilingual), pitch two-act demo, ASCII architecture diagram, extension icons, store checklist
