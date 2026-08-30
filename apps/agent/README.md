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

## Notes

- On startup the agent probes the runtime once and prints a single warning if it is unreachable
  (sensing stays best-effort — nothing crashes, events are dropped until it is up).
- Events are sent **in observed order** (one in-flight request; parallel fetches can reorder a
  recovery ahead of the failure it recovers from).
- If a re-escalation lands inside the runtime's morph cooldown (e.g. tests fail again 1 s after
  going green), the runtime schedules one `runtime.reconcile` tick and the layout catches up a few
  seconds later — no extra output needed.

- Git is sensed by watching `.git/HEAD` (worktrees' `gitdir:` pointers are followed) — no `git`
  process is spawned and nothing but the branch name is read.
- Linux: `fs.watch({ recursive: true })` registers an inotify watch per directory. Large trees can
  exceed `fs.inotify.max_user_watches`; raise it (`sudo sysctl fs.inotify.max_user_watches=524288`)
  or point `DM_WATCH_PATHS` at the sub-directories you actually work in. Watcher errors are logged
  and never crash the agent.
