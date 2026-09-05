# Status

Updated at the end of each phase.

## Concept v2 — behavior layer (2026-08-31 ~) — see `CONCEPT_V2.md`

**Where it stands (end of the 2026-08-31 overnight run):** the thesis is implemented end to end.
Behavior (clicks, dwell, idle, returns, repeats, alternation) and traffic *shape* (host · status ·
latency, opt-in) flow from three sensors — the page, an MV3 browser extension, an opt-in desktop
agent (file saves, git branch via `.git/HEAD`, piped test/build transitions) — into one runtime
that keeps a continuous intent, prepares the screen before and without anything breaking, learns
from dismissals (persisted across reloads/restarts), reports honestly what it senses, reconciles
the body when a timing hold would leave it out of step, and answers only to its own origins/token.
Everything is event-sourced and replays deterministically. Verified by 1409 unit/integration tests,
16 Playwright E2E tests across 15 specs (incl. a real extension in Chromium against the live runtime, dark-mode axe),
and two adversarial review passes (25 findings fixed). Remaining ideas live in the loop prompt.
- **P1 done**: the body reshapes from **behavior alone**. `BehaviorState` + `@particle/intent-engine`
  (continuous intent: exploring/focused/stuck/switching/idle/returning/debugging), behavior
  significance, intent-driven `augment` morphs (returning → live re-entry summary; stuck →
  related context), web sensors (tab visibility, idle, clicks-as-actions), intent visible in
  the rail/presence. Proven with zero errors in unit + browser E2E (`behavior.spec.ts`).
- **Next**: P2 browser extension (MV3: tabs/visibility/navigation + network *shape* + DOM
  interaction → local runtime; side-panel body), then P3 opt-in desktop agent.
- HTTP 500 / build / test / security incidents remain as **one case** (intent `debugging`
  with error signals), not the product story.

- **P2 in progress** (2026-08-31): `BehaviorState.network` + `network.request` shape reducer
  (`network_failure` problem opens on 5xx/error, clears on success); `apps/extension` MV3
  (background: focus/navigation/webRequest shape with per-layer consent; content: interaction
  counts/idle/visibility; options; side panel iframing the body with `?connect=1&session=ext`).
  Web reads `session`/`connect` URL params and auto-connects. 4 extension unit tests; full
  suite + 9 E2E green. Build note: `fs.cpSync` recursive segfaults on Node 22.17/Windows →
  file-by-file copy.
- **P2 `network_failure` layout** (2026-08-31): traffic *shape* is a first-class problem kind.
  `network.request` 5xx/error on a new host → significance `network_shape` → brain plans
  read-only `network.inspect_shape` + `workspace.get_state` → "Connection trouble" panel
  (failing-host table bound to the capability, honest assessment text, timeline, undo only —
  nothing to remediate on the user's side). Repeated failures to the same host do NOT
  re-deliberate; recovery of the last failing host closes the problem and restores the body.
  Sim palette (web + runtime) gained `API 503` / `API recovered`; E2E `network.spec.ts`
  (10/10 specs green).
- **P3 desktop agent (opt-in)** (2026-08-31): `apps/agent` — file saves under `DM_WATCH_PATHS`
  → `user.opened_file { path }` (relative only); piped tool output → test/build pass↔fail
  **transitions** (`OutputTracker`, summary lines only, output passed through). Repeated saves
  of one file now count as the "stuck" signal (significance + runtime-core test). Live-verified
  against the real runtime: piped `Tests 2 failed` opened the Test failure layout, a green run
  closed it. Fixed an extension bug: navigation sent `user.action` AND `user.opened_file`,
  alternating the repeat key so "stuck" could never trigger — one event now.
- **P4 learning from dismissals** (2026-08-31): undo is feedback. `RuntimeCore.undo` records
  `dismissed:<intent>:<variant>` in preference memory; after `DISMISS_THRESHOLD` (2) undos of the
  same augmentation variant the runtime withholds it for the session (`morph_suppressed` audit,
  `learned_preference` guard code, `IngestResult.learned`). Incidents are never suppressed —
  a real problem always surfaces. runtime-core: 20 tests.
- **Honest sensing indicator** (2026-08-31): `WorldState.sensing` (sensor → layers) fed by
  `sensor.layers_changed`, which the extension announces from its consent state (on start and on
  every change) and the agent announces from what it was asked to do (files / output). The body's
  presence popover renders "currently sensing — this page: …  · browser extension: …  · desktop
  agent: …" from that state, so the indicator can only say what the sensors actually reported
  (Concept v2 privacy rule #3). world-model 8 tests, extension 9.
- **"switching" intent** (2026-08-31): `BehaviorState.recentKeys` (last 8 action/entity keys);
  `isSwitching` = the last 6 keys all change yet span ≤3 contexts (A B A B A B) — juggling, as
  opposed to breadth ("exploring"). Intent transitions seen only *after* the reduce now trigger
  deliberation (`intent_transition` reason code) — deterministic, replay-safe. Brain augments with
  the "Juggling several things" card whose text is bound to `workspace.get_state:juggling` (the
  actual places being alternated). Agent senses git branch switches (`user.action branch:<name>`,
  name only) and announces the `git` layer. intent-engine 9, world-model 9, runtime-core 21.
- **Extension E2E** (2026-08-31): `apps/web/e2e/extension.spec.ts` loads the built MV3 extension
  into a Chromium persistent context against the live runtime: navigating to a (locally fulfilled)
  site becomes `site:<host>` + the announced layers; the event log provably contains no path/query
  and no `network.request` (opt-in off); the side panel page embeds the body already connected.
  CI e2e job now builds the extension and starts the runtime, so `connected` and `extension`
  specs run for real instead of skipping. 12 specs.
- **Review fixes** (2026-08-31, from a full read of the Concept v2 code paths):
  - runtime: CORS is an allow-list (`DM_ALLOWED_ORIGINS`, default the body's origins + any
    `chrome-extension://`); writes from other origins get 403; optional shared secret
    `DM_INGEST_TOKEN` (`x-particle-token`, sent by extension options / agent env); sessions are a
    bounded LRU (500); `/api/sessions/:id/approvals` is scoped to the session.
  - extension: consent defaults to OFF until read from storage on every service-worker start
    (previously the defaults were sent before the read); hidden-since survives SW restarts via
    `chrome.storage.session`; webRequest listeners exist only while network consent is on;
    dropped unused `tabs`/`alarms` permissions; options form writes atomically.
  - determinism: `replay()` uses an event-sourced clock by default (each event's timestamp is
    "now"), and the web restore path does the same — replaying morphs minutes apart no longer
    collapses into cooldown rejections; the history strip is rebuilt from the replayed steps.
  - undo attribution: Dismiss/undo buttons carry `payload.targetId`; `undo(session, { componentId,
    learn })` counts a dismissal only when the top morph introduced that component; multi-step
    "go back" never learns; apply-before-pop so a failing inverse loses nothing; `hydrate` resets
    the undo stack; `morphMeta` bounded with the history.
  - agent: watcher errors no longer crash the daemon; token header. web: `dm_events` bounded (500).
  - runtime-core 25 tests, runtime 13; 12/12 E2E.
  - honesty: the web page now announces its own layers (`sensor.layers_changed` web: interactions /
    idle / visibility) and batches interaction COUNTS every 10 s; the indicator is derived only from
    what sensors reported (no hard-coded line). The "stuck" card lost its fixture diff — it shows a
    table of the real facts (`workspace.get_state:stuckRows`: repeated key ×N, open problems,
    recent places). Korean coverage: augment card strings, autonomy level labels, runtime
    server/local, typing, fallback.
- **P4 persistence** (2026-08-31): learned preferences outlive the session. `RuntimeCore.exportMemory /
  importMemory` (preferences only — never events or content; `PreferenceMemory.load` takes the max,
  ignores garbage). Web: `dm_prefs` saved on every undo and imported BEFORE the event log is
  replayed, so the restored session is judged the way the person taught it; Reset clears it.
  Server: a `memory` snapshot is saved with every morph snapshot and on undo; `resume` imports it.
  E2E `learn.spec` now reloads and proves the card stays withheld with zero new dismissals.
  runtime-core 26, runtime 13, memory 6.
- **Agent git sensing without polling** (2026-08-31): `.git/HEAD` is watched (worktree `gitdir:`
  pointers followed); `branchFromHead` parses the ref (detached → `detached@<sha7>`), no `git`
  process is spawned. Linux inotify limits documented. agent 10 tests.
- **Localized generated sentences** (2026-08-31): capabilities emit a template id + identifier-only
  params (`summaryTpl`, `jugglingTpl`) next to the English text; blueprints bind `tpl` as well as
  `text`; the renderer fills `t(tpl.id)` in the viewer's language (`fillTemplate`, unknown slots
  stay visible). No generated sentence is ever translated as a string. web 5 tests.
- **Dark-mode accessibility audit** (2026-08-31): `a11y.spec` now audits dark mode too (initial,
  behavior context card, incident, developer mode). It found three real AA contrast failures that
  the light audit could not see: the code editor textarea inherited the UA default (black on the
  dark panel), the `ok` badge (#81C784 on #1B5E20 ≈ 3.9:1 → #A5D6A7, 5.0:1), and the reason tags
  (primary-700 on accent-low, 1.4:1 → primary-200, also under `prefers-color-scheme: dark`). 13 specs.
- **Second review, batch A** (2026-08-31): runtime reads are protected too — a non-allow-listed
  browser Origin is refused for every method (WebSocket upgrades are not covered by CORS and the
  world state lists every host you visited); when `DM_INGEST_TOKEN` is set it guards reads and
  writes (`?token=` accepted for WS), `/health` excepted; the server binds loopback by default
  (`DM_HOST`); GET/WS reads use non-creating `peekWorld/peekBlueprint`, so junk ids cannot evict
  real sessions. Undo attribution travels over REST (`{componentId, learn}`) and a dismissal of a
  card that is not the newest morph removes just that card (an undoable step, counted against the
  morph that introduced it) instead of reverting something else; server undo also snapshots the UI
  so resume cannot resurrect a dismissed card. Extension webRequest listeners are registered
  synchronously (MV3 wake-ups) with consent checked inside, and `ready` always resolves.
  `environment.files` bounded (50). Agent: first readable HEAD is a baseline, not a switch.
  runtime 16 tests, runtime-core 26.
- **Second review, batch B** (2026-08-31, web): live events wait on a restore gate until the saved
  log is replayed and in state (no event is stamped with a replayed timestamp, nothing overwrites
  the log mid-restore); storage is per session (`dm_events:<id>`, `dm_prefs:<id>`) and another
  session's events are never replayed; the embedded/connected body skips local restore; StrictMode's
  double-mounted effect replays once; connected-mode undo carries `{componentId}` to the server;
  `replay(events, clock?, { memory })` seeds the preferences that were in force at restore so
  Replay & verify cannot report a false "differs"; `.app[data-restored]` marks restore completion.
  E2E: no Reset-click/reload races (fresh context per test), learn.spec waits for `data-restored`,
  extension.spec judges only this run's events. 13/13.
- **Extension options/side panel** (2026-08-31): options page localized (Korean when the browser is
  Korean, via `data-i18n` + a static dictionary — never page content), dark-mode tokens for options
  and the side panel shell (no flash before the body paints), focus ring on inputs.
- **Reconcile after a timing hold** (2026-08-31): found live via the agent pipe — a build that fails
  again 1 s after recovering is held by the 5 s cooldown, and with no further output the body stayed
  out of step with the world forever. Now a hold on timing alone (cooldown / dwell) reports
  `IngestResult.retryAfterMs`; the server (per-session timer) and the local web body ingest one
  `runtime.reconcile` event at that time; significance deliberates on it only while a problem is
  open, so the brain re-surfaces the incident and the guard now allows it. It is an ordinary event,
  so the log and replay see exactly what happened. Verified live: "Build failure" absent right after
  the third transition, present ~6 s later. WS now also carries `learned` (connected-mode banner).
  Agent pipe verified: 13 repeated tsc-style lines → 3 transition events. runtime-core 27.
- **Third review (10 findings, all addressed)** (2026-08-31): a pending reconcile now SURVIVES
  unrelated events (cancelled only when the morph applies; the fixed bug had silently returned for
  any session with live sensors); token mode no longer bricks the body — the web client sends
  `x-particle-token` (from `NEXT_PUBLIC_DM_TOKEN` or `?token=`, which the side panel appends from
  extension storage) and the WS URL carries `?token=` (now honoured ONLY on `/ws/`); the restore
  gate opens in `finally` so a stale saved log can never deadlock all ingestion; a stale targeted
  dismiss (card already gone) is a quiet no-op instead of a MorphApplyError → 500; reconcile ticks
  are never recorded as user patterns; the web reconcile timer is cleared on unmount and a real
  remount restores again (WeakSet per core); attention-held morphs get their second chance on focus
  release; sensor send queues have a 5 s timeout and a 500-event cap (drop newest — order beats
  completeness); evicted sessions get no tick; fake-timer server test proves the tick survives
  unrelated events. runtime-core 29, runtime 17.
- **Closing touches** (2026-08-31): `QUICKSTART.md` (bilingual 5-minute walkthrough) linked from
  both READMEs; CI fix — the fake-timer reconcile test now runs on an isolated in-memory
  SessionRuntime (faking timers hung the Postgres driver's awaits on the CI runner); a restored
  log that ENDS on a timing hold arms one reconcile tick (the body catches up without a live
  event); Playwright workers serialized — options.spec and extension.spec share the live
  runtime's `ext` session, and parallel workers raced each other's consent toggles (the
  intermittent extension failure). 14 specs green, serial.
- **Pattern memory persists** (2026-08-31): `exportMemory/importMemory` now carry the pattern
  table (counts + the `suggested` flag), and the server's `memory` snapshots/resume restore it —
  a restart never re-offers a template suggestion the person already saw, and counting continues
  where it left off. The web restore imports preferences only (its event-log replay re-observes
  patterns; importing both would double-count). memory 7, runtime-core 30 tests.
- **The extension says where events actually go** (2026-09-06): the other half of a sensor's
  promise — not what it watches but where what it sees is sent. That was decided by a prefix test
  rather than by parsing, so typing `192.168.1.20:8787`, a reasonable thing to write for a runtime
  on another machine, fell back to this one; the box went on showing what was typed and the line
  beneath it printed the default address no matter what was configured, so somebody was told twice
  that their address was in use while their events went elsewhere. `http://` passed the prefix
  test, lost its last slash to a trailing-slash trim, and became `http:/`, which is not an address
  at all. It is parsed now, with one answer shared by the background and the page, and the page
  says the address that will really be used — with a note in both languages when what was typed
  could not be read as one. The default is unchanged and nothing about what is sent changed.
  7 tests. 1409 unit/integration total.
- **A gitdir file names where to watch** (2026-09-06): the agent's consent is the paths somebody
  passed it, and inside one of those a repository may keep its real git directory elsewhere and
  leave a `.git` FILE saying where — a file that names any directory at all. It resolved to a
  parent, to an absolute path, to anywhere, and the agent put a watcher on it. The easy rule here
  is the one that breaks the real case: a worktree's git directory is normally outside the watched
  root, under the main repository, so refusing anything outside would refuse the feature's whole
  purpose. What decides instead is whether a branch can actually be read there — the watch follows
  a gitdir only where a HEAD is, and says so on stderr rather than silently doing nothing — and a
  line too long to be a path is refused outright. The piped-output path was probed and left alone:
  the classifier's patterns are plain, with no nested quantifiers, so a crafted line cannot make it
  hang. 7 tests. 1402 unit/integration total.
- **The activity log is a surface too, and an action is a name the runtime acts on** (2026-09-06):
  measured the rest of the belief first, since shaping one part is no reason to assume the
  neighbours hold — two thousand distinct actions, files, failing hosts, problems, processes and
  sensor announcements each leave the world state under ten kilobytes, with recent keys at eight,
  files at fifty, hosts at five. What did not hold is where those values are shown: the renderer
  reads every value through one helper and the inspector was given the same one, while the
  activity log rendered whatever it was handed — and it is handed names a model wrote, the
  capability an action asks for, the codes a morph was held for, the id of a patch. All three
  surfaces agree now. An action is also where a model's name stops being a caption: its event
  decides what pressing a button asks the runtime for, so it is held to the length every other
  identifier is and refused rather than trimmed, for the reason a component id is. An audit
  record's detail was checked and left: it is bounded because everything that goes into one was
  bounded over the last three nights. A capability's error message is not bounded, but nothing
  reads it. 9 tests. 1395 unit/integration total.
- **The event a provider is shown is a shape too** (2026-09-06): probing what a prompt weighs
  after the belief was shaped showed the weight had moved rather than gone — the belief down to
  nine kilobytes, the triggering event beside it a hundred, ninety per cent of the context. The
  decision engine hands a provider three things as JSON and that one was still whole: sent to
  somebody else's model, paid for by the token, and liable to push everything that matters out of
  the window. It goes as shape now, from the same function the belief uses rather than a second
  copy of the rule, so the two cannot drift. What the decision turns on survives — a host, a
  status, a latency — and a string nobody predicted is trimmed rather than dropped, so nothing
  goes silently missing. What is not shaped is what the runtime decides with: the significance
  reflex reads the raw event and runs before any of this, because that is the sensor's report and
  the numbers in it are the signal, and the event log keeps it whole. The test watches the request
  the engine actually builds rather than calling the shaping function and trusting it reaches the
  prompt. 10 tests. 1386 unit/integration total.
- **The belief remembers a shape, and that list travels three ways** (2026-09-06): the belief
  holds a short list of recent events so the runtime can tell a repeat from a novelty, and it kept
  each one whole. That list goes to every body watching the session on every change, into every
  snapshot, and into the context of every prompt a provider is given, since the decision engine
  hands the whole world state over as JSON — thirty events carrying a hundred kilobytes each made
  a three megabyte belief, sent all three ways. Nothing read those payloads: the significance
  reflex counts how many recent events share a type and the body labels the last one, and that is
  every reader there is. What is kept is now what a payload is meant to be — a path, a host, a
  status — with names held to the length every other identifier is, control characters out, and a
  handful of fields rather than a thousand; anything nested or listed is content rather than shape.
  Three megabytes became nine kilobytes, and the identifiers beside a blob survive rather than the
  whole payload being dropped. The event log keeps events whole, so a replay still has everything.
  The other recursive tree walks were swept and left alone: the morph engine, the renderer and
  ui-protocol all walk validated trees, now a hundred deep at most. 10 tests.
  1376 unit/integration total.
- **The gate had a second walk that recursed, and CI found it** (2026-09-06): both commits above
  went red. The measurement in front of the schema was working — a component parsed to a refusal —
  but the blueprint still threw, and only on CI. The difference was stack budget, which is the
  tell: the blueprint's duplicate-id check runs on the root it was handed, and a field that failed
  still hands it one, so a five thousand deep tree went into a recursive id walk after the
  measurement had already refused it. There was enough stack here for five thousand frames and
  there is not on a Linux runner. Reproduced locally by running the probe with a smaller stack,
  which is what should have come before pushing a change whose whole subject is the stack. That
  walk is iterative now and takes raw data as readily as a component, because raw data is what a
  failed parse hands it. The first version of the test copied the walker into the test file and
  asserted the copy worked; it goes through the exported check instead. 2 tests on top of the 14.
- **The gate refuses a tree instead of dying on it** (2026-09-06): the blueprint schema is the
  gate in front of the renderer and it is recursive, so validating a tree walks it with the call
  stack — a five thousand deep tree made `safeParse` itself raise "Maximum call stack size
  exceeded". The gate throwing rather than refusing takes down whatever called it, which in the
  body is the whole interface, and such a tree can arrive from a snapshot an older build wrote or
  a patch a model emitted. A tree is measured iteratively first now, and one past a hundred deep
  or two thousand nodes is turned away before anything recurses into it; fifty thousand children
  went from parsing in 1.4s to refused in 34ms. The measurement sits on the component schema
  itself, not only on the blueprint and patch that carry one, since guarding the entry points left
  the exported schema able to take the stack down for anyone validating a component directly. A
  component id is bounded at the length every other identifier is, and refused rather than trimmed
  — two long ids cut to the same length would be the same component as far as every later patch
  could tell. 14 tests. 1364 unit/integration total.
- **The reason summary was one field of a family** (2026-09-06): the same decision object carries
  three more strings a model writes, each still asked only not to be empty. The `variant` composes
  a preference key that is stored, snapshotted and shown in the memory tab, and composes the
  learned notice the body renders as a line of text; `targetMode` is written into the blueprint as
  the mode the workspace is in; `capabilityId` is what the runtime looks up and runs. Fifty
  thousand characters and escape sequences passed into every one, and a plan could name five
  hundred capabilities the runtime would run one after another. They are names, not prose, so they
  are held to the length every other identifier is and cleaned the same way, and one left with
  nothing readable is refused. The plan itself is refused when it is not a handful rather than
  trimmed — shortening a caption still describes the same decision, while dropping half the
  capabilities would run a plan the model never reasoned about, and a refused decision falls back
  to the deterministic one. Where the layout is chosen from that variant was already safe from an
  earlier sweep; this is about where the string is kept, not where it is read. 12 tests.
  1350 unit/integration total.
- **The one sentence a model writes for a person has a length** (2026-09-05): following the
  reason codes to the screen — the intent's own are shown nowhere, the morph guard's go through the
  helper that gives them words — what reaches a person is the reason summary, in the presence
  popover and under the inspector, rendered straight. It is the one piece of model-written prose
  the product deliberately shows, and the contract asked only that it not be empty: fifty thousand
  characters parsed and would render whole, an escape sequence survived intact, a newline flood
  too, while the built-in provider writes about ninety. Both places it is declared now trim it and
  strip what is not writing, keeping the newline a wrapped sentence has; six hundred is room for
  several sentences and none for a page. Cleaned rather than refused, deliberately — a summary
  that runs long is a provider being wordy, not a decision being wrong, and discarding the
  decision over its caption would cost the person the reshaping it describes — but still refused
  when nothing readable is left, since a decision nobody can read is not auditable. 10 tests.
  1338 unit/integration total.
- **An intent nobody has words for is still shown, readably** (2026-09-05): sweeping the closed
  vocabularies for the shape the presence had — a list in the contracts, a door that does not check
  it, a body that looks the value up by name — left intent. Three places show it (the presence
  popover, the inspector, and the row for every other session this runtime senses) and each
  printed whatever the lookup returned, so a label with no words came back as the key with its
  prefix on: a session whose runtime had inferred something newer read `intent_thinking` in the
  rail. An empty string was kept as an intent and a three hundred character label rendered whole.
  The label stays open, the opposite call from the presence beside it, and the difference is what
  they are: a presence is a fixed state the body draws a styled dot for, so one it does not know is
  refused at the door, while an intent is something a runtime worked out about a person and a newer
  one may have worked out something this build never heard of. It goes through the same describe
  helper the sensors and hold reasons use — words when there are words, the name itself when there
  are none, bounded either way. `INTENT_LABELS` and its schema were used by nothing; they close
  what *this* engine may say, proven across every rung of the ladder and every retuning of its
  thresholds. 20 tests. 1328 unit/integration total.
- **What the AI is doing is one list** (2026-09-05): the body shows the AI's presence as a dot
  with a word beside it, looked up by the state's own name, so a state it has no translation for
  is printed as itself. The runtime declared that union in the file where it decides the next one,
  the body declared its own copy, and the frame between them was checked only for being a string —
  an empty one, the word "thinking", `__proto__` and a five thousand character one were all
  accepted, each landing beside the dot verbatim while the dot lost its styling, since `data-state`
  is an attribute CSS selects known values on. One list in the contracts now: the engine that
  decides the next presence reads it there, the body reads it there, the frame is checked against
  it, and the cast on arrival is gone rather than merely safer. The producer has its own half of
  the test — whatever `nextPresence` hands back is a state the body has words for, including when
  handed one it does not know, which a resumed session can do. 14 tests. 1315 unit/integration
  total.
- **The inspector is the last surface that should go blank** (2026-09-05): the renderer was
  hardened; its sibling next door was not. A decision frame carries the audit records the inspector
  draws, and the door checked that the frame carried a list without ever checking what was in it —
  a list of `null`, `7` and the word "audit" went straight through. The inspector draws each
  record's kind as text, its detail stringified, its id as the row key, so a kind that is an object
  threw (React refuses one as a child) and a null entry threw on being read for an id: both empty
  the one place a person goes to find out why their body changed. Records are parsed entry by
  entry now, bounded, and a frame with none left is nothing this body can draw; the rows are drawn
  through the same reader the renderer uses, and a detail that refers to itself says so. Static
  markup lands on the tab a component opens with, and the inspector opens on the trace — so the
  world, decision, memory and audit tabs had never been rendered by anything but a person clicking
  them, which is why none of this showed up in a test. They take an opening tab now and all five
  are covered. One test wanted an empty audit list accepted; its own name says it checks each kind
  carrying what that kind carries, an empty list carries nothing, and the runtime only sends the
  frame when there are records. 15 tests. 1301 unit/integration total.
- **The renderer bounds and cleans what it shows, on every path into it** (2026-09-05): the
  renderer is the last thing between validated data and the screen, and it had three ways of
  reading a prop — one that checked the type, one that checked for an array, and one that handed
  the value straight through, used eight times. Through that third one a Metric whose value was an
  object threw, since React refuses an object as a child, and a throw in this tree empties the body
  rather than one card; a JSONViewer whose data referred to itself threw too, which a prop can do,
  because a binding puts a capability's own output object into one rather than something that came
  off the wire. Nothing checked size or content either: props are written by the model and checked
  for their shape, so a label of a million characters rendered whole, a list prop of twenty thousand
  entries rendered every one, and an escape sequence went to the screen intact. Values are bounded
  and cleaned now, lists are bounded, the raw paths go through the same reader, and a structure that
  cannot be stringified says so. The newline and tab stay, since a Markdown block renders pre-wrap;
  the carriage return does not. The hostile-prop fixtures claimed to be props of every shape a
  component might read and never put a bare object in the two the raw reader served — they do now,
  self-referencing ones included, which caught that the test labelled its own cases with
  `JSON.stringify`. 12 tests for size and content beside the 10 for shape. 1286 unit/integration
  total.
- **A layer name is an identifier like every other one** (2026-09-05): a sensor declares what it
  observes and the body shows that back as the honest-sensing indicator, so those names are what
  someone reads to find out what is watching them. Every other identifier the belief takes goes
  through one reader that trims it and strips control characters — a path, a host, an action key,
  the sensor's own name — and layer names did not. How many a sensor could declare was bounded at
  sixteen, but not how long one could be: a five thousand character layer went into the belief
  whole, and one carrying an escape sequence kept it, into snapshots, into the rail that lists
  every session this runtime senses, and into whatever an operator reads them with. They go
  through the same reader now, and a name left with nothing in it is dropped rather than shown as
  an empty chip. 9 tests. 1274 unit/integration total.
- **A resume test that was measuring the runner** (2026-09-05): CI went red on `9b84d8f` — not
  the change in it, but a test written two nights earlier timing out at 5.08s against a 5s limit,
  with the docs commit on the same tree passing, which is what a test sitting exactly on the line
  looks like. It ran three hundred ingests through the real endpoints before checking that a quiet
  session could still be resumed: 625ms locally against an in-memory store, but CI runs against a
  real Postgres where every ingest is six round trips. The count was never the point — the store
  keeps the latest of each kind per session, so a neighbour's volume stops mattering at one, and
  the store's own test already carries two thousand writes in memory for nothing. Thirty now, with
  room on a slow runner; the file went from 5.4s to 0.27s. The rest of the suite was swept for the
  same trap: every other large loop is in memory, with no HTTP or database under it.
- **A number the belief acts on has to be a number** (2026-09-05): sweeping the rest of the
  reducer after last night's interaction count found the two numeric readers left on `Number()`,
  which reads `true` as 1, `"300"` as three hundred and `[503]` as five hundred and three. A
  status of `[503]` marked a host as failing — and a failing host is what reshapes the body around
  a connection view, so a payload merely shaped like a number could open an incident nobody had.
  A duration of `true` became one second away; a latency in an array made a request slow. All
  three read through one function now, and nothing a real sensor sends reads differently, since
  both sensors have always required an actual number before sending one. The failure threshold is
  left alone: reading a status above 499 as a failure is a product decision, not a type check. One
  test asserted the old behaviour — its own name calls that payload the wrong shape, and its point,
  that the world survives one, still holds since the request is still counted. 12 tests.
  1265 unit/integration total.
- **The belief counts the interactions the sensors counted** (2026-09-05): both sensors batch —
  the body and the extension each watch a ten-second window, count how many times something
  happened in it, never what, and send that count. The belief added one per report however many it
  carried, so a person clicking two hundred times in a window looked exactly like one who clicked
  once, and the counting both sensors do was thrown away on arrival. The comment on that branch
  described a payload of a single interaction, `{ kind, target }`, that no sensor has ever sent,
  which is what made the increment look right. The count is bounded on the way in at ten thousand
  per report, and a report with no count still counts as one so a sender that reports each
  interaction as it happens is read the way it means. Worth saying plainly: nothing reads this
  number today — the inspector shows context, problems, environment, attention and autonomy, not
  behavior — so this is the belief being accurate about what it was told, not a bug anyone could
  see. The content script was checked and left alone: it sends only its own counters and the
  hostname, never anything read from the page, and the background rebuilds every relayed payload
  from scratch against a whitelist of kinds. 8 tests. 1253 unit/integration total.
- **A logger that cannot fail its caller, and traces a neighbour cannot take** (2026-09-05): the
  logger threw on a field it could not serialise — a circular object, a bigint — and a logger is
  called from inside catch blocks, so the runtime reporting a snapshot that failed to save would
  lose the ingest that was carrying on regardless. It writes a line saying its fields were lost
  instead, since quietly dropping the whole line is the other way to lose the report, and a sink
  the host supplied is wrapped the same way. The trace store bounded one ring across every
  session, so a busy session pushed out the traces of every quiet one beside it and the inspector
  — the one place a person looks to find out why their body changed — showed nothing for a session
  that had done nothing wrong. Each session has its own ring now, with the ceiling counting
  sessions; that raises the worst case from 500 traces to 50 across 200 sessions, the same order
  as the event store and the audit log. Three tests asserted the old contract, one naming the
  behaviour outright without recording a reason for wanting it. The body's own event list, which
  grows in memory while only the last 500 persist, is deliberately left: the restore sets the list
  to what came back, so the live core and the replay check are built from the same events, and
  trimming it would make that check call the difference non-determinism. 11 tests.
  1245 unit/integration total.
- **The runtime asks every body watching, not only the one that caused the question**
  (2026-09-05): writing the end-to-end test for the decided-approval broadcast is what showed the
  other half was missing. Only the body whose own event caused an approval learned it was pending,
  from the answer to that call; every other body on the session got the presence frame — which has
  always gone to all of them — so it showed a runtime waiting for approval with nothing on screen
  to answer it with. Four frames go out on an ingest that needs consent and not one carried the
  question. `approval_asked` goes out with the presence now, and the two doors an approval arrives
  through — the answer to the call that caused it, and the socket frame to everyone else — check it
  through one parser rather than one each. The E2E is the flow itself: one session in two bodies,
  the second asked without having sent anything, and answering in either clearing the card in both
  — the first spec here to drive two pages at once. The event log stores bound by writes the way
  the snapshot store did, but they are not the same problem: an event log is read in full, so
  keeping only the newest would be wrong, and nothing replays from the runtime store today.
  23 tests. 1236 unit/integration total.
- **Snapshots keep what a resume reads, and nothing else** (2026-09-05): every ingest writes
  three snapshots — world, body, memory — and a resume reads exactly one of each, the most recent.
  Both stores kept every one ever written. In memory that meant a single busy session filled the
  store and pushed out the snapshots of every quiet session beside it: probed with a small
  ceiling, a session that had saved once was left with nothing after a neighbour ran, and resumed
  to nothing having done nothing wrong — while of the thirty snapshots crowding it out, a resume
  read three. The store now holds the latest of each kind per session, so the ceiling counts
  sessions rather than writes and the session written to most recently is the last forgotten;
  sessions and kinds live in nested maps rather than under a composed key, so no session id can be
  spelled to reach another's. Postgres had no bound at all — three rows per ingest, kept forever,
  all read back on every resume — and now deletes what each save replaces, by id rather than
  timestamp so two saves in the same instant still leave one row. CI runs the suite against a real
  Postgres and both of its integration tests pass, so that path is exercised after all. Three tests asserted the old
  contract (history in save order) and now pin the new one. 11 tests. 1226 unit/integration total.
- **The trail: records that identify themselves, and a resume that leaves a mark** (2026-09-05):
  two more sibling asymmetries in the same file, found by reading undo, redo and resume side by
  side. A reversal took its audit id from the clock, so two in the same millisecond were the same
  record as far as anything reading could tell — and a multi-step go-back gesture makes exactly
  that: four reversals produced two ids. The inspector draws one row per record keyed by its id,
  so the trail a person reads to find out why the body changed was collapsing rows. A count now;
  records that already had a natural key, like an approval decided, keep it. And a resume left no
  mark at all, though it replaces both what the runtime believes and what the body shows with
  something an earlier process wrote — a reader could not tell that the body above them came off a
  disk rather than out of the events listed under it. It records what came back: world, blueprint,
  memory. The reconcile event id stays on the clock: it carries the session, the timer for a
  session is cancelled before another is scheduled, and the event store does not key by id.
  8 tests. 1218 unit/integration total.
- **A decision on a proposed capability is recorded and announced** (2026-09-05): the runtime
  proposes a risky capability and waits for a person, and their answer went nowhere. Nothing was
  broadcast — one body asking is not the only body watching, so the same session open in another
  tab or in the side panel kept a card for something already settled, and clicking it got a 404
  and no explanation. Undo, three lines down the same file, had told every watcher all along. The
  refusal was worse: it left no trace at all. The trail recorded what a person allowed and kept
  nothing of what they turned down, which is the half of a consent record worth having. Both now
  append a record and emit `approval_decided`, and the body drops the card whoever answered it.
  The message union was declared twice as well — what the runtime sends and what the body accepts
  — and had already diverged on what a decision frame carries, so the two lists are one list in
  the contracts now. Approve and reject still take no session: sessions are not principals here
  (the gate is the origin allow-list and the shared token, and a caller naming a session in a URL
  would be as free to name another), so a scope check there would look like a boundary without
  being one. 18 tests. 1210 unit/integration total.
- **One simulation palette, and a key that is searched for** (2026-09-05): the palette was
  written out twice — an object in the runtime, an array in the body — and both sides need it
  while neither can be the source, since the body builds these itself in local mode where there is
  no runtime to ask, and the runtime builds them in connected mode where the body only sends a
  key. They had already drifted: two buttons carried a payload in the body and none on the server,
  so the same button sent a different event depending on which mode a person was in, which is the
  one difference connected mode is supposed not to have. Nothing reads those fields yet, so it was
  latent rather than broken. One list now, in the contracts, and one function that builds the
  event; the list is the union, so the body gains the Open file button the runtime already had.
  The key was a defect on its own: it comes off the URL and the palette was an object, so
  `toString` and `constructor` answered with something truthy that was not an event, and the
  person was told their request was invalid rather than that no such button exists. It is a search
  now, and the refusal names the key bounded so a long one cannot come back whole. 15 tests.
  1192 unit/integration total.
- **The body the runtime already has goes through the gate** (2026-09-05): switching to
  connected mode asks the runtime what this session already looks like and draws the answer,
  before any event arrives — and that answer was cast straight into the renderer. The blueprint
  schema exists to stand in front of the renderer, and pins its version on purpose so a blueprint
  written by another build is refused rather than drawn under this build's assumptions; this one
  call went past it, and a build with a different component registry drew fine. An answer that is
  not a blueprint is also not an empty body: the renderer reads the root of whatever it is handed,
  so an error body, an older shape, or a plain null threw inside the render and blanked the whole
  interface. `parseBlueprint` is the gate now, and the caller tells the two failures apart — a
  runtime that cannot be reached and one that answered with something unreadable are different
  things, and neither is a reason to throw away the body already on screen, since the socket may
  still bring a patch that reads fine. That was the last cast answer in the client. 10 tests.
  1177 unit/integration total.
- **The session rail: one shape, a parsed listing, and a link that keeps working** (2026-09-05):
  the rail in one session's body lists the other sessions this runtime senses and links to each.
  Its shape was declared twice — the return type of `listSessions`, and a cast in the body — so a
  field either side changed was one the other went on believing in; `SessionSummary` now lives in
  the contracts and both read it there. The listing itself was cast, and the rail reads a layer
  list off every entry: reading `.length` off something that is not a list throws inside the
  render, which takes the whole body down rather than one row. It is parsed now, leniently on
  purpose — a session that exists is what the rail is for, so an entry whose fields disagree keeps
  its name and reports nothing rather than vanishing, since an empty rail says there are no other
  sessions, which is a confident lie where a session reporting nothing is a quiet one. And the link
  dropped the token: the extension side panel passes one in the page's address, because a page
  cannot read the extension's storage, so following a link from the rail opened a body that could
  no longer reach the runtime, silently. `sessionHref` carries it, same origin, building both
  halves through `URLSearchParams` so neither the id nor the token can add a parameter of its own.
  16 tests. 1167 unit/integration total.
- **A sensor sends a shape, and a shape has a size** (2026-09-05): the agent reports names it
  read off this machine and the extension reports the host a page came from, and none of those are
  bounded at the source. A branch name comes out of `.git/HEAD`, a file like any other, and the
  pattern reading it ended in an open-ended group — a HEAD holding a 200,000 character line sent a
  200,000 character event. A URL parses with a hostname of any length, so the extension had the
  same hole. Worse than the size, none of it was cleaned: a name carrying an escape sequence went
  into an event, into the belief, into cards someone reads, and into the agent's own stderr, where
  it is an instruction to their terminal rather than a name anybody chose. Both sensors trim and
  clean before sending, and the world model — which already cut a name too long to be one, because
  a sensor is not the only thing that can post an event — takes control characters out on the way
  in as well. `MAX_IDENTIFIER` moves into the contracts so there is one of it; neither sensor
  imports it at runtime, but each one's tests assert its own bound still agrees. `branchFromHead`
  is total now too: it reads a file off disk, and a read answering with something other than text
  gave a TypeError instead of no branch. 28 tests. 1151 unit/integration total.
- **The body reads the permission policy instead of restating it** (2026-09-04): three things
  the body said about risk were written out beside the policy rather than read from it. The
  approval card wore a fixed critical badge whatever the risk was and named the risk with its own
  stored identifier, so a person saw a red `external_effect` in either language; the tone now comes
  from `canAutoRun` — loudest for what the policy will never run on its own, quiet for what this
  runtime would have run unasked anyway, since a read held back only because its server is not
  allowed yet is not a red alarm. The hint under the level chooser claimed that at L0 and L1 even
  reads need consent: the policy denies them outright, so anyone who followed it and set L0 waited
  for an approval card the runtime would never send. Each level now states what it does, built from
  the policy. Naming the risk is also what surfaced the third: it put a value from the server
  through a helper that formats a name, and a name that is not a string throws inside the render,
  which in React takes the whole body down rather than one card — the connected E2E spec started
  failing on its first attempt and passing on retry. That answer had never been parsed;
  `pendingApprovals`, guard reason codes and the rest were cast and believed. `parseSimResponse`
  keeps each part only where it is what it claims, drops the rest, and bounds every list, and every
  name helper now survives a name that is not one. 28 tests. 1123 unit/integration total.
- **A capability that declares what it needs is finally asked about it** (2026-09-04): a
  `CapabilityManifest` has always carried `requiredPermissions`, and nothing anywhere read it. An
  MCP tool declares its server there, so a tool from a server nobody had allowed was judged on its
  name-inferred risk alone — and `get_secrets` reads as a read, which auto-runs at the default
  level 2. `evaluatePlan` now takes what has been granted, and the rule is one-directional on
  purpose: a manifest for an MCP tool is somebody else's server describing itself, so an ungranted
  name can only hold a capability back, never let one through. Below level 2 everything stays
  denied and destructive still always asks. The permission name also has one home now,
  `mcpPermission(serverId)`, escaped the way a capability id is, so two servers cannot share one
  allowance and the grant side cannot spell it differently from the manifest side. And the card
  that asks now says why: it used to show a capability id and a risk badge and leave the person to
  decide without the question. The reason travels as a code so the words can be theirs, and the two
  are not interchangeable — being asked because something is risky is a different decision from
  being asked because nobody has allowed its server, and only the second is answered by knowing
  which server it is. 33 tests. 1095 unit/integration total.
- **Every sensor and layer the indicator can name has words for it** (2026-09-04): the indicator is
  the runtime's honesty about what it can see, and the one place a person looks to find out what is
  being observed about them. A name with no phrase appeared there as the lookup key itself, and one
  such name existed — the world model records a sensor that did not say what it is as "unknown", so
  a report without a sensor name put `sensor_unknown` on that line. Which sensors and layers exist
  was also spread across three packages with nothing holding them together: the extension decides
  its layer names, the agent decides its own, the body writes the words. The vocabulary now lives
  in the contracts where all three can see it, each sensor is tested to report only layers in it,
  and the body is tested to have English and Korean words for every entry — with an unwritten name
  still shown readably, since saying that some sensor is watching beats saying nothing is. 11 tests,
  and the contracts as a devDependency in the two sensors so their tests can read the shared list;
  neither imports it at runtime, so both stay standalone. 1062 unit/integration total.
- **A card that fills itself in is checked against the capability it names** (2026-09-04): a card
  showing live data declares a binding — a capability id and a field on that capability's output —
  and the two halves live in different packages. Nothing would have noticed if a capability stopped
  returning one: the card would quietly keep showing the placeholder it shipped with, which looks
  like a card that simply has nothing to say. Every binding is now walked and checked — the source
  in the one format the runtime reads, a capability that exists, a field it answers with on a
  troubled session and on a fresh one, and only ever a capability that reads, since a card filling
  itself in must not be able to change anything outside the runtime. All eight resolve today; the
  test is there so the next one that stops is loud. 48 tests, with the structure of everything the
  registry can put on screen: each incident layout applying cleanly, with unique ids and none the
  workspace already holds (a clash would mean the incident never appears, since the morph engine
  refuses an id the tree already has), laid out differently per kind, and asking only for
  operations the engine implements. runtime-core 96, ui-registry 65, 1051 unit/integration total.
- **A snapshot missing a part it can do without is filled in, not refused** (2026-09-04): the world
  state is what the runtime believes is going on, and the copies that come back from outside are
  snapshots written by whichever build was running then. The schema had one part with an empty form
  to fall back on and seven without — an accident of when each was added rather than a decision —
  so an older snapshot restored or was thrown away depending on which field that build happened to
  lack. The session and the moment are still required; everything else falls back to its empty
  form, so a resume brings back the problems that were open and the interface that was showing. A
  snapshot whose parts are there but are not what they claim is still refused whole. 12 tests, and
  the runtime test that asserted the previous contract now proves both directions.
  contracts 50, 1003 unit/integration total.
- **A frame is checked before the body believes it** (2026-09-04): everything arriving over the
  socket was cast to a message and handed straight to the body, which acts on one immediately —
  replacing the interface, replacing its belief about what is happening. A cast is not a check, so
  anything that parsed as JSON got through: a number or a null reached a handler that reads a field
  off it, a `ui_patch` could carry no interface at all or one from another build, a suggestion list
  could be a string, and **a frame addressed to another session was applied to this body**. Frames
  are read rather than assumed now — for this session, of a known kind, carrying what that kind
  carries, with the interface and the belief parsed against the same schemas the runtime uses — and
  anything else is dropped like an unparseable frame. 13 tests, plus the older lifecycle test
  updated: it asserted the previous contract that anything parseable is forwarded.
  web unit 100, 990 unit/integration total.
- **A prop of the wrong kind must not take the interface down** (2026-09-04): the renderer is the
  last thing between validated data and the screen, and validated only covers the shape of the
  tree — a component's props are whatever the model put there, and a data binding drops a
  capability's output straight into one. A table whose rows came back as a list containing null, a
  timeline of entries that are not entries, a tree of nodes that are not nodes and inspector
  entries missing half their fields all threw, and a thrown error here blanks the whole body rather
  than the one card with bad data. Six of the thirty-three types threw on some shape and thirteen
  more put "[object Object]" on screen where a title or label was not a string; two rendered lists
  without keys. Text from a prop is text or nothing now, arrays are read entry by entry keeping
  whatever is usable, and a row that is not a row shows as one cell beside the rows that are fine.
  10 tests across all thirty-three types and six sets of hostile props: none throwing, none leaking
  an object or NaN or undefined, none warning about keys, markup escaped everywhere, and every
  shape that used to take the body down still showing the values that were good.
  web unit 87, 977 unit/integration total.
- **The history strip says what each step did, in the reader's language** (2026-09-04): the morph
  history is the record of everything the runtime has done to the interface, and every chip is
  something a person can click to undo back to. It printed the intent itself with its underscore
  swapped for a space, so a Korean reader saw English identifiers — "surface incident", "restore
  normal" — while the panel around them was in Korean. Each step now says what it did in both
  languages, including the two the body makes on its own (a card dismissed, a change whose decision
  named no intent), with a readable fallback for anything unwritten. Second of these found by
  looking for user-visible states with no words, after the two hold reasons; **the sweep behind it
  covered the rest** — the presence indicator, the seven intent labels, the autonomy levels and the
  guard's reasons all have their phrases. 9 tests. web unit 77, 967 unit/integration total.
- **Two reasons the body could give had no words for them** (2026-09-04): when the runtime decides
  not to reshape the interface it says so and says why, and that why is the only thing between an
  interface that held back on purpose and one that looks broken. Eight reasons can reach the screen
  and two had no phrase — the learned preference, and the structurally-impossible refusal added
  earlier in this campaign without its words. The old formatter dropped what it could not
  translate, so a hold with one known and one unknown reason showed half of why, and a hold with
  only unknown reasons printed raw identifiers. The reasons now live in one list in the contracts,
  where the runtime raises them and the body reads them, and **both sides are held to it**: the
  guard and the runtime only ever answer with a reason from the list, and the body has English and
  Korean words for every entry. An unwritten reason is still shown rather than dropped — saying a
  strange thing beats saying half a thing. 12 tests over both sides. web unit 68, 958 total.
- **A different root is a change, not the absence of one** (2026-09-04): `computeDiff` answers what
  would turn one tree into another, and for two trees with different roots it answered with
  nothing. Its walk pairs nodes by id — a new root has no partner, is never added because it has no
  parent, and the old root is never removed because it is the root — so the caller got an empty
  patch, which does not mean the trees match but that the question could not be answered, and
  applying it left the old tree in place. A changed root is a single replace now. Found by the
  sweep for exports nobody consumes that the stale event-type list prompted: **unused code drifts
  quietly, and this one had been giving wrong answers with nothing to notice**. 20 tests, all
  judged by applying the diff rather than counting operations — a child added or removed, siblings
  reordered, a node reparented or moved into a new parent, props and types changed, subtrees
  swapped, a tree emptied, a root replaced in both directions, each landing on the tree it was
  asked about and passing the renderer's gate. morph-engine 86, 946 unit/integration total.
- **Every button in the palette is pressed, and the list of known events is true again**
  (2026-09-04): the simulation palette is how anyone without a broken service of their own sees the
  runtime work, and each key is a button that nothing exercised — a key that stopped answering
  would have been a dead button found by whoever was demonstrating. All of them now go through the
  real endpoint. Writing that turned up a stale export: the list of event types the runtime knows
  named sixteen while the world model reduces a dozen more it had never heard of — traffic shape,
  the security pair, what each sensor watches, the reconcile tick, and everything the behaviour
  layer reads. Nothing consumed the list, which is how it drifted; it now names what the runtime
  actually reads and says plainly that the vocabulary stays open. 11 tests: every key answering
  with a valid event, an undefined key refused without creating the session it was aimed at, the
  incident story reshaping the body and putting it back, the security story gating its remediation,
  failing traffic read as shape and cleared on recovery, and each simulated session kept apart.
  **Also swept: the reads that hand back shared objects** — the ones carrying authority or learning
  already return copies, and the rest are read-only views of append-only records no caller mutates.
  runtime app 76, 926 unit/integration total.
- **A plan waiting for consent goes when the question does** (2026-09-04): a capability the runtime
  may not run on its own waits in two places — the approval record a person will answer, and the
  plan itself, which capability with which input, held until they do. The approval store was given
  a ceiling and forgets the oldest answered questions at it; the plans were not, so they
  accumulated for the life of the process, each still holding its input, long after the question it
  waited on was forgotten. Seven hundred unanswered questions left seven hundred plans that could
  never run again. They go with the question now. **Sixth unbounded collection this campaign, and
  the sweep behind it found the rest already bounded**: the event log, the audit trail, the trace
  ring, sessions, the morph history, the reconcile timers. 7 tests: a capability offered and run
  once consent is given, run only once however many times the answer arrives, not run after a
  refusal, an id nobody issued answered with nothing, the plans staying in step through seven
  hundred unanswered questions, and each session's waiting question staying its own.
  runtime-core 86, 915 unit/integration total.
- **What someone taught the runtime has a ceiling too** (2026-09-04): a preference key carries the
  morph intent and its variant, and a variant is a free string the model chooses, so nothing capped
  that table — it grew for as long as a session lived, in memory, in every snapshot written on
  every applied morph, and in the browser's own storage, where five thousand keys is a quarter of a
  megabyte on the way to the quota. The pattern table beside it was given a ceiling earlier in this
  campaign and this one was missed: the same oversight in the same file. Five hundred now, forgetting
  the least reinforced first, so a dismissal repeated twenty times survives a flood of one-offs and
  a snapshot cannot push the table past the ceiling. 19 tests: the ceiling and what survives it,
  plus the deterministic brain the runtime falls back to — a decision the schema accepts for every
  situation the runtime meets, the same answer twice for the same situation, tied to the event it
  answered, saying why in readable words while keeping its thinking to itself, planning only
  reading, and answering a request that is not a decision without pretending to decide.
  memory 36, intelligence 59, 908 unit/integration total.
- **The clock a restored log replays on only moves forward, in the body too** (2026-09-04): the
  body keeps its own log in the browser and replays it on reload, with the morph guard judging each
  step by the saved event's own instant. It followed each timestamp wherever it went, backwards
  included — and a saved log is in the order events were recorded, while their timestamps came from
  a clock that can be stepped back by a correction or a machine waking up, so following it back
  measured negative elapsed time and refused a morph that had gone through: the restored body did
  not match the one that was saved. The same rule was fixed in the runtime's replay earlier the
  same day and lived in two places, so the browser side is now a named clock with the rule written
  down once. 22 tests: the clock real until a replay begins and after it ends, staying put for a
  timestamp older than the one before, carrying on past one it cannot read; and the rest of the
  world model — a goal recorded, replaced and kept short enough to be a label, focus given up
  without pretending someone is typing, the recent-event window keeping the newest while leaving
  the runtime's own ticks out of it though a tick still moves the clock, and at most one problem of
  each kind however long a session runs. world-model 72, web unit 58, 889 unit/integration.
- **A sensor name is a key, and some keys mean something to the language** (2026-09-04): the
  honest-sensing indicator is built from a map keyed by each sensor's own name, and that name
  arrives in an event payload. Assigning by key set the prototype instead of adding an entry when a
  sensor called itself `__proto__`, so one posted event left the map reading as empty and the world
  state failing its own schema — the belief every later decision is made against, broadcast to
  every client and written to a snapshot. Entries are defined as own properties now, whatever the
  name. **Seventh time a lookup keyed by outside input has caused trouble here, and the first on
  the writing side rather than the reading side.** There are three sensors and nothing stopped a
  client declaring three hundred; sixteen is the ceiling, and a known sensor can still update
  itself at it. Durations were also taken as they came, so a payload could report someone idle for
  minus five seconds. 23 tests: layers recorded and revoked per sensor, a sensor named after a
  language feature surviving with the world still valid, traffic counted with one problem while any
  host is failing and none once they all answer, the last few failing hosts kept most-recent-first,
  and a client error or redirect not counted as failing. world-model 59, 867 unit/integration.
- **An id names one ability, and a broken capability is named as broken** (2026-09-04): registering
  a capability under an id that was already taken replaced it silently, risk and all. An id is what
  a decision plans, what the permission engine judges and what an approval answers for, so swapping
  the ability underneath changes what a person consented to — and that matters more now that tools
  discovered from an MCP server can claim ids, since a server can offer the same name twice. A
  second claim is refused, and registering a batch reports which ids it could not take. The
  executor also had two ways of blaming a capability for our own words: one that threw something
  other than an Error produced a failed run with no reason at all, and one that returned nothing
  put our type error ("cannot read properties of undefined reading ok") into the audit as though
  the capability had said it. 15 tests over both. **Also checked after the approval listing: no
  other place builds an id by joining parts and takes it apart again by guessing** — the remaining
  prefix matches are paths, schemes and key namespaces. capability-core 56, 844 unit/integration.
- **A session sees its own approvals, and knowing that does not mean reading an id**
  (2026-09-04): the endpoint listing what is waiting for consent said in its own comment that it
  never shows another session's — and it did. An approval id reads
  `appr-<session>-<decision>-<capability>`, the listing matched on that prefix, and session ids
  come from the URL, so a session called `a` matched every approval of a session called `a-b` and
  saw what the runtime had proposed to do in that other workspace along with the id needed to
  answer for it. Same shape as the MCP id collision fixed the same day: an identifier built by
  joining parts with a separator those parts can contain, then taken apart again by guessing. An
  approval now carries the session it was asked in — required in the contract, since one that
  cannot say whose it is has lost what makes it answerable — and the listing reads that. 4 tests:
  two sessions whose ids differ only by where the dash falls each seeing exactly their own, a
  session that never asked seeing nothing, and the contract refusing an approval with no session.
  runtime app 65, 829 unit/integration total.
- **A capability id belongs to exactly one tool, and a bad MCP server breaks nothing**
  (2026-09-04): a capability id was the server id and the tool name joined with a dot, and a dot is
  ordinary in both — server `a.b` with a tool `c` and server `a` with a tool `b.c` produced the same
  id, so one capability quietly shadowed the other in the registry along with its risk, which is
  what decides whether it may run without asking. The segments are escaped now: ordinary names read
  exactly as before, unusual ones can no longer collide. Discovery also took a server at its word —
  one that could not be reached threw straight through it, one answering with something other than
  a list threw a type error, and a single tool described without a name took down discovery for
  every other server. Keeping MCP out of the core includes keeping its failures out: a misbehaving
  server now contributes nothing and breaks nothing, malformed tools are skipped, and one server
  contributes at most two hundred tools. A tool that failed by throwing something that was not an
  error also produced a failure with no reason at all. 17 tests covering all of it.
  mcp-adapter 39, 827 unit/integration total.
- **The send queue is a thing with a name, and it has tests** (2026-09-04): both sensors send what
  they observe one at a time, because a transition only means something in order — a recovery
  arriving before the failure it recovers from reads as a runtime that never broke. Both had the
  same twenty lines written out separately, with the ceiling, the drop rule and the timeout
  repeated in each, and no test behind any of it; that is the fourth time this campaign has met the
  shape where one fact lives in two places with nothing stopping them drifting apart. Each sensor
  keeps its own copy — the agent and the extension are standalone by design — but the queue is now
  a named function beside that package's other shaping helpers, with the sending injected, so the
  policy is testable without a network. 15 tests: order kept when the far end answers out of order,
  the queue carrying on after a failed send and telling whoever asked to be told, the ceiling
  dropping the newest rather than the oldest since what is queued is the beginning of the story,
  the count settling back to nothing, how many were let go reported honestly, and the extension
  waiting for consent to be read before anything leaves. agent 46, extension 55,
  810 unit/integration total.
- **A window too small to show alternation is not evidence of it** (2026-09-04): juggling is read
  from the last few places someone moved between — the window has to alternate and span only a
  couple of contexts. With a window of one there is nothing to alternate, and with a window of zero
  the check took the whole history instead of none, since slicing the last nought of a list gives
  the list; an empty history therefore read as juggling. A window below two is no longer evidence
  of anything. **Third time that slicing trap has turned up here** (episodic memory returned every
  episode when asked for none), so it is worth naming: asking for none has to give none. 22 tests —
  ping-pong between two or three contexts seen while breadth stays exploring and a repeat stays
  stuck, a full window wanted before deciding, the ladder in order with confidence falling as the
  reading gets vaguer, thresholds at their exact boundary, a config asking for more patience
  followed, and every threshold set to zero still producing one honest reading.
  intent-engine 50, 795 unit/integration total.
- **One place decides where the body lives** (2026-09-04): the side panel checks whether the body
  is reachable before loading it, and it checked one address while pointing the frame at another —
  the probe was written into the code, the frame's URL into the panel's HTML. That HTML is the only
  knob a person has, so running the body on another port left the panel saying "not reachable"
  forever, since loading is gated on a check that never succeeds. The probe now uses the origin of
  whatever the frame points at. Passing the runtime token to the body moved next to it (the body's
  page cannot read extension storage): trimmed before deciding whether there is one, escaped so a
  token cannot add query parameters of its own, joined with a question mark when there is no query
  yet. 22 tests: that addressing, plus the rest of the shared vocabulary — what a capability
  declares and answers with, the three states an approval can be in and nothing else, an audit
  record tied to a session and a readable moment while its detail stays open, attention assuming
  nobody is typing until told, and a request to a brain naming what it is for.
  extension 50, contracts 38, 773 unit/integration total.
- **The replay clock only ever moves forward** (2026-09-04): replay judges a log by the timestamps
  in it, so the timing guards see the gaps they saw live instead of collapsing minutes into
  microseconds. But a log is in the order the runtime received events, while each timestamp comes
  from whichever machine sent it — the desktop agent and the browser extension keep their own
  clocks, and one can land an earlier time after a later one. The replay clock followed each
  timestamp wherever it went, backwards included, and a cooldown then measured negative elapsed
  time and blocked a morph that had gone through live: a three-event log with one out-of-order
  timestamp replayed to a different body than the run it was meant to reproduce. Live never had
  this problem, since the server judges guards by its own forward-only clock; replay does the same
  now, taking a timestamp only when it is readable and not older than the one before. 14 tests: the
  same log giving the same world, body and audit trail twice over, a replay matching a live run,
  the gaps preserved, a caller's own clock honoured, an out-of-order log no longer stalling, an
  unreadable timestamp ignored rather than stopping the clock, and sessions in one log kept apart.
  runtime-core 79, 751 unit/integration total.
- **A snapshot is parsed before it is believed, and the score is always a number** (2026-09-04):
  resume hands a stored snapshot straight into the session, and a snapshot was written by whichever
  build was running then. One missing field was enough to break that session for good — a world
  without its `recentEvents` threw inside the significance reflex, which runs on every event, so
  every ingest after the resume failed. `hydrate` parses both halves now, refuses what does not
  survive while keeping what the session had, and reports which halves it took so resume can say
  nothing was restored rather than hand back a fresh body and call it a restoration. Significance
  could also produce a score that was not a number: a novelty window of zero makes the decay 0/0,
  and NaN spreads from there into the trace the inspector shows, the audit and every connected
  client while the deliberation decision quietly ignores it. 32 tests — the score real and within
  nought and one under every configuration a host might pass, interest falling as an event repeats,
  repeats counted per kind, a recovery for something never broken weighed far lower than a real
  one, and hydrate refusing a world missing a field with the session still ingesting afterwards.
  significance-engine 34, runtime-core 65, 737 unit/integration total.
- **The message from a page is rebuilt at the boundary, not forwarded** (2026-09-04): the
  extension's shaping file says a review of it is a review of what can possibly leave the page, and
  that was not quite true — interaction, idle and visibility messages went from the content script
  to the runtime exactly as received. The content script does only count that something happened
  and never reads text, so nothing leaked, but the promise lived in the sender rather than at the
  boundary, and one change to that file would have moved it without anyone noticing. Each message
  is rebuilt from scratch now, keeping only the fields its kind may have: a count, a number of
  seconds, a hostname that looks like one. A field nobody declared is dropped, a kind nobody
  declared is refused. Consent gets the same treatment — it decides what may leave the machine and
  is read from storage that syncs between devices and may hold whatever an older build wrote, so it
  is three booleans and nothing else. 14 tests: page text and a URL smuggled alongside a count
  dropped, a host that is really a path refused, hostnames in every shape a browser reports
  accepted, counts kept whole and within reason, only a real boolean read as being back, and the
  output field-checked against what each kind is allowed to carry.
  extension 43, 720 unit/integration total.
- **The brain of last resort has to be one that answers** (2026-09-04): the router promises that
  something always answers — a missing key, an unreachable host, a provider that does not do this
  kind of work all end at the deterministic brain rather than at a stall. It kept that promise by
  looking for a provider whose id is "mock", which is not the same as one that works: a caller
  passing an unhealthy provider under that id left the router with nothing usable, and with nobody
  healthy it would hand back the impostor. It looks for the real deterministic provider now, so the
  guarantee holds whatever a caller passes. 29 tests — routing (deliberation to the most capable
  healthy provider, reflex work to the cheapest that can do it, local preferred when the request is
  private, an unwell provider skipped for a healthy lesser one, an unknown provider treated as
  middle of the road), what is configured (tiers per provider, and never a key — only whether one
  is there), and the undo stack behind every morph (newest first, looking not taking, the bound
  costing the oldest steps and never the newest, running out reported honestly).
  intelligence 44, morph-engine 66, 706 unit/integration total.
- **A decision is final, a record is a copy, and the store has a ceiling** (2026-09-04): an approval
  is a person's answer to "may I do this?" and the only thing standing in front of an action that
  changes the world outside the runtime. Three things were wrong with how they were kept. A decided
  request could be decided again in either direction — a refusal turned into consent by calling
  approve on it; the server path happens to delete a rejected record, so this was not reachable
  through the API today, but that is a coincidence of the caller, not a property of the store. Only
  a pending request can be decided now. Reads handed out the stored objects themselves, so anyone
  holding a listing could rewrite a permission record in place; `create`, `get` and `list` all
  return copies. And nothing ever removed an approved request, so the store grew for the life of a
  process that runs for weeks while the per-session listing scanned all of it — it holds 500 now,
  forgetting an answered request before an unanswered one, since a pending approval is a question
  nobody has answered yet. 12 tests over that lifecycle, and the existing matrix suite updated: it
  asserted that a later decision overwrites an earlier one, which is the behaviour being removed.
  permission-engine 29, 677 unit/integration total.
- **An identifier that is really a paragraph gets trimmed** (2026-09-04): every payload string that
  becomes part of the belief goes through one helper, and it took whatever it was handed. Our own
  sensors send identifiers — a path, a host, an action key — but the ingest API accepts what any
  client posts, and those values are read back out by capabilities, rendered into context cards and
  written to snapshots; a 400-character string arrived as an identifier and left as one, blowing out
  the card that shows it. Anything past 120 characters is trimmed now, visibly, so what the runtime
  remembers stays the shape it claims to be. 26 tests over the built-in capabilities, whose output
  is bound straight into components: every one declaring a risk the permission engine understands,
  only the two that change the world outside sitting above safe_write, every one answering with no
  world state and with input of the wrong shape entirely — a result or a reason, never an exception
  — and the workspace reader pinned field by field, from the open-problem count naming kinds rather
  than prose to the dash that stands in where there is no history.
  capability-core 41, 665 unit/integration total.
- **The reason we fell back names the failure, not the endpoint** (2026-09-04): when a provider
  fails, the runtime falls back to a decision it computes itself and records why. That reason code
  is read in the inspector, written to the audit trail and broadcast to every connected client —
  and it was the first 40 characters of the provider error, which begin with the URL we were
  calling. A local model on an internal host and port ended up in data every client receives, and
  since the port is in there the code differed on every run, which defeats the point of a code; the
  status, the one useful part, fell past the 40-character cut. Failures are classified now —
  `http_503`, `timeout`, `no_api_key`, `unparseable_output`, or `provider_error` when it cannot be
  told — with the full message keeping its detail for whoever is debugging, and the HTTP layer
  attaching the status to the error so a caller can classify without reading the sentence. 17
  tests: a good answer used as-is, a schema-invalid one refused, every failure still producing a
  decision the schema accepts, the code naming the status while carrying no host, key or response
  body, the same code every time for the same failure, and the deterministic decision itself —
  stable, valid, tied to the event it answered, never asking for more autonomy than reading.
  decision-engine 23, 639 unit/integration total.
- **One posted event could leave a session permanently broken** (2026-09-04): an event's `type` is
  any string a client sends, and the table of things that open a problem was indexed with it
  directly. A single event of type `toString` opened a problem with no kind, no summary and no
  severity — a world state that fails its own schema, sitting in the belief every later decision is
  made against — and nothing could ever close it, since no recovery matches an undefined kind. That
  session would have looked permanently broken: an incident on screen, intent inference reading
  trouble that was not there, and the same state written to a snapshot and restored on resume. Own
  keys only now, on both the opening and the closing table. Checked everywhere else the shape
  appears: the provider tier lookup would have returned a function as a tier, and the extension's
  options page could have put a function's source into the page through `innerHTML`; both fixed.
  **A sweep for the `in` operator over our own source now comes back empty** — the five earlier
  ones are gone and no new ones crept in. 15 tests: each kind of trouble opening exactly one
  problem, closing the matching one and leaving the others, a recovery for something never broken
  doing nothing, open → close → open again, the process marked failed and healthy alongside, and
  the whole hostile family of type strings opening nothing, disturbing nothing, leaving every
  problem closable and the world state valid. world-model 36, 622 unit/integration total.
- **A lookup table is a table, not a prototype chain** (2026-09-04): every string on screen goes
  through `tr()`, `t()` or `fillTemplate()`, and the model chooses many of them — a component's
  text is whatever the blueprint says. All three looked keys up in a plain object without checking
  whose key it was. `tr()` is typed as returning a string and, for text like "toString" or
  "constructor", returned a FUNCTION off the prototype; React refuses to render a function, so a
  component whose text happened to be one of those words took the whole Korean screen down.
  `fillTemplate` had it in the other direction: `{toString}` rendered the source of a native
  function into a sentence someone reads, when the point of that function is that an unfilled slot
  stays visible — a param present but undefined now leaves the slot visible too. This is the same
  mistake as the log level, the component registry and the capability bindings: **`in` walks the
  prototype chain; key checks use `Object.hasOwn`**. 26 tests: the lookups returning an unknown key
  unchanged as a string in both languages, falsy values still printing, text without slots
  untouched; and the developer inspector saying so when there is nothing to show, offering its tabs
  in both languages, rounding significance to whole percent, naming the guard reason when a morph
  was refused, marking a reflex answer, and escaping an event type that looks like markup.
  web unit 49, 607 unit/integration total.
- **A database or a client having a bad day cannot stop the body reshaping** (2026-09-04): two
  things the server does not control could take an ingest down. The durable append was awaited
  bare — the event is already in the in-memory log by then, so a database that is not answering
  threw, aborted the ingest and left the two logs disagreeing: stored in one, never processed, no
  world state, no audit, no morph. Three lines below, snapshot writes are explicitly best-effort
  with the note that a database failure must not abort ingest or diverge clients from the server;
  the event log had the same exposure and the opposite handling, and is best-effort now too, loud
  in the log. And a listener that threw ended the broadcast and failed the ingest that fed it —
  broadcasting happens after the state has changed, so the caller saw an error for work that was
  done and every client behind the failing one never heard. Each listener is on its own now.
  21 tests: reshaping with the durable log down and with snapshots failing, malformed events still
  refused, every listener told when one throws, the message order a client needs, snapshots only
  when something changed, traces and audit per session, and resume bringing back body and world
  while offering no undo that would target a tree from before the restart.
  runtime app 63, 581 unit/integration total.
- **A file save says where the file sits in the watched root, or nothing** (2026-09-04): the agent
  promises a path relative to the directory someone chose, never the absolute location on disk, and
  on Windows that had a hole — `path.relative` between two drives hands back the absolute target,
  so a file on another drive left spelled `D:/somewhere/private.txt` and the ignore check, looking
  only for a leading `..`, waved it through. Anything not plainly relative is refused now: a drive
  letter, a leading slash, a UNC path, or a path that climbed out. Dot directories are ignored too,
  not only dot files: the rule caught `.env` but not `.ssh/id_rsa`, `.aws/credentials` or
  `.vscode/settings.json`, and the path alone says what someone was editing. 17 tests over the file
  that decides what a save may say about a person — relative paths in, absolute and escaping paths
  refused, build output and editor scratch skipped while ordinary source passes, the branch name
  read out of HEAD with everything else yielding nothing, and the sent event carrying seven fields
  and no eighth. agent 36, 560 unit/integration total.
- **A failed ingest says whose fault it was, and nothing more** (2026-09-04): the ingest route
  caught everything and answered 400 with the error's own message. Right for a malformed event —
  the caller can fix that — and wrong twice for anything else: a storage outage is not a bad
  request, and its message carries hostnames, ports and query text, which is what the central
  error handler exists to keep in. Validation detail still returns with a 400; everything else is
  a 500 that says nothing. The default 404 body echoed the requested path and named the framework,
  so that is a plain `not found` now. 21 tests over the surface between the runtime and any page in
  the browser: reads guarded as tightly as writes (the world state lists every host you visited),
  a WebSocket upgrade refused from an unknown page where CORS would never have stopped it,
  near-miss origins refused (another port, another scheme, a suffixed hostname, a trailing slash),
  the token required everywhere but the health probe and accepted in the query only for the socket
  where a browser cannot set headers, and origin checked before the token so a page that should
  not be talking to us learns nothing about either. runtime app 42, 543 unit/integration total.
- **Bindings read a capability's own fields; the registry answers for its own types** (2026-09-04):
  a data binding is written by the model — it names the capability field to read and the prop to
  write — and both halves were trusted. `capability:c:toString` handed back a function off the
  prototype and put it in props where the renderer expected data; only own fields count now, and a
  capability that answered with something other than a record binds nothing. A prop named
  `__proto__`, `constructor` or `prototype` is refused outright: it survives a spread unchanged but
  sets an object's prototype under assign, and none of them is a prop a component wants. The
  registry had the same shape of hole — `isKnownComponent` used `in`, so "toString" answered yes
  and `isContainer` then returned undefined where it promises a boolean. 45 tests: every session
  read answering for an unknown id without keeping it (the cheapest GET must not evict live
  sessions), the LRU sparing what is still in use, hydrate dropping an undo history that described
  a different tree, a snapshot never lowering what this run learned, concurrent ingests taking
  turns, and planMorph knowing when to do nothing — one context card at a time, a layout per
  problem kind, the recurrence count. runtime-core 63, ui-registry 25, 522 unit/integration total.
- **The pattern table stays bounded, and hands out copies** (2026-09-04): the pattern detector
  capped itself at 500 when restoring a snapshot but not while observing. A pattern key is built
  from the event type, and an event type is whatever a sensor sends, so a long-lived session grew
  that table without limit — 2,000 distinct keys in a probe, every one kept. It now holds the same
  500 either way and forgets the pattern seen longest ago, so one that keeps happening survives a
  flood of one-offs. `observe()` also returned the stored candidate itself, so setting `suggested`
  on it meant the person would never be offered that template; every read returns a copy now. And
  `recent(0)` returned the whole history instead of nothing, since `slice(-0)` is `slice(0)`.
  25 tests across the four stores: bounds and eviction, the threshold and the one-time suggestion,
  sticky `suggested` in both directions across a restore, weights that stop at zero when a redo
  hands a dismissal back, max-wins on restore so a snapshot never lowers what this session learned,
  and garbage in a snapshot ignored rather than trusted. memory 32, 477 unit/integration total.
- **An id the tree already uses is refused, and undo comes back exactly** (2026-09-03): an
  `add` reusing a live id went straight through. The tree then held two nodes answering to one
  id — forbidden by the blueprint schema for a reason, since every lookup in the morph engine
  takes the first match — and the result no longer passed the gate in front of the renderer.
  The inverse was worse: it removes by id, so undo deleted whichever copy came first, which
  for an appended duplicate is the original. A probe showed the person's real card and its
  child gone and the newcomer left in place. `applyPatch` now refuses an add or a replace that
  introduces an id the tree already holds (reusing ids from the subtree a replace is replacing
  is still fine — they leave with it), and because a patch can pass the guard and still be
  impossible against the tree it is aimed at — most plausibly after a resume, where `hydrate`
  takes a blueprint another build wrote — ingest catches it, records `morph_blocked` with a
  `structurally_impossible` reason code, and leaves the session untouched. Separately, a remove
  or move-out used to leave `children: []` behind, so undo returned a tree that rendered the
  same but no longer equalled the one it started from; emptied arrays are dropped now, while an
  array that arrived empty is left alone. 56 tests: every operation applied and undone with the
  result checked against the renderer's gate both ways, the message for every missing target,
  cycle and root protections, prop ops restoring the whole node, the parse gate's refusals and
  their paths, and the runtime still answering after a refusal with nothing half-applied.
  morph-engine 57, ui-protocol 24, runtime-core 38, 452 unit/integration total.
- **Three faults in the smallest packages** (2026-09-03): probing storage and logging with the
  inputs an operator and a consumer really supply found two faults and a near-miss. The log
  level arrives as `DM_LOG_LEVEL`, a string nobody checked and cast straight to the level type,
  so a typo, an empty value or plain `DEBUG` in capitals left every rank comparison undefined —
  false — and a run asking for quiet printed every debug line for every ingested event. It is
  now read case-insensitively with spaces trimmed, own keys only (`in` walks the prototype
  chain, so `toString` and `__proto__` would have passed as levels). And a subscriber that threw
  ended the event fan-out and failed the append, after the event was already in the log: ingest
  reported failure for something it had recorded, and every handler behind the failing one never
  saw the event. Each handler is now isolated, with an optional callback that hears about one
  that threw, so event-core keeps no logging dependency. 48 tests across the three: level
  normalising and the four floors, the trace ring's bounds and session filter, the event log's
  order and eviction across interleaved sessions, source and severity validation, subscriber
  isolation, and the save-order contract resume depends on when it walks a session's snapshots
  backwards for the newest of each kind. observability 17, event-core 21, persistence 17,
  396 unit/integration total.
- **Three more gaps at the schema door** (2026-09-03): probing the contracts with malformed input
  showed three things being accepted that should not be. A timestamp `Date.parse` cannot read
  ("yesterday", an epoch string) passed, and since replay derives its clock from these, an
  unreadable one made every guard comparison false — the cooldowns silently disappeared for that
  session. An empty `reasonSummary` passed on both the decision and its UI plan, which is the text
  the body shows as "why the interface changed". And a blueprint claiming another schema version
  passed `parseBlueprint`, the gate in front of the renderer. All three are now refused. 24 tests
  written from the outside in cover those plus event identity, every patch operation, component
  types checked down the whole tree, and decisions unable to widen their own permissions.
  contracts 30, 348 unit/integration total.
- **Third real bug: a destructive MCP tool could pass as a read** (2026-09-03). The risk heuristic
  matched substrings with a case-insensitive class, so `listen` and `getter` counted as reads and —
  the dangerous one — `fetch_and_delete_logs` counted as a read, which at adaptive autonomy means it
  runs by itself. Tool names are now split into words (delimiters and camelCase humps): a mutating
  word anywhere keeps a read verb from making the tool auto-runnable, an unmistakably destructive
  word makes it destructive (which never auto-runs at any level) and is not overturned by a server's
  read-only hint, while a caller's own override still wins. 18 tests, mcp-adapter 22,
  331 unit/integration total.
- **Extension edges, and IPv6 loopback** (2026-09-03): probing the shaping helpers with the inputs
  a browser really hands over turned up a second small defect — `isSelfHost` knew only two spellings
  of this machine, so `::1` and `[::1]` read as a foreign host. It now covers the whole loopback
  family. 19 tests pin the rest of the privacy boundary: credentials, port, path, query and hash
  dropped from a URL; our own pages, `chrome://`, `file://`, `data:` and `ws://` never sensed;
  a warning only on 5xx or a transport error; cancelled and blocked requests silent while a real
  connection problem is not; consent mapped to exactly the layers it enables; and the shaper's
  per-host cooldown, recovery, sampling, pruning and four-kind vocabulary. extension 29,
  313 unit/integration total.
- **Real bug: an app log read as a test failure** (2026-09-03). Piping a run through the agent also
  pipes the application's own logging, and lines like "GET /users/42 failed with 500" or "3 failed
  login attempts" were classified as test failures — an integration test that logs a 500 opened a
  phantom incident. The bare "<n> failed / failing / passed" forms now have to begin the line, which
  is what every runner's summary does and a log line never does. 8 regression tests cover prose, log
  lines, stack frames and code staying silent while vitest, jest, mocha and playwright summaries
  still classify; verified live (two noisy lines produced no events, only the real transitions).
  agent 19, 294 unit/integration total.
- **Intent priority ladder** (2026-09-03): only one label can win, so the order is now fixed by
  test — with every condition true at once, returning beats idle beats stuck beats debugging beats
  switching beats exploring beats focused. Someone who just came back gets a re-entry summary
  instead of a stuck card. Each threshold is asserted at its exact boundary and one step below,
  every threshold is retunable, switching stays alternation rather than breadth, reason codes carry
  the number behind the label, and a transition is reported only when the label changes.
  19 tests, intent-engine 28, 286 unit/integration total.
- **Capability failure paths** (2026-09-03): the AI's hands run unattended, so misbehaviour is now
  pinned — a thrown error, a rejected promise, a non-Error throw and a missing capability all become
  an audited `ok:false` run with its own id; a plan keeps going in order past a failed step; inputs
  pass through untouched; built-ins answer with no world state instead of throwing, memory stays per
  store instance, and every built-in declares a risk so nothing slips past the permission engine.
  10 tests, capability-core 15, 267 unit/integration total.
- **Significance scoring pinned** (2026-09-03): the reflex in front of every deliberation is now
  fixed by arithmetic, not by feel — the weighted sum verified term by term and clamped to 0..1,
  novelty decaying 1 → 0.75 → 0.5 → 0.25 → 0, an inclusive threshold, critical events and problem
  openings always deliberating however repetitive, a closer counting only while a problem is open,
  and each behaviour or traffic signal forcing deliberation on its own while being ignored one step
  below its threshold. The two specs that launch their own Chromium are marked slow: alone they take
  4 s, but inside the suite the extension-loading launch has crossed 60 s on Windows, which is what
  the recurring flake was. 14 tests, significance-engine 19, 257 unit/integration total.
- **World-model bounds** (2026-09-03): the state a never-ending sensor stream feeds is now pinned
  at its limits — 50 events, 8 recent entities and keys (re-opening moves an entry instead of
  duplicating it), 50 touched files, 5 failing hosts newest-first while the counter still sees all,
  16 layers per sensor. Unknown event types pass through touching only the timestamp and the log,
  wrong-shaped payloads change nothing, reduce never mutates its input and replays identically, and
  one network problem covers many failing hosts until the last recovers. 11 tests, world-model 21,
  243 unit/integration total.
- **Autonomy matrix pinned** (2026-09-03): all twenty cells (four risk levels × L0-L4) are asserted
  against the documented policy, plus the invariants behind it — a destructive capability never
  auto-runs at any level, below adaptive level nothing even reaches approval, and raising the level
  never removes a permission. `evaluatePlan` accounts for every item with a readable reason, and the
  approval store keeps a request through its decision and lets a rejected one be re-offered.
  12 tests, permission-engine 17, 232 unit/integration total.
- **Guard edge cases** (2026-09-03): the rules that keep the body calm are now pinned at their
  boundaries — a whole-patch rejection below the plain confidence minimum, a PARTIAL patch between
  the two thresholds (structural ops drop, cosmetic ones apply), the cooldown boundary to the
  millisecond, dwell for major transformations only, and a critical event bypassing confidence,
  cooldown and dwell while still never touching unsaved work (all five clobbering op kinds refused
  from any ancestor). Focus protection holds only while typing and only along the focused path.
  11 tests, morph-engine 25, 220 unit/integration total.
- **Runtime client unit tests** (2026-09-03): connected mode's wire contract is now pinned without
  a browser — one endpoint per action with the expected method and body, undo carrying its
  attribution, redo reporting what the server actually did, malformed responses never throwing,
  token mode (header on REST, encoded query on the socket), and the socket lifecycle: frames
  forwarded, malformed frames ignored, backoff 1/2/4/8/10 s capped and abandoned after five tries,
  disconnect cancelling a pending reconnect. 9 tests, 209 unit/integration total.
- **Renderer unit tests** (2026-09-03): the renderer had only indirect (E2E) coverage. 9 tests now
  render real blueprints and patches to static markup: the development workspace keeps its unsaved
  editor, all five incident kinds and the three behaviour cards render, wrong-typed props on eight
  components never throw and never produce NaN, an unknown component type degrades to a labelled
  container with its children, 60-level nesting renders, every content string goes through `tr()`,
  and bound templates fill through `tpl()` with a text fallback. 200 unit/integration tests.
- **Postgres path verified locally too** (2026-08-31): with a real `postgres:16` container
  (`dm-pg-test`, :5433) and `DATABASE_URL` set, `@particle/persistence` runs its pg integration test
  (4 passed, 0 skipped — events + snapshots persisted and read back) and `@particle/runtime` passes
  all 21 tests on the durable path. CI already does this on every push; now confirmed on Windows.
- **Audit facts (round 3)**: `pnpm test:e2e` through turbo runs the real Playwright suite (15 passed,
  1 SHOTS-gated skip); `.env.example` defaults match the code (`DM_PORT` 8787, `DM_HOST` 127.0.0.1,
  `DM_ALLOWED_ORIGINS` the two body origins); QUICKSTART step 3 matches the built `dist/`
  (manifest, icons, side panel, options). No further discrepancies found.
- **Audit facts (turbo paths)** (2026-08-31): `pnpm test` through turbo = 21 tasks, 191 tests
  passed (identical to `pnpm -r`); `pnpm build` through turbo produces a fresh web `.next` and the
  extension `dist`, and the E2E suite passes on that build. Docs fix: the README extension section
  said `pnpm runtime && pnpm web` — the first command never exits, so the second never ran; now
  `pnpm dev` (or two terminals).
- **Usability bug found by the audit: `pnpm dev` dropped every env var** (2026-08-31). Turbo 2's
  strict env mode strips undeclared variables, so `DM_PORT`, `DATABASE_URL`, `ANTHROPIC_API_KEY`,
  the ingest token and `NEXT_PUBLIC_*` never reached the apps when started through the root
  `pnpm dev`/`pnpm test`/`pnpm build` (the direct `pnpm web`/`pnpm runtime` paths bypass turbo,
  which is why nothing showed earlier). Fixed with `globalPassThroughEnv` (`DM_*`, `DATABASE_URL`,
  provider keys, `NEXT_PUBLIC_*`, `PORT`, `SHOTS`, `CI`) + `NEXT_PUBLIC_*` as build `env`; the web
  scripts no longer hard-code `-p 3000` so `PORT` works. Verified live: `DM_PORT=8790 PORT=3010
  pnpm dev` answers on both ports in 4 s. CI was never affected (it runs `pnpm -r`, not turbo).
- **Real-provider path, end to end, without keys** (2026-08-31): `decision-engine` now routes to
  the actual `AnthropicProvider` against a fake Messages API: a schema-valid model decision is used
  as-is; a schema-INVALID one (bad intent / autonomy), an HTTP 503, and a prose answer with no JSON
  all fall back to the deterministic decision with a reason code — the "invalid model output can
  never corrupt the runtime" guarantee proven on the real adapter, not a stub. Usability audit
  facts: all 15 documented env vars are read by code (no dead variables); root scripts
  (`pnpm web/runtime/agent/test:e2e`) resolve; `pnpm agent` runs from the repo root.
- **Provider HTTP contracts proven without keys** (2026-08-31): a fake Messages / chat-completions
  server records what the Anthropic and OpenAI-compatible adapters send and answers like the
  real services. Verified on every push: wire shape, `x-api-key`/`anthropic-version` and Bearer
  headers, `json_object` mode, fenced-JSON extraction with prose ignored, usage mapping, and the
  failure paths that feed the deterministic fallback — HTTP 500, no JSON in a structured answer,
  latency-target timeout — plus the local-model path (no key, no Authorization, still healthy).
  The live Anthropic test still runs when a key is present. FACT CHECK: the Postgres persistence
  path is exercised by CI on every push (Postgres service + `DATABASE_URL`), not "pending".
  intelligence 23 tests.
- **Multi-session view v1** (2026-08-31): the connected body lists what THIS computer senses —
  every session on the runtime (web / side panel / desktop) with its intent, open problems and
  reported layers ("Sensed on this computer", en/ko, 8 s poll). `listSessions` is peek-based
  (never creates sessions — tested); other sessions link to their own body (`?session=`).
  The GitHub repo description is now Korean-first bilingual. runtime-core 34, runtime 21.
- **Fifth review (core sound; 8 edge fixes)** (2026-08-31): the review traced the undo/redo
  learning ledger and stack pairing as CORRECT, and found the edges: dismissals are now
  refundable (undoing a dismissal hands the lesson back, redoing re-teaches — mind-changing
  loops never accumulate toward suppression); undo/redo/canRedo never create sessions (the new
  endpoint inherited the eviction hole); redo drains stale entries in one truthful call; the
  junk-key meta fallback is gone; connected emitSim tolerates a behavior-key blip without
  dropping the sim and its final catch tells the truth; connected redo reports
  redone/no-op/unreachable; the history strip pairs with the real stack (a targeted dismissal
  GROWS it) and redo chips keep their real intent; web restore imports `dismissed:*` preferences
  only (morph:* counters would compound each reload); reversals leave `morph_undone`/`morph_redone`
  audit records and persist memory before UI; `pattern_suggestions` now travel over WS so a
  headless emitter's threshold crossing is seen before being marked suggested. Store blockers:
  runtime URL configurable (options), `docs/PRIVACY.md`, host-permission decision documented.
  runtime-core 33, runtime 20; 15 E2E green.
- **Redo** (2026-08-31): reversibility goes both ways. `RuntimeCore.redo` re-applies the most
  recently undone morph (stale entries dropped quietly); any NEW morph or dismissal invalidates
  the redo stack; a dismissal the undo taught is handed back on redo (weights clamp at zero).
  Wired over REST (`/api/morph/:id/redo`) with UI/memory snapshots, a Redo button (en/ko), and
  `incident.spec` round-trips undo→redo→undo in the browser. runtime-core 31, runtime 19.
- **Suggestions offered once, ever — web too** (2026-08-31): the web persists memory whenever a
  suggestion surfaces, and its restore imports the patterns as suggested MARKS only (count 1 —
  the log replay re-observes the real counts, the sticky flag prevents any re-offer).
  `pattern.spec` reloads and repeats the flow: the banner stays gone. Server restarts were already
  covered (runtime 18). runtime-core 30, memory 7.
- **Connected behavioral parity** (2026-08-31): sim clicks now carry their behavior key to the
  SERVER too (`RuntimeClient.emit`), so a server session reads repeats as "stuck", learns from
  dismissals (undo attribution over REST) and notifies the withheld morph — `connected-learn.spec`
  proves the full loop against a fresh server session per run. The presence popover lesson is
  E2E-verified as well (learn.spec).
- **Reconcile ticks out of the novelty window** (2026-08-31): `runtime.reconcile` no longer enters
  `recentEvents`, so repeated REAL events keep their anti-thrash repetitive-event decay; reduce is
  pure either way (replay determinism proven by the existing suite). world-model 10 tests.
- **Held banner countdown + browser proof** (2026-08-31): the "morph held" banner now says when
  the body will catch up (`retryAfterMs` exposed on REST responses, en/ko), and `held.spec`
  asserts the whole story in a real browser: hold explained → countdown shown → the reconcile
  tick re-surfaces the still-open Build failure on its own. Extension store icons generated
  (manifest `icons` + `action.default_icon`, dist-validated); Playwright `retries: 1` absorbs
  live-extension environment flakes (isolated failures always pass); agent warns once at startup
  when the runtime is unreachable. Fourth review (docs vs implementation): all claims verified,
  spec-count wording unified (14 tests / 13 specs).
- **Ordered sends** (2026-08-31): the same smoke exposed that agent/extension sends were parallel
  fetches — a recovery could overtake the failure it recovered from (observed: failed, failed,
  succeeded). Both sensors now serialize sends (one in-flight request); verified 3/3 back-to-back
  runs arrive in observed order.

## Autonomous-loop additions (2026-08-29 ~)
- **AI presence inspector (spec §23)**: clicking the presence chip opens a popover — current
  state, what it observes, autonomy level, why the UI last changed, capabilities awaiting
  approval. E2E-covered.
- **Pattern suggestion banner (spec §20)**: when a flow repeats to the threshold, a
  dismissible banner suggests a reusable workspace template (suggest-only).
- **Recurring incidents**: per-session episodic memory marks a repeated incident with a
  `recurring ×N` badge — experience visibly shapes the morph.
- **Security scenario (4th incident kind)**: `security.vulnerability_detected/patched`
  full-stack — CVE table layout, `security.scan_dependencies` (read, auto) +
  `security.update_dependency` (external effect, approval-gated).
- **i18n**: EN/KO toggle in the header; chrome + blueprint content translated; audit test
  (`i18n.test.ts`) guards against untranslated strings/raw keys.
- **UX**: first-run coach mark; language/theme persisted (localStorage); morph-in animation
  with staggered cells; Escape closes popover/coach; global focus-visible ring.
- **One-pager**: `/pitch.html` (also published as a Claude artifact) with a self-playing
  before→incident→recover demo and how-to-explain copy.
- **Data bindings (spec §5)**: `resolvePatchBindings` feeds capability outputs into the
  morphed body — incident logs and the CVE table are live, not hardcoded.
- **Replay & verify (spec §21)**: Developer mode button replays the session's event log
  through a fresh core and reports whether the UI is reproduced exactly.
- **Browser event sourcing**: the event log is persisted (localStorage) and replayed on load,
  so the morphed workspace survives a refresh; `Reset session` clears it.
- **Morph history strip**: every applied morph is a clickable step; clicking undoes back to
  before it (multi-step undo) — reversibility made visible.
- **Held-morph explanations**: when the guard holds a change (cooldown, dwell, focus/unsaved
  protection, low confidence) the body says why in plain language (EN/KO).
- **Accessibility audit (axe-core)**: E2E fails on serious/critical WCAG A/AA violations across
  initial, incident and developer-mode states; fixed accessible names, focusable scroll
  regions, and light-theme contrast (warn/ok badges, primary hover).
- **CI runs the full Playwright suite** (7 specs); connected mode self-skips without a server.
- **Connected-mode parity**: server responses carry patternSuggestions; held reasons and
  pattern banners render in server mode too.

## Completion sprint (all committed)
- **@particle/memory** (§20): working/episodic/preference stores + `PatternDetector` that
  suggests reusable-template candidates (suggest-only). Fed by `RuntimeCore` on each morph;
  `IngestResult.patternSuggestions`.
- **Approval flow end-to-end** (§18, criterion J): `development.revert_diff` (external_effect)
  is planned, gated to `needs_approval` at level 2, surfaced as an `ApprovalRequest`, shown in
  the web "Approval required" UI, and **executed on approve** (`RuntimeCore.approve`, server
  `/api/approvals/:id/approve`). Verified in unit + server + E2E.
- **Snapshot persistence**: world + ui snapshots saved to `SnapshotStore` on morph
  (`/api/sessions/:id/snapshots`); live-verified against Postgres.
- **Material 3 redesign**: purple (#6750A4) token system, light + dark; served on :4000.
- **CI**: GitHub Actions (typecheck + tests w/ Postgres service + web build + Playwright E2E).
  LICENSE (MIT), CONTRIBUTING, README badges + Korean README.

## Post-MVP additions (name: **Particle AI**)
- Rebranded the product to **Particle AI** (repo `particle-AI`); internal namespace stays `@particle/*`.
- **Developer Inspector** (spec §31): toggleable in-UI panel — event trace, world state,
  structured decision, and audit trail.
- **Connected mode**: the web app can drive the runtime **server** over WebSocket
  (`RuntimeClient`), morphing the UI from `ui_patch` frames. Verified end to end in a real
  browser (`e2e/connected.spec.ts`) and via a WS protocol probe. Local (client-loop) mode
  remains the default so the demo is self-contained.

## Phase 0 — Architecture — ✅ in progress → done when skeleton installs
- Implemented: monorepo skeleton, root config (pnpm/turbo/tsconfig), CLAUDE.md, README,
  core docs (VISION, ARCHITECTURE, RUNTIME_LOOP, UI_PROTOCOL, MORPH_ENGINE), ADRs 0001–0003,
  `.env.example`, docker-compose.
- Remaining: fill remaining docs as their phases land.
- Known limitations: docs describe the target; later phases implement them.
- Next: Phase 1 — UI Matter.

## Phase 1 — UI Matter — ✅ done
- Implemented:
  - `@particle/ui-protocol`: blueprint/patch validation + tree helpers (find, collect, unique-ids).
  - `@particle/morph-engine`: pure `applyPatch` with inverse generation, `MorphGuard`
    (confidence gates, cooldown, major-dwell, focus protection, unsaved-state protection,
    critical bypass), `computeDiff`, and `MorphHistory` (undo).
  - `apps/web` (Next.js 15 / React 19): schema-driven `Render`er over the approved registry,
    a Simulation Lab, AI presence indicator, Inspector ("why did the UI change?"), Undo,
    and dark/light theming.
  - Phase-1 deterministic `decide()` (no LLM) wiring event → decision → guard → morph.
- Tested: 27 unit + integration tests pass; web builds and prerenders; headless loop test
  proves incident→recover→undo with the editor never destroyed.
- Known limitations: `decide()` is a stand-in for the Phase 3/4 significance + decision
  engines; events are UI-simulated (no event store / WebSocket yet); morph timing uses the
  wall clock in the app shell (pure engine stays clock-free).
- Next: Phase 2 — Perception (event contract already in `contracts`; add event store,
  world model, simulator source, WebSocket in `apps/runtime`).

## Phase 2 — Perception — ✅ done
- Implemented:
  - `@particle/contracts`: `WorldState`, `Problem`, `Goal`, `ProcessState`, `IntentHypothesis`,
    `AutonomyState` + `emptyWorldState`.
  - `@particle/event-core`: append-only `EventStore` (validates, session-indexed, subscribable).
  - `@particle/world-model`: pure `reduce(prev, event)` — opens/closes problems, tracks process
    health, files, goal, and attention.
  - `apps/runtime` (Fastify 5 + `@fastify/websocket`): `SessionRuntime`, REST
    (`/api/events`, `/api/sessions/:id/{state,events,ui}`, `/api/sim/:id/:key`), and
    `/ws/sessions/:id` broadcasting `world_state_changed` / `ui_patch`.
- Tested: event-core (2), world-model (5), runtime REST/sim (6). Live smoke: HTTP 500 →
  runtime_error problem + API failed; recovery clears it. Typecheck clean across 8 projects.
- Known limitations: store is in-memory (Postgres in Phase 8); runtime does not yet run the
  significance/decision/morph loop (Phases 3–4, 7); WS verified via unit + design, not E2E.
- Next: Phase 3 — Reflex (significance engine + transitions + guard already in morph-engine).

## Phase 3 — Reflex — ✅ done
- Implemented: `@particle/significance-engine` — pure `evaluateSignificance(event, world, config)`
  (severity + relevance + novelty + problem-transition under configurable weights, anti-thrash
  novelty decay), `suggestMode`, `nextPresence`. `SignificanceResult` added to contracts.
  MorphGuard + focus/unsaved protection already shipped in `@particle/morph-engine` (Phase 1).
- Tested: 5 tests (critical deliberation, reflex-only repetition, recovery-only-when-open,
  configurable threshold, mode switch). Typecheck clean.
- Next: Phase 4 — Deep Brain (provider abstraction, mock+real adapters, decision engine, router).

## Phase 4 — Deep Brain — ✅ done
- Implemented:
  - Contracts: `RuntimeDecision` (structured, never prose), `UIMorphPlan` (intent, not a
    patch — keeps intelligence UI-free), `CapabilityPlan`, `AutonomyRequirement`, and the
    `Intelligence*` types (`IntelligenceProvider` request/result, `ModelRouteDecision`).
  - `@particle/intelligence`: `IntelligenceProvider` interface; `MockProvider` (deterministic
    brain, no key needed); real fetch adapters `AnthropicProvider`, `OpenAIProvider`,
    `LocalModelProvider` (OpenAI-compatible); `IntelligenceRouter` (cheap→reflex,
    capable→deliberation, local→privacy, always-mock fallback); `buildDefaultProviders`.
  - `@particle/decision-engine`: routes → provider.evaluate → **validates** output; any invalid
    model output is discarded for the deterministic decision (a bad model can't corrupt state).
- Tested: 11 tests (deterministic decision, mock structured output, router selection across
  tiers/privacy/health, fallback-to-deterministic on junk output). Typecheck clean.
- Known limitations: real providers are exercised against a fake API server on every push (adapters.contract.test.ts); the live Anthropic test additionally runs when a key is present; prompts are minimal.
- Next: Phase 5 — Capability Matter (registry, execution, permissions, audit).

## Phase 5 — Capability Matter — ✅ done
- Implemented:
  - Contracts: `CapabilityManifest`, `CapabilityResult`, `CapabilityRun`, `ApprovalRequest`,
    `AuditRecord`.
  - `@particle/permission-engine`: autonomy rules (`canAutoRun`/`classify`), pure `evaluatePlan`
    (authorized / needs-approval / denied), `ApprovalStore`, `AuditLog`.
  - `@particle/capability-core`: `Capability` interface, `CapabilityRegistry`, `CapabilityExecutor`
    (auditable runs), and 9 built-in capabilities (read-only + `memory.store` safe_write to
    exercise gating). External-effect/destructive deliberately omitted until the flow is wired.
- Tested: 10 tests (autonomy gating by risk×level, plan split, approvals, audit, execution,
  memory store/search, multi-capability plan). Typecheck clean.
- Next: Phase 6 — MCP adapter (normalise MCP tools into capabilities).

## Phase 6 — MCP — ✅ done
- Implemented: `@particle/mcp-adapter` — `McpClient` interface (transport-agnostic),
  `inferRisk` (annotations → override → name heuristic → external default),
  `mcpToolToCapability` (namespaced `mcp.<server>.<tool>`), `discoverMcpCapabilities`.
  MCP tools become ordinary capabilities; MCP specifics stay out of the core.
- Tested: 4 tests (risk inference, tool→capability call, registry+executor integration).
- Next: Phase 7 — wire the full loop end to end.

## Phase 7 — Integrated demo — ✅ done
- Implemented: `@particle/ui-registry.planMorph` (intent→patch, idempotent); `@particle/runtime-core`
  `RuntimeCore` — the canonical loop (perception→significance→decision→permission→capability
  →morphology→guard→apply→audit) + `createRuntimeCore` factory. The web app now drives the
  real loop; the runtime server composes the same core over REST/WebSocket
  (`ui_patch`/`world_state_changed`/`decision_created`), with `/api/morph/:id/undo` and
  `/api/approvals/*`.
- Fix: significance is judged against the pre-reduce world; de-escalations bypass cooldown+dwell.
- Tested: runtime-core loop, web integration, and the runtime server all exercise
  incident→capabilities→morph→recovery→undo.
- Next: Phase 8 hardening.

## Phase 8 — Reliability — ✅ done
- Implemented:
  - `@particle/runtime-core.replay` — deterministic event-sourced replay (reconstructs identical
    UI/world from the log).
  - `@particle/observability` — structured logger + `TraceStore` (developer inspector rows).
  - `@particle/persistence` — `EventLogStore`/`SnapshotStore` seams + in-memory impls (Postgres/
    Drizzle deferred behind the same interfaces).
  - Playwright E2E (`apps/web/e2e`) — incident→morph→recover→undo + no-morph on unrelated event.
  - Remaining docs: PRODUCT_SPEC, MVP (acceptance table A–O), CAPABILITY_PROTOCOL,
    AUTONOMY_AND_SECURITY, DATA_MODEL, TEST_STRATEGY, INTELLIGENCE_ROUTER.
  - Project subagents in `.claude/agents` (architecture/security/test/ui-morphology/runtime).
- Tested: 77 unit/integration tests + Playwright E2E, all green. Typecheck clean.
- Known limitations: durable Postgres backing is deferred (in-memory + deterministic replay
  satisfy the "persisted & replayable" bar); real LLM providers' HTTP contracts are
  tested against a fake server on every push (live test additionally when a key is present); the web app runs the loop client-side (the server offers the same loop too).
