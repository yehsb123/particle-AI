# Architecture

## Conceptual layers

```
Perception (events)
    ↓
World State (what the system believes is happening)
    ↓
Significance Detection (does this matter? — cheap, deterministic first)
    ↓
Intent Inference
    ↓
Autonomous Decision Engine (structured output, never prose)
    ↓
Intelligence Router (which brain should think)
    ↓
Capability Assembly (compose abilities)
    ↓
UI Morphology Engine (plan → guard → patch)
    ↓
Execution
    ↓
Feedback (observe result, persist, repeat)
```

This runtime **is** the product. It is not hidden behind a generic agent framework; the
orchestration loop is ours (`packages/*` + `apps/runtime`). External frameworks may later
be added as adapters but never own the core.

## Package map & dependency direction

Arrows point in the allowed import direction (leaf → shared). Nothing imports "up".

```
contracts (Zod schemas + types)  ← imported by everything, imports nothing internal
  ↑
event-core, world-model, significance-engine, permission-engine,
ui-protocol, ui-registry, morph-engine, capability-core, intelligence,
decision-engine, mcp-adapter, memory, persistence, observability
  ↑
apps/runtime (composition root: wires modules into the runtime loop)
apps/web      (composition root: registry + renderer + inspector)
```

Rules (enforced by review + `docs/adr/0002`):

- `contracts` imports no UI framework and no app code.
- The decision engine cannot import React or touch the DOM.
- Providers cannot call UI components. The MCP adapter cannot own runtime decisions.
- The persistence layer contains no product decision logic.
- Pure functions for reducers, scoring, permission checks, patch validation, morph guards.

## Two-speed intelligence

- **Fast brain (reflex):** classification, state transitions, significance, cooldowns,
  obvious routing. Cheap, deterministic where possible. Runs with **no** LLM.
- **Deep brain (deliberation):** ambiguous intent, planning, novel situations, capability
  composition, significant UI restructuring. Powerful, slower, infrequent, behind the
  provider abstraction. Falls back to `MockProvider` when no key is configured.

## Data flow at runtime

See `RUNTIME_LOOP.md`. The loop is deliberately small and each stage is a separate,
independently testable module. There is no monolithic `agent.ts`.
