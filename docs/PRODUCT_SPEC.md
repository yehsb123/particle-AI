# Product Spec

## One-liner

An adaptive computing runtime: the AI observes meaningful events and restructures a
structured, schema-driven interface around the user's current situation — stably,
explainably, reversibly, provider-independently, and under permission control.

## Primary demo — development incident workspace

1. The interface opens as a **development workspace** (editor + files + build status), not a chat.
2. A runtime failure (`HTTP 500` / build failure) occurs. The user does **not** ask for anything.
3. The runtime judges the event significant, decides, runs read-only diagnostic capabilities,
   and **morphs** into an incident workspace (logs, diff, service state, AI assessment,
   suggested actions) — beside the editor, which is never destroyed.
4. On recovery + stability, it de-escalates back to the development workspace.
5. Every morph is inspectable ("why did the UI change?") and reversible (undo).

## What the user can do

- **Simulation Lab** buttons emit events with no external infrastructure.
- **Inspector** shows significance, provider, decision reason, capabilities run, permission
  verdicts, and guard reason codes.
- **Undo** reverts the last morph. **Theme** toggles light/dark.

## Non-negotiable properties

- Structured UI protocol (no model-generated code). Zod-validated everywhere.
- Two-speed intelligence; runs fully on a deterministic mock (no API key).
- Provider abstraction; swap Anthropic/OpenAI/local without touching the core.
- Morph Guard: cooldown, dwell, focus protection, unsaved-state protection, critical bypass.
- Permission + autonomy levels; auditable decisions; deterministic replay.

## Explicitly out of scope for V1

Full OS monitoring, arbitrary desktop control, autonomous payments/email, self-modifying
production code, fully autonomous Level 4, mobile, device swarms. See `ROADMAP.md`.
