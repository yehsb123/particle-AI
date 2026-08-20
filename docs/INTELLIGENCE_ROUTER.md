# Intelligence Router

Two-speed intelligence, provider-independent. The decision engine depends only on the
`IntelligenceProvider` interface — never on a concrete SDK — so providers swap freely.

## Providers

- `MockProvider` — deterministic, always healthy, free tier. Computes a validated
  `RuntimeDecision` from context. **The runtime always runs with no API key.**
- `AnthropicProvider` — Anthropic Messages API (fetch, no SDK). Premium tier.
- `OpenAIProvider` / `LocalModelProvider` — OpenAI-compatible chat completions. Standard /
  local tier. Local points at any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM).

Credentials come from env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DM_LOCAL_MODEL_BASE_URL`).
`buildDefaultProviders()` includes a real provider only when it is configured, plus the mock.

## Routing policy

> Do not use a genius model to answer a reflex-level question.

- `fast.classification` → cheapest capable healthy provider.
- `reason.*` → most capable healthy provider.
- `privacy: true` → prefer a local provider.
- No healthy provider → the always-available mock.

Every route emits a `ModelRouteDecision` (provider, tier, reason codes) for audit/replay.

## Validation is the safety boundary

The decision engine validates every provider's output against `RuntimeDecision` (Zod).
Invalid output is discarded and replaced by the deterministic decision, so an unreliable or
adversarial model can never corrupt runtime state or the UI. `reasonSummary` is externally
safe — chain-of-thought is never stored or exposed.

## Enabling a real brain (server)

The runtime server builds its provider fleet from the environment
(`createRuntimeCoreFromEnv` → `buildDefaultProviders`). Set `ANTHROPIC_API_KEY` (or
`OPENAI_API_KEY`, or `DM_LOCAL_MODEL_BASE_URL`) and restart — no code changes. Inspect the
active fleet at `GET /api/brain`:

```
# no key      → {"providers":[{"id":"mock","tier":"free","healthy":true}]}
# with a key  → {"providers":[{"id":"anthropic","tier":"premium",...},{"id":"mock",...}]}
```

Deliberation then routes to the most capable healthy provider; a failed/invalid real call
falls back to the deterministic decision. A guarded live test exercises the real API when a
key is present (`anthropic.live.test.ts`), and is skipped otherwise.
