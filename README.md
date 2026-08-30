# Particle AI

[![CI](https://github.com/yehsb123/particle-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/yehsb123/particle-AI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An experimental adaptive computing runtime in which AI continuously interprets context
and restructures its interface, capabilities and intelligence around the user's current
situation.

Instead of asking AI to use software, the AI **becomes** the software.

> ⚠️ Experimental research software. Not production-ready.

[한국어 README →](README.ko.md)

## The idea

Conventional generative AI is `prompt → model → response`. Particle AI runs a
continuous loop instead:

```
observe → understand → evaluate significance → infer intent → decide
→ select intelligence → select capabilities → act → morph the interface
→ observe the result → repeat
```

The interface is the AI's body. When something meaningful happens — a build fails, a
service returns HTTP 500 — the runtime notices on its own and reshapes the workspace
around the incident. The user never typed "show me the error dashboard."

Reliability guardrails make this safe:

- The model only emits **validated UI data** (`UIBlueprint` / `UIPatch`), never executable code.
- A **Morph Guard** prevents the UI from jumping around: cooldowns, dwell times, focus protection.
- Every morph is **reversible** (undo) and every decision is **auditable**.
- The whole thing runs in **deterministic mock mode** with no API key.
- Providers are abstract — swap Anthropic / OpenAI / a local model without touching the core.

## Quick start

```bash
pnpm install
pnpm test          # run the unit tests
pnpm web           # open http://localhost:3000
```

No API key is required — the runtime uses a deterministic mock provider by default.
To enable a real provider, copy `.env.example` to `.env` and fill in a key.

## Browser extension (Concept v2)

Particle AI is a **layer over the browser**, not just one page. `apps/extension` (MV3) senses
tab focus, navigation hostnames, interaction counts, idle time and — opt-in — the *shape* of
network traffic (host · status · latency, never paths or bodies), and shows the body in a
side panel on any site.

```bash
pnpm --filter @particle/extension build   # -> apps/extension/dist
pnpm runtime && pnpm web                  # runtime :8787, body :3000
```

`chrome://extensions` → Developer mode → **Load unpacked** → `apps/extension/dist`.
Consent per sensing layer lives in the extension's Options page. See
[`apps/extension/README.md`](apps/extension/README.md) and [`docs/CONCEPT_V2.md`](docs/CONCEPT_V2.md).

## Desktop agent (opt-in)

`apps/agent` extends sensing to the editor and terminal — still shape only: file **saves**
(relative paths) and test/build **pass↔fail transitions** from piped output.

```bash
DM_WATCH_PATHS=. pnpm agent      # sense file saves
pnpm test 2>&1 | pnpm agent      # sense a run's transitions (output is passed through)
```

See [`apps/agent/README.md`](apps/agent/README.md).

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the runtime loop in
[`docs/RUNTIME_LOOP.md`](docs/RUNTIME_LOOP.md). Design decisions live in
[`docs/adr/`](docs/adr/). Current progress is tracked in
[`docs/STATUS.md`](docs/STATUS.md).

## Status

Built in phases (see `docs/STATUS.md`). Phase 1 (UI Matter) renders and morphs a
structured interface from validated blueprints and patches, with undo and a morph guard.

## License

[MIT](LICENSE) — © 2026 Particle AI contributors. Experimental research software.
