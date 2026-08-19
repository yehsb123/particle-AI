# Autonomy & Security

## Autonomy levels

| Level | Name | The AI may… |
|---|---|---|
| 0 | manual | respond only to explicit requests |
| 1 | suggestive | recommend UI/actions, not apply them |
| 2 | adaptive UI (MVP default) | reorganise non-destructive UI; run `read` capabilities |
| 3 | assisted | additionally run `safe_write` capabilities |
| 4 | autonomous | additionally run `external_effect` capabilities within bounds |

`destructive` capabilities **always** require explicit approval in the MVP — never automatic.

## Permission evaluation (pure)

`evaluatePlan(items, level)` classifies each planned capability as `authorized`,
`needs_approval`, or `denied` via `classify(risk, level)`:

- `read` auto at level ≥ 2; `safe_write` at ≥ 3; `external_effect` at ≥ 4; `destructive` never.
- Below level 2 the AI is passive — non-auto capabilities are `denied`, not queued.
- Otherwise a non-auto capability is `needs_approval` (an `ApprovalRequest` is created).

Only `authorized` capabilities execute; approvals are surfaced to the human.

## Security invariants

- The model never emits executable code — only `UIBlueprint`/`UIPatch`/`RuntimeDecision`
  **data**, validated by Zod before use. Invalid output is discarded (deterministic fallback).
- External side effects pass through the permission engine — no bypass.
- Every decision, morph, capability run, and approval is auditable (`AuditRecord`).
- `reasonSummary` is externally safe; chain-of-thought is never stored or exposed.
- No arbitrary shell execution in the runtime. Credentials are env vars; secrets never committed.
