# @particle/agent — desktop layer (Concept v2, P3, opt-in)

The browser extension covers what happens in tabs. This small Node agent covers the part of the
day that happens in an editor and a terminal — **shape only**, with one exception at the bottom
of this page: the screen layer photographs the apps you list, and reads them if you ask it to.

| Sense | Signal sent | Never sent |
|---|---|---|
| File saves under `DM_WATCH_PATHS` | `user.opened_file { path: "src/db.ts" }` (relative) | file contents, absolute paths, ignored dirs (`node_modules`, `.git`, `dist`, `.next`, …) |
| Git branch switches (any watched root with `.git`) | `user.action { key: "branch:<name>" }` — alternating branches reads as **switching** | diffs, commits, remotes |
| The window in front (`DM_WATCH_WINDOWS`, Windows only) | `user.focused_window { app, window }` — the program name and the window title, on change | what is inside the window, and browser windows (the extension reports those tabs by host) |
| A picture of a listed app's window (`DM_CAPTURE=1` + `DM_CAPTURE_APPS`, Windows only) | `sensor.captured_window { app, window, path, width, height, bytes, backend }` — that a picture was taken, of which app, and where the file is | **the picture itself** — with `DM_SCREEN_READ` unset the pixels stay on this machine and no model is handed them |
| That picture read by a model (`DM_SCREEN_READ=1`, on top of the two above) | `sensor.screen_read { activity, summary, topics, needsAttention, confidence, provider, model, app, window, path }` — the situation in the window, and who read it | nothing the model said outside the schema; the pixels still do not go to the runtime, but they **do** go to whichever model reads them |
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
DM_WATCH_WINDOWS=1 pnpm agent                 # sense which window is in front (app + title)
DM_WATCH_WINDOWS=1 DM_CAPTURE=1 DM_CAPTURE_APPS=KakaoTalk pnpm agent   # photograph those windows
DM_WATCH_WINDOWS=1 DM_CAPTURE=1 DM_CAPTURE_APPS=KakaoTalk DM_SCREEN_READ=1 pnpm agent   # …and read them
```

Open the body for this session: `http://localhost:3000/?connect=1&session=desktop`.

Env (all optional): `DM_RUNTIME_URL` (default `http://localhost:8787`), `DM_AGENT_SESSION`
(default `desktop`), `DM_WATCH_PATHS` (comma-separated; **required to watch files**),
`DM_AGENT_DEBOUNCE_MS` (default 400), `DM_WATCH_WINDOWS` (**required to sense windows**;
1/true/yes/on), `DM_AGENT_WINDOW_MS` (default 1000), `DM_CAPTURE` + `DM_CAPTURE_APPS`
(**both required to photograph anything**), `DM_AGENT_CAPTURE_MS` (default 60000),
`DM_CAPTURE_DIR` (where the pictures land; default the system temp directory), `DM_SCREEN_READ`
(**required before any model is handed a picture**; 1/true/yes/on).

With nothing configured and no pipe, the agent prints how to opt in and exits.

## The screen layer

This is the one sense that reads what is **in** a window rather than the shape of one, so it is
the one sense with its own rules. `docs/CONSENT_V2.md` is the decision behind them.

- **Off by default, and on by two separate acts.** `DM_CAPTURE=1` turns the camera on at all;
  `DM_CAPTURE_APPS` says which programs it may point at. Either one alone photographs nothing.
- **There is no whole-screen option.** A picture is always of one window of one listed program,
  found by process name. At most eight programs, because a list long enough to cover a desktop
  is the whole-screen option by another route.
- **It photographs the listed app you are in**, which is why it needs `DM_WATCH_WINDOWS=1`. Set
  the list without the window reader and the agent says so and photographs nothing — turning that
  reader on from here would start sending the title of every window you open, which is wider than
  the consent you gave.
- **A program can own several windows**, and the picture is of the biggest one it has open, not
  necessarily the one you were just typing in. Measured: switching into KakaoTalk's "상석님" chat
  produced a picture of its larger conversation window instead.
- **Browsers are never photographed**, whatever the list says — the window reader leaves browser
  windows to the extension, so a browser never reaches this layer.
- **One picture per app per `DM_AGENT_CAPTURE_MS`** (default a minute). The window in front is
  read every second; without the floor, an afternoon in a chat window would be an afternoon of
  pictures of it.
- **Which apps are worth listing**: the ones the accessibility interface cannot read. Measured on
  a Windows 11 machine — Hancell names every menu and button, so a picture of it adds nothing a
  cheaper sense does not already have; KakaoTalk answers with six unnamed panes and no
  conversation list, so a picture is the only way to read it. The agent does not make this
  judgement for you, and listing a readable app only costs disk.
- **The pixels never travel to the runtime.** It is handed the file name, the size and the
  program name. The files stay in `DM_CAPTURE_DIR` (or the system temp directory) until you
  delete them.

## Reading the picture (`DM_SCREEN_READ`, off by default)

Taking a picture and having a model read it are two things to agree to, so they are two
switches. This is the second one, and it is the moment the pixels leave the disk they were
written to.

- **Off unless you set it**, and the camera being on does not turn it on. Set it with nothing
  being photographed and the agent says which other switches are missing and reads nothing.
- **Which model reads is the router's answer**, not this agent's: it asks for a brain that can
  be handed a picture and uses the one it is given. With no API key that is the deterministic
  brain, which answers without looking at the picture — so nothing leaves the machine and the
  path still runs. With `ANTHROPIC_API_KEY` set, the picture goes to that provider.
- **You are told where the pixels go.** One line at startup names every brain that may be handed
  a picture; one line per picture names the brain that read it and what it said.
- **What a model is allowed to say is a schema**, not prose: one of a fixed list of situations,
  one sentence, at most five topics, whether the window is waiting on you, and a confidence
  (`packages/contracts/src/screen.ts`). An answer outside that produces no reading and no event.
  A window title is written by the program that owns the window, so an instruction in one reaches
  the prompt — what protects the runtime is that whatever comes back is still only a reading.
- **A picture larger than 4 MB is refused** before anything is sent.
- **Taking the picture does not wait for the reading.** The photographer writes the frame, sends
  `sensor.captured_window` and leaves; a worker reads one frame at a time behind it. Readings used
  to happen inside the capture lock, so the next picture of *any* app waited on a model. If
  readings fall behind, the **oldest** frames are dropped — the window somebody is in now is worth
  more than the one they left two minutes ago — and each drop prints which app it was and how many
  have gone unread. With `DM_SCREEN_READ` unset there is no worker and no queue at all.

## Notes

- On startup the agent probes the runtime once and prints a single warning if it is unreachable
  (sensing stays best-effort — nothing crashes, events are dropped until it is up).
- Events are sent **in observed order** (one in-flight request; parallel fetches can reorder a
  recovery ahead of the failure it recovers from). They are handed over with `?wait=0`, so the
  runtime acknowledges them and runs the loop afterwards, still in the order they arrived — this
  agent has no use for the world state and the morph that used to come back.
- **An acknowledged event can still be dropped.** The runtime answers before it runs anything, and
  a runtime that has fallen behind lets the oldest waiting events of a session go. Its
  acknowledgement carries how many of this session's events it has lost, and the agent prints one
  line whenever that number goes up — `the runtime let go of N more of this session's events`. It
  is not retried: what that observation saw is gone.
- If a re-escalation lands inside the runtime's morph cooldown (e.g. tests fail again 1 s after
  going green), the runtime schedules one `runtime.reconcile` tick and the layout catches up a few
  seconds later — no extra output needed.

- The window in front is read with one long-lived PowerShell process (Windows UI Automation):
  a handle, the process behind it, and the name the window gives itself. Titles animate — a
  terminal alternates spinner characters in its title — so two readings are the same window when
  their titles match under the decoration, and only a real change is sent. On every other OS the
  sense is absent and the rest of the agent is unaffected.
- Git is sensed by watching `.git/HEAD` (worktrees' `gitdir:` pointers are followed) — no `git`
  process is spawned and nothing but the branch name is read.
- Linux: `fs.watch({ recursive: true })` registers an inotify watch per directory. Large trees can
  exceed `fs.inotify.max_user_watches`; raise it (`sudo sysctl fs.inotify.max_user_watches=524288`)
  or point `DM_WATCH_PATHS` at the sub-directories you actually work in. Watcher errors are logged
  and never crash the agent.
