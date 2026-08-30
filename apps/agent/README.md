# @particle/agent — desktop layer (Concept v2, P3, opt-in)

The browser extension covers what happens in tabs. This small Node agent covers the part of the
day that happens in an editor and a terminal — still **shape only**.

| Sense | Signal sent | Never sent |
|---|---|---|
| File saves under `DM_WATCH_PATHS` | `user.opened_file { path: "src/db.ts" }` (relative) | file contents, absolute paths, ignored dirs (`node_modules`, `.git`, `dist`, `.next`, …) |
| Git branch switches (any watched root with `.git`) | `user.action { key: "branch:<name>" }` — alternating branches reads as **switching** | diffs, commits, remotes |
| Piped tool output (`… \| pnpm agent`) | `development.test_failed { failing }`, `development.test_passed`, `development.build_failed { errors }`, `development.build_succeeded` — **transitions only** | the output lines themselves (they are passed through to your terminal untouched) |

What the runtime does with it: repeated saves of the same file read as **stuck** (context card);
a spread of files reads as **exploring**; a failing test/build run opens the matching incident
layout beside your work and closes it when the run is green again — the same layouts the
simulation lab triggers, now fed by real signals.

## Run

```bash
pnpm runtime                                  # local runtime :8787
DM_WATCH_PATHS=. pnpm agent                   # sense file saves in this repo
pnpm test 2>&1 | pnpm agent                   # sense pass↔fail transitions of a run
```

Open the body for this session: `http://localhost:3000/?connect=1&session=desktop`.

Env (all optional): `DM_RUNTIME_URL` (default `http://localhost:8787`), `DM_AGENT_SESSION`
(default `desktop`), `DM_WATCH_PATHS` (comma-separated; **required to watch files**),
`DM_AGENT_DEBOUNCE_MS` (default 400).

With nothing configured and no pipe, the agent prints how to opt in and exits.
