# Status

Updated at the end of each phase.

## Phase 0 — Architecture — ✅ in progress → done when skeleton installs
- Implemented: monorepo skeleton, root config (pnpm/turbo/tsconfig), CLAUDE.md, README,
  core docs (VISION, ARCHITECTURE, RUNTIME_LOOP, UI_PROTOCOL, MORPH_ENGINE), ADRs 0001–0003,
  `.env.example`, docker-compose.
- Remaining: fill remaining docs as their phases land.
- Known limitations: docs describe the target; later phases implement them.
- Next: Phase 1 — UI Matter.

## Phase 1 — UI Matter — ✅ done
- Implemented:
  - `@dm/ui-protocol`: blueprint/patch validation + tree helpers (find, collect, unique-ids).
  - `@dm/morph-engine`: pure `applyPatch` with inverse generation, `MorphGuard`
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
  - `@dm/contracts`: `WorldState`, `Problem`, `Goal`, `ProcessState`, `IntentHypothesis`,
    `AutonomyState` + `emptyWorldState`.
  - `@dm/event-core`: append-only `EventStore` (validates, session-indexed, subscribable).
  - `@dm/world-model`: pure `reduce(prev, event)` — opens/closes problems, tracks process
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
- Implemented: `@dm/significance-engine` — pure `evaluateSignificance(event, world, config)`
  (severity + relevance + novelty + problem-transition under configurable weights, anti-thrash
  novelty decay), `suggestMode`, `nextPresence`. `SignificanceResult` added to contracts.
  MorphGuard + focus/unsaved protection already shipped in `@dm/morph-engine` (Phase 1).
- Tested: 5 tests (critical deliberation, reflex-only repetition, recovery-only-when-open,
  configurable threshold, mode switch). Typecheck clean.
- Next: Phase 4 — Deep Brain (provider abstraction, mock+real adapters, decision engine, router).

## Phase 4 — Deep Brain — ✅ done
- Implemented:
  - Contracts: `RuntimeDecision` (structured, never prose), `UIMorphPlan` (intent, not a
    patch — keeps intelligence UI-free), `CapabilityPlan`, `AutonomyRequirement`, and the
    `Intelligence*` types (`IntelligenceProvider` request/result, `ModelRouteDecision`).
  - `@dm/intelligence`: `IntelligenceProvider` interface; `MockProvider` (deterministic
    brain, no key needed); real fetch adapters `AnthropicProvider`, `OpenAIProvider`,
    `LocalModelProvider` (OpenAI-compatible); `IntelligenceRouter` (cheap→reflex,
    capable→deliberation, local→privacy, always-mock fallback); `buildDefaultProviders`.
  - `@dm/decision-engine`: routes → provider.evaluate → **validates** output; any invalid
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
  - `@dm/permission-engine`: autonomy rules (`canAutoRun`/`classify`), pure `evaluatePlan`
    (authorized / needs-approval / denied), `ApprovalStore`, `AuditLog`.
  - `@dm/capability-core`: `Capability` interface, `CapabilityRegistry`, `CapabilityExecutor`
    (auditable runs), and 9 built-in capabilities (read-only + `memory.store` safe_write to
    exercise gating). External-effect/destructive deliberately omitted until the flow is wired.
- Tested: 10 tests (autonomy gating by risk×level, plan split, approvals, audit, execution,
  memory store/search, multi-capability plan). Typecheck clean.
- Next: Phase 6 — MCP adapter (normalise MCP tools into capabilities).

## Phase 6 — MCP — ⏳ pending
## Phase 7 — Integrated demo — ⏳ pending
## Phase 8 — Reliability — ⏳ pending
