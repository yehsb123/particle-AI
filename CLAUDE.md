# CLAUDE.md — Particle AI

Project guidance for Claude Code sessions. Read this before making changes.

## What this project is (and is NOT)

- This is **NOT** a chatbot, an LLM wrapper, or a dashboard with a chat panel.
- The product **is the autonomous adaptive runtime**: it observes events, decides
  whether they matter, and restructures a **structured, schema-driven interface**
  around the user's current situation — without the user asking for each change.
- The UI is the AI's **body**; the runtime is its **brain**; capabilities are its
  **abilities**; events are its **senses**; memory is its **experience**.

## Hard rules (do not violate)

1. **No arbitrary runtime code generation.** The model NEVER emits React/JS that gets
   executed. It only emits `UIBlueprint` / `UIPatch` data validated by Zod against the
   component registry. Invalid model output must never reach the renderer.
2. **All model output is schema-validated** (Zod) before use.
3. **Deterministic code beats LLM calls.** Validation, permissions, cooldowns, diffs,
   dedup, rate limiting, state transitions, cost math, component lookup = plain code.
4. **The runtime must work with NO paid API key** via `MockProvider` (deterministic).
5. **Providers stay abstract.** Never hardcode Anthropic/OpenAI into the decision engine.
6. **External side effects pass through the permission engine.** No bypass.
7. **Every autonomous decision is auditable**; UI state is recoverable (undo).
8. **Never store or expose chain-of-thought.** `reasonSummary` only — externally safe.
9. **Never commit secrets.** Credentials are env vars; see `.env.example`.

## Architecture boundaries (enforced by dependency direction)

- `packages/contracts` is the shared vocabulary (Zod schemas + types). It imports nothing
  from apps or UI frameworks.
- The decision engine cannot import React or manipulate the DOM.
- Providers cannot call UI components. The MCP adapter cannot own runtime decisions.
- The persistence layer holds no product decision logic.
- Prefer **pure functions** for: world-state reducers, significance scoring, permission
  evaluation, UI patch validation, morph guards. These are the most heavily tested.

## Layout

```
apps/web        Next.js — UI registry + renderer + inspector + simulation lab
apps/runtime    Fastify — runtime loop, event ingest, WebSocket, REST
packages/*      contracts, event-core, world-model, significance-engine,
                decision-engine, intelligence, capability-core, mcp-adapter,
                permission-engine, ui-protocol, ui-registry, morph-engine,
                memory, persistence, observability
```

Internal packages ship raw TypeScript (no build step) and are consumed via
`transpilePackages` (web) / tsx (runtime) / vitest (tests). Package names are `@particle/<name>`.

## Commands

- Install: `pnpm install`
- Typecheck all: `pnpm typecheck`
- Test all: `pnpm test`
- Web dev: `pnpm web` (http://localhost:3000)
- Runtime dev: `pnpm runtime`
- E2E: `pnpm test:e2e`

## Conventions

- Package manager is **pnpm** (workspaces). Node >= 20.
- TypeScript strict, `noUncheckedIndexedAccess` on.
- Record significant architectural changes as ADRs in `docs/adr/`.
- Keep each phase runnable. Update `docs/STATUS.md` at the end of each phase.
- Do not create a 2,000-line `agent.ts`. Keep modules separated per the runtime loop.
