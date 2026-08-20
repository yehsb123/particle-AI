# Contributing to Particle AI

Thanks for your interest. This is experimental research software; contributions that keep the
core invariants intact are very welcome.

## Setup

```bash
pnpm install
pnpm test          # unit + integration
pnpm typecheck
pnpm web           # http://localhost:3000
```

## Non-negotiable invariants

Please preserve these (see `CLAUDE.md` and `docs/`):

1. The model emits **validated data** (`UIBlueprint` / `UIPatch` / `RuntimeDecision`), never
   executable code. All model output is Zod-validated before use.
2. Deterministic code beats LLM calls (validation, permissions, cooldowns, diffs, math).
3. The runtime must run with **no API key** via the deterministic mock provider.
4. Providers stay abstract; the decision engine never imports a concrete SDK.
5. External side effects pass through the permission engine; every decision is auditable.
6. Reducers, guards, scoring, and the morph engine stay **pure** (clock injected).

## Workflow

- Keep each package's tests green and `pnpm typecheck` clean.
- Add tests for behavior changes (pure logic is cheap to test — see `docs/TEST_STRATEGY.md`).
- Follow the existing module boundaries; don't create a monolithic `agent.ts`.
- Record significant architectural decisions as ADRs in `docs/adr/`.

## Commit / PR

- Small, logical commits. Describe the "why".
- CI (`.github/workflows/ci.yml`) runs typecheck, tests (incl. Postgres), web build, and E2E.
