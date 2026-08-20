# MVP & Acceptance

The MVP proves: *an AI runtime can observe meaningful events and autonomously reshape a
structured interface around the situation while remaining stable, explainable, reversible,
provider-independent, and permission-controlled.*

## Acceptance criteria (from the build instruction)

| # | Criterion | Status |
|---|---|---|
| A | Launches locally with documented commands | ✅ `pnpm install && pnpm web` |
| B | Initial interface is a development workspace, not chat | ✅ `developmentBlueprint` |
| C | An event can be emitted without a prompt | ✅ Simulation Lab / `POST /api/events` |
| D | The runtime decides whether the event matters | ✅ `significance-engine` |
| E | A significant event produces a structured decision | ✅ `decision-engine` → `RuntimeDecision` |
| F | The UI autonomously morphs from that decision | ✅ `runtime-core` + `morph-engine` |
| G | No arbitrary AI-generated JS is executed | ✅ validated `UIPatch` only |
| H | The user can inspect why the morph happened | ✅ Inspector + audit trail |
| I | The user can undo the morph | ✅ `MorphHistory` + Undo |
| J | Permission system blocks unauthorized side effects | ✅ `permission-engine` |
| K | Works with no paid AI credential (mock) | ✅ `MockProvider` default |
| L | At least one real provider enabled via env | ✅ Anthropic/OpenAI/Local adapters |
| M | Provider swappable without rewriting the decision engine | ✅ `IntelligenceProvider` interface |
| N | Events and decisions persisted and replayable | ✅ `EventStore` + deterministic `replay()` |
| O | Automated tests demonstrate incident→morph→recovery | ✅ unit + integration + Playwright E2E |

## How to verify

```bash
pnpm install
pnpm test          # 77 unit/integration tests
pnpm web           # open http://localhost:3000 and use the Simulation Lab
pnpm --filter @particle/web test:e2e   # Playwright: incident → morph → recover → undo
```
