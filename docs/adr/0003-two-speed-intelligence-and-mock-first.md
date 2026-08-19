# ADR 0003 — Two-speed intelligence, mock-first

- Status: Accepted
- Date: Phase 0

## Context

Sending every event to an expensive LLM is slow, costly, and makes deterministic logic
non-deterministic. The demo must also run for anyone, with no API key.

## Decision

Split intelligence into a **fast brain** (deterministic reflex: significance, transitions,
cooldowns, routing) and a **deep brain** (LLM deliberation behind a provider abstraction).
The cheap significance engine gates access to the deep brain. Ship a deterministic
`MockProvider` as the default so the whole system runs with no credentials. Real providers
(Anthropic/OpenAI/Local) are opt-in via env vars and swappable without touching the
decision engine.

## Consequences

- Cheap, fast, always-runnable. Deterministic code stays deterministic.
- Provider independence is a first-class constraint, verified by the mock path in tests.
- The decision engine consumes an `IntelligenceProvider` interface, never a concrete SDK.
