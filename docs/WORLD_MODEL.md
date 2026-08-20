# World Model

The world model is the runtime's continuously-updated belief about what is happening. It
is **not** a chat transcript — it is a reduced snapshot that decisions read from and that
replay can reconstruct exactly.

## Shape (`WorldState`)

- `sessionId`, `updatedAt`
- `currentGoal?` — the user's active objective
- `activeContext` — `{ domain, task, activity, focusedEntity }`
- `environment` — `{ applications, files, processes }` (process health)
- `activeProblems` — open problems (runtime error, build/test failure), deduped by kind
- `recentEvents` — bounded ring (`RECENT_EVENTS_LIMIT = 50`)
- `inferredIntent?` — `{ label, confidence }` (populated in later phases)
- `attention` — focus + typing (drives the morph guard)
- `autonomy` — current autonomy level (MVP default: 2, adaptive UI)

## Reducer

`reduce(prev, event) → next` (package `@particle/world-model`) is a **pure function** with no
clock reads — time comes from the event. Highlights:

- `development.*` events set `activeContext` to software/development.
- `server_error` / `build_failed` / `test_failed` open a `Problem` (deduped) and mark the
  relevant process failed.
- `server_recovered` / `build_succeeded` / `test_passed` close the matching problem and
  restore process health.
- `user.opened_file` tracks files + focused entity; `user.changed_goal` sets the goal;
  `user.focus_changed` updates attention (focus + typing).

Purity means every world state is a deterministic function of the event log, which is what
makes replay (Phase 8) exact.

## Perception plumbing

- `@particle/event-core` `EventStore`: append-only, validates on append, indexes by session,
  and notifies subscribers.
- `apps/runtime` `SessionRuntime`: owns the store, per-session world state and current UI,
  and publishes `world_state_changed` / `ui_patch` messages over WebSocket
  (`/ws/sessions/:id`). REST: `POST /api/events`, `GET /api/sessions/:id/{state,events,ui}`,
  and a simulator (`POST /api/sim/:id/:key`) for infra-free demos.
