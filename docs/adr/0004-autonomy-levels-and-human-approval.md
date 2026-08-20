# ADR 0004 — Autonomy levels with human approval for risky capabilities

- Status: Accepted
- Date: Completion sprint

## Context

The runtime can assemble and execute capabilities autonomously. Some capabilities only read
state; others change the world outside the runtime (external effects) or are destructive.
Executing all of them automatically would be unsafe; requiring approval for all of them would
make the adaptive UI useless.

## Decision

Gate execution by a per-session **autonomy level** (0–4) crossed with a capability's **risk**
(`read` / `safe_write` / `external_effect` / `destructive`), evaluated by a pure function
(`permission-engine`):

- `read` auto-runs at level ≥ 2 (the MVP default); `safe_write` at ≥ 3; `external_effect` at ≥ 4.
- `destructive` **always** requires explicit approval in the MVP.
- Below level 2 the AI is passive — non-auto capabilities are denied, not queued.

Capabilities that are not auto-authorized become `ApprovalRequest`s. The human approves or
rejects; approval executes the capability (`RuntimeCore.approve`) and is audited. The demo
ships `development.revert_diff` (external effect) to exercise the full path.

## Consequences

- Safe by default: no external side effect runs without consent at the default level.
- Tunable: raising the level (e.g. to 4) lets remediation run automatically; lowering it makes
  even reads require consent — visible live via the UI autonomy selector.
- Auditable and reversible: every approval and execution is recorded; UI morphs remain undoable.
