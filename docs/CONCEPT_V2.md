# Particle AI — Concept v2: a behavior layer, not an app

> Decision record for the pivot agreed on 2026-08-30. Supersedes the "incident workspace"
> framing of V1 as the *product idea*; V1's runtime stays as the engine.

## The problem with V1 (why it felt vague)

V1 reacted to **system events** (HTTP 500, build failure). Those arrive *after* something
broke, so the runtime was really an *incident responder*: `if (error) show panel`. It never
understood the **person** — only the outcome. Errors are a weak, late proxy for behavior.

## The thesis (one sentence)

> Particle AI is a **layer that sits over the UI and the computer**, observes *all* of a
> person's behavior — on screen and in the communication that leaves the screen — continuously
> infers what they are trying to do, and reshapes the interface around that intent, **before
> and without** anything breaking.

## Consistency table (input → understanding → output)

> Scope, added 2026-10-17 and extended 2026-10-19: the five layers below are the ones that send
> shape and nothing of the content, and that is still true of them. Two further layers were
> added later and are not covered by the "never content" in this table. `screen` reads what is
> in a window a person listed; `page` reads the names on the page they are on — its title, a few
> headings, the labels of its boxes, the names of its buttons, never a value anybody typed and
> never a box that could hold a password or a card. Both are off unless somebody turns them on.
> `DESIGN_V2.md` is the decision; `CONSENT_V2.md` is the wording.

| Layer | What is sensed (shape only, never content) | What it tells us | How the body responds |
|---|---|---|---|
| **L0 Interaction** | clicks, scroll, hover dwell, typing rhythm, idle, undo/redo, repeated actions | attention, hesitation, frustration, flow | emphasize/de-emphasize, hold morphs while typing |
| **L1 Application** | which view/file/tab, saves, mode switches, approvals | current task, task switching | assemble the workspace for the task |
| **L2 Communication** | outbound fetch/XHR/WebSocket: host, status, latency, frequency, retries (no URL query/body) | dependencies, slowdown *before* failure, stuckness (retry loops) | pre-surface diagnostics; degrade gracefully |
| **L3 Browser** | tab focus/visibility, navigation between sites, time away | context loss, re-entry, multitasking | "welcome back" summary; carry context across sites |
| **L4 Desktop / OS** *(opt-in)* | active window/app, file changes, git activity, terminal/test output | real work progress, environment state | connect what happens off-screen to the screen |

Errors (HTTP 500, build failed) become **one signal inside L2/L4** — interpreted through the
current intent, not the trigger of everything.

## Intent is a continuous state, not a reaction

The world model gains a persistent `inferredIntent` that is always present (even with no
errors): `exploring · focused · stuck · switching · idle · returning · debugging`.
It is derived deterministically first (rules over behavior features: dwell, switch rate,
retry count, undo count, idle time, error signals), with a model provider as an optional
upgrade — exactly like the existing two-speed brain.

Significance shifts from "did a problem open?" to "did intent change, or is the current intent
under-served by the current body?"

## The body becomes an overlay

The structured UI protocol (blueprint/patch/guard/undo) is unchanged. Where it renders changes:

- **Browser**: an extension **side panel / overlay** that morphs on *any* site.
- **Desktop**: the same panel fed by the local agent.
- The current web app remains the **reference body + developer inspector**.

## Existing features → re-homed, not discarded

| V1 feature | V2 role |
|---|---|
| Incident layouts (runtime/build/test/security) | responses when intent = `stuck`/`debugging` **and** L2/L4 error signals are present |
| Morph guard, undo, history strip, held explanations | unchanged — stability & reversibility of the body |
| Capabilities + approvals + autonomy levels | unchanged — also gate **sensing depth** (see privacy) |
| Memory (episodic/preference/patterns), recurring badge | now fed by behavior: undo/ignore → preference; repeated intent→body pairs → patterns |
| Replay, persistence, connected mode | unchanged; extension/agent stream into the same runtime |
| Simulation Lab | kept as a **test harness**, no longer the product story |

## Privacy is a design constraint, not a setting

Sensing "everything" is only acceptable if:

1. **Shape, never content, in every layer but two** — hosts/status/latency/counts/dwell, never
   URL queries, bodies or keystroke text. The exceptions are the layers added in `DESIGN_V2.md`:
   `screen` photographs a window somebody listed and therefore reads what is in it, and `page`
   reads the names on the page somebody is on. Both are off by default, named separately
   wherever sensing is shown, and their consent wording is in `CONSENT_V2.md`. Neither sends a
   value anybody typed, and `page` describes no box that could hold a password or a card.
2. **Local-first** — events are processed by the local runtime; nothing leaves the machine
   unless the user enables a remote provider.
3. **Layer consent** — L0–L2 (own app + own traffic shape) on by default; L3 and L4 require an
   explicit switch each; `screen` requires a switch of its own **and** a list of which apps may
   be photographed, with no choice that takes the whole screen; `page` requires a switch of its
   own in the extension's options page. The UI always shows *"currently sensing: …"*, for
   `screen` it names the app being photographed, and for either of the two it names which of
   them is the exception to "shape only".
4. **Autonomy levels apply to sensing depth**, not only to actions.

## Phases (each independently valuable)

Status (2026-08-31): P1 ✅ · P2 ✅ (extension + `network_failure` layout) · P3 ✅ (agent: files + piped output) · P4 ✅ (dismissal learning AND pattern→template memory persisted across reloads/restarts; suggestions are offered once, ever). Details in `STATUS.md`.

- **P1 Intent engine + in-app behavior sensing** — prove behavior→intent→morph with **no
  errors involved** inside the current web body (cheapest proof of the thesis).
- **P2 Browser extension (MV3)** — tabs/visibility/navigation (L3) + network shape (L2) +
  DOM interaction (L0) → local runtime over WebSocket; side-panel body on any page.
- **P3 Desktop agent (opt-in)** — file saves, git branch switches (`.git/HEAD`, name only),
  piped terminal/test output transitions (L4) → runtime.
- **P4 Learning** — preference from undo/ignore, pattern→template suggestions across sites.

## Acceptance for the new thesis

- A person using the screen normally — no simulated error — sees the body adapt to what
  they are doing (e.g. "stuck" surfaces relevant context; "returning" shows a summary).
- Every morph is still explainable ("why") and reversible.
- The sensing indicator always tells the truth about what is observed. ✅ implemented: sensors
  report their consented layers (`sensor.layers_changed` → `WorldState.sensing`); the body only
  displays what was reported.
