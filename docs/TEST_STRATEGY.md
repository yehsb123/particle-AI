# Test Strategy

The runtime is designed so its most important logic is **pure and deterministic**, which
makes it cheap to test exhaustively without an LLM.

## Layers

- **Unit (pure functions)** — the heart of the coverage:
  - `world-model.reduce`, `significance-engine`, `morph-engine` (apply/inverse round-trips,
    `MorphGuard` rules), `permission-engine` (autonomy × risk), `deterministicDecision`,
    `IntelligenceRouter` selection, `planMorph`, MCP risk inference.
- **Integration** — modules composed:
  - `decision-engine` (route → validate → fallback), `capability-core` executor,
    `runtime-core` full loop (incident → capabilities → morph → recovery → undo), and
    `replay` determinism (replaying the log reproduces the exact UI/world).
- **Service** — `apps/runtime` via `fastify.inject` (REST + sim + decisions + undo).
- **E2E** — Playwright drives the real browser: emit HTTP 500 → incident appears (editor
  preserved) → recover → undo → an unrelated event does not morph.

## Determinism

Pure code reads no clock (`Date.now`/`Math.random` are avoided in reducers/guards; time is
injected). Given a fixed clock and the mock brain, the whole loop is deterministic — the
property the `replay` test asserts.

## Commands

```bash
pnpm test                        # all unit/integration (turbo)
pnpm --filter @particle/web test:e2e   # Playwright (needs a server on :3000)
pnpm typecheck                   # strict typecheck across the monorepo
```

## Known Windows gotcha

`next start` static chunks return 400 if a **stale** dev server holds the port after a
rebuild — kill the port owner (not just `pkill -f "next start"`) before re-running E2E.
