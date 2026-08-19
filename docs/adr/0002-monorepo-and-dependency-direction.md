# ADR 0002 — pnpm monorepo with enforced dependency direction

- Status: Accepted
- Date: Phase 0

## Context

The runtime has many concerns (perception, world model, significance, decision,
intelligence, capabilities, UI). Mixing them produces a monolith that cannot be tested or
reasoned about, and lets UI/framework concerns leak into core logic.

## Decision

Use a pnpm + Turborepo monorepo. `packages/contracts` holds shared Zod schemas/types and
imports nothing internal. All other packages depend only on `contracts` (and siblings only
where the layer diagram allows). Apps (`web`, `runtime`) are composition roots that wire
modules together. Internal packages ship raw TypeScript, consumed via `transpilePackages`
(web), `tsx` (runtime), and `vitest` (tests) — no per-package build step in dev.

## Consequences

- Clear, testable boundaries; pure functions for reducers/scoring/guards.
- The decision engine cannot import React; providers cannot call components.
- Slightly more setup than a single app, justified by long-term clarity and testability.
