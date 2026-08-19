# ADR 0001 — Structured UI protocol instead of model-generated code

- Status: Accepted
- Date: Phase 0

## Context

The AI must be able to reshape the interface autonomously. The naive approach is to let
the model generate React/JS and execute it. That is powerful but unsafe and unreliable:
arbitrary code can crash, leak, loop, or do anything, and it cannot be validated.

## Decision

The model emits **data only** — a `UIBlueprint` or `UIPatch` — validated by Zod against a
fixed registry of approved components. The frontend owns the registry and renders the data.
No model-authored code is ever executed.

## Consequences

- Reliability: invalid output is rejected before render; the blast radius is bounded to the
  approved component set.
- The morph engine can diff by stable component `id` and preserve focus.
- Expressiveness is limited to composed primitives — acceptable, and extendable by adding
  registry components (a reviewed, deliberate act) rather than by widening code execution.
