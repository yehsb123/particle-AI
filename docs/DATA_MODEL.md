# Data Model

The MVP runs in-memory (deterministic, replayable from the event log). Postgres + Drizzle is
the deferred durable backing behind the same store interfaces. The logical entities:

| Entity | Shape (contract) | Where |
|---|---|---|
| events | `MatterEvent` | `EventStore` (append-only) |
| world_state_snapshots | `WorldState` | per session in `RuntimeCore` |
| runtime_decisions | `RuntimeDecision` | returned by `DecisionEngine`, summarised into audit |
| model_invocations | `ModelRouteDecision` | router output (audit) |
| capabilities | `CapabilityManifest` | `CapabilityRegistry` |
| capability_runs | `CapabilityRun` | `CapabilityExecutor` |
| ui_snapshots | `UIBlueprint` | per session in `RuntimeCore` |
| ui_patches | `UIPatch` | applied via `morph-engine` (+ inverse in history) |
| approval_requests | `ApprovalRequest` | `ApprovalStore` |
| audit_logs | `AuditRecord` | `AuditLog` |
| memory_items | key/value (typed later) | `memory.*` capabilities |

## Why in-memory is enough for V1

Because every stage is a pure, clock-injected function of the event log, `replay(events)`
reconstructs the exact world state, UI, and audit trail. Durability (Postgres) changes where
the log lives, not the logic — see `packages/persistence` for the store seam.

Use JSONB for the naturally-evolving payloads when Postgres lands, but keep the strongly
typed application contracts above as the source of truth — do not degrade into untyped JSON.

## Postgres backend (implemented)

`@particle/persistence` now ships a Drizzle + postgres-js backend (`events`, `snapshots` tables,
JSONB `data`). `createPersistence(DATABASE_URL)` returns the Postgres stores (and
auto-creates the schema) when a URL is set, else the in-memory stores. The runtime server
wires it automatically: with `DATABASE_URL` set, every ingested event is durably appended
(`/health` reports `backend: "postgres"`). Verified end to end against Postgres 16 — events
persist and read back, inserts are idempotent. `docker compose up -d postgres` starts a
local instance.
