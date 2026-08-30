# Status

Updated at the end of each phase.

## Concept v2 — behavior layer (2026-08-31 ~) — see `CONCEPT_V2.md`
- **P1 done**: the body reshapes from **behavior alone**. `BehaviorState` + `@particle/intent-engine`
  (continuous intent: exploring/focused/stuck/switching/idle/returning/debugging), behavior
  significance, intent-driven `augment` morphs (returning → live re-entry summary; stuck →
  related context), web sensors (tab visibility, idle, clicks-as-actions), intent visible in
  the rail/presence. Proven with zero errors in unit + browser E2E (`behavior.spec.ts`).
- **Next**: P2 browser extension (MV3: tabs/visibility/navigation + network *shape* + DOM
  interaction → local runtime; side-panel body), then P3 opt-in desktop agent.
- HTTP 500 / build / test / security incidents remain as **one case** (intent `debugging`
  with error signals), not the product story.

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
- Known limitations: real providers are implemented but unexercised without keys (mock path
  is the tested one); prompts are minimal.
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
  satisfy the "persisted & replayable" bar); real LLM providers are implemented but untested
  without keys; the web app runs the loop client-side (the server offers the same loop too).
