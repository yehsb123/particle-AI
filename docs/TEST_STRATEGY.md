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
- **E2E** — Playwright drives the real browser (7 specs): incident→recover→undo (+ presence
  popover, approval), security scenario (+ replay determinism), pattern banner, recurring
  badge, held-morph explanation, morph-history multi-undo, session persistence across
  reload, connected mode (skips when the runtime server is down), and an **axe-core
  accessibility audit** (WCAG 2.x A/AA; fails on serious/critical) across initial, incident
  and developer-mode states.
- **i18n audit** (`apps/web/lib/i18n.test.ts`) — every `t()` key exists in both languages and
  every human-facing blueprint string has a Korean translation (code/logs stay verbatim).

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

## Postgres tests (local)

The `@particle/persistence` integration test and the runtime server's durable path run only
when `DATABASE_URL` is set. On Windows/Node, `localhost` may resolve to IPv6 (`::1`) while a
Docker Postgres binds IPv4 — use `127.0.0.1` to avoid `ECONNREFUSED ::1`:

```bash
docker compose up -d postgres
DATABASE_URL="postgres://dm:dm@127.0.0.1:5432/digital_matter" pnpm -r test
```

CI (Linux) resolves `localhost` to IPv4, so the workflow uses `localhost` without issue.

## Known Windows gotcha

`next start` static chunks return 400 if a **stale** dev server holds the port after a
rebuild — kill the port owner (not just `pkill -f "next start"`) before re-running E2E.
