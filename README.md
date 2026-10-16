# Particle AI

[![CI](https://github.com/yehsb123/particle-AI/actions/workflows/ci.yml/badge.svg)](https://github.com/yehsb123/particle-AI/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An AI **layer over your computer**: it watches how you work, keeps a continuous guess about
what you are trying to do, and reshapes its own interface around you **before and without
anything breaking**.

Instead of asking AI to use software, the AI **becomes** the software.

> ⚠️ Experimental research software. Not production-ready.

[한국어 README →](README.ko.md) · **[Quickstart — feel it in 5 minutes →](QUICKSTART.md)**

## Where this is going

The product is being redefined. The target is a layer that reads **every** application, not
only the ones that emit developer signals, and that acts on your behalf when you ask it to.
The plan, the four decisions it forces, and the order of work are in
[`docs/DESIGN_V2.md`](docs/DESIGN_V2.md).

**Nothing in that plan is built yet.** Everything described below is what runs today.

## The idea

Conventional generative AI is `prompt → model → response`. Particle AI runs a
continuous loop instead:

```
observe → understand → evaluate significance → infer intent → decide
→ select intelligence → select capabilities → act → morph the interface
→ observe the result → repeat
```

The interface is the AI's body; behavior is its senses. Come back after being away and a
re-entry summary is waiting. Repeat the same action three times and related context appears
beside your work. Keep alternating between two files and they get pinned. A dependency
starts failing — read from the shape of the traffic, not its content — and a connection view
opens, then closes itself on recovery. Errors (a failing build, an HTTP 500) are just **one
case** of this: the user never typed "show me the error dashboard." And undo is feedback —
dismiss the same kind of change twice and it stops being offered.

## What it senses today

Three sensors, all **shape only**: no file contents, no page contents, no message text.

| Sensor | Senses |
|---|---|
| Web body | clicks, dwell, idle time, visibility |
| Browser extension (MV3) | tab focus, navigation hostnames, and opt-in traffic shape (host, status, latency) |
| Desktop agent (opt-in) | file **saves** (relative paths) and test/build pass↔fail transitions |

The signals are developer-flavoured today: HTTP 500, build failed, vulnerability found. That
is the limitation `DESIGN_V2.md` sets out to remove.

## Quick start

```bash
pnpm install
pnpm test          # all unit/integration suites (~2 min)
pnpm dev           # web (3000) + runtime (8787) together — or `pnpm web` / `pnpm runtime` separately
```

Ports and settings come from env (`PORT`, `DM_PORT`, …) and are passed through turbo, so
`DM_PORT=8790 PORT=3010 pnpm dev` works. See `.env.example` for every variable — it lists
every variable the code reads, and nothing it does not.

No API key is required — the runtime uses a deterministic mock provider by default.
To enable a real provider, copy `.env.example` to `.env` and fill in a key.

## Browser extension (Concept v2)

Particle AI is a **layer over the browser**, not just one page. `apps/extension` (MV3) senses
tab focus, navigation hostnames, interaction counts, idle time and — opt-in — the *shape* of
network traffic (host · status · latency, never paths or bodies), and shows the body in a
side panel on any site.

```bash
pnpm --filter @particle/extension build   # -> apps/extension/dist
pnpm dev                                  # runtime :8787 + body :3000 (or `pnpm runtime` / `pnpm web` in two terminals)
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

## Screen capture (off by default, not a sensor)

The agent's window sensor reads a window through the Windows accessibility API, which works only
when the program answers. Measured on a Windows 11 machine: Hancell names every menu and button;
KakaoTalk gives six unnamed panes and no conversation list, because it never implemented the
functions that answer. A window like that can only be read as a picture.

`packages/screen-capture` takes one picture of one window and writes a png. It is attached to no
sensor, imported by no app, sends nothing anywhere, and refuses until `DM_CAPTURE=1`. With nothing
configured the repository behaves exactly as before.

```bash
DM_CAPTURE=1 pnpm --filter @particle/screen-capture exec tsx src/bin.ts --app KakaoTalk
```

A frame travels as a **filename**: the pixels stay on the machine that took them. Reading a
captured screen with a model, and the consent wording that would have to be rewritten first, are
not built. See [`packages/screen-capture/README.md`](packages/screen-capture/README.md).

## Runtime access control

The runtime holds a shape-level record of what you did, so by default it only talks to you:

| Setting | Default | Meaning |
|---|---|---|
| `DM_HOST` | `127.0.0.1` | bind address — set `0.0.0.0` only to expose it on your LAN |
| `DM_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | browser origins allowed to read/write; `chrome-extension://` origins are always allowed; any other page gets no CORS grant and a 403 |
| `DM_INGEST_TOKEN` | *(empty)* | optional shared secret — when set, every read and write needs `x-particle-token` (WS: `?token=`); the extension takes it in its options page, the agent from the same env var |

Reads never create sessions, so unknown ids cannot evict real ones. Shape-only is enforced at the
sensors; the runtime trusts the body, the extension and token holders.

## Persistence (optional)

With `DATABASE_URL` set the runtime stores events and snapshots in Postgres (Drizzle +
postgres-js); with it empty it runs on in-memory stores and deterministic replay. The compose
file brings up that Postgres and nothing else — runtime and web stay in your terminal.

```bash
docker compose up -d postgres    # start (postgres:16-alpine, same image and settings as CI)
docker compose down              # stop; the named volume dm_pgdata keeps the data
docker compose down -v           # stop and throw the data away
```

Then point the runtime at it and start as usual:

```bash
DATABASE_URL=postgres://dm:dm@127.0.0.1:5432/digital_matter pnpm runtime
```

`GET /health` reports which store is live — `"backend":"postgres"` or `"backend":"memory"`.

There are no migration files: the runtime creates the `events` and `snapshots` tables itself on
connect (`ensureSchema` in `packages/persistence/src/pg.ts`, `CREATE TABLE IF NOT EXISTS`), so a
first start against an empty database needs no extra step.

On Windows use `127.0.0.1`, not `localhost` — `localhost` can resolve to IPv6 `::1`, where the
container is not listening. If port 5432 is already taken on your machine, set `DM_PG_PORT` to a
free port and put the same port in `DATABASE_URL`.

## Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the runtime loop in
[`docs/RUNTIME_LOOP.md`](docs/RUNTIME_LOOP.md). Design decisions live in
[`docs/adr/`](docs/adr/). Current progress is tracked in
[`docs/STATUS.md`](docs/STATUS.md). The next direction is in
[`docs/DESIGN_V2.md`](docs/DESIGN_V2.md).

## Status

Phases 0–8 (runtime, UI matter, capabilities, memory, persistence, reliability) are done, and
Concept v2 — the behavior layer — is implemented end to end: intent engine (P1), browser
extension + traffic-shape incidents (P2), desktop agent (P3), learning from dismissals (P4),
honest sensing indicator. 1517 unit/integration tests, 17 Playwright E2E tests across 15 specs
(including a real extension test against the live runtime and a Korean options page) and CI are
green. Details: [`docs/STATUS.md`](docs/STATUS.md), [`docs/CONCEPT_V2.md`](docs/CONCEPT_V2.md).

## License

[MIT](LICENSE) — © 2026 Particle AI contributors. Experimental research software.

The capture backends are deliberately split so the licence is too. `packages/screen-capture` is
the default path, is MIT, and uses the Windows drawing API. `packages/screen-capture-obs` drives
OBS Studio, which is GPL v2 or later, so that package carries its own GPL licence and nothing in
the default build imports it. Using it is a choice that brings GPL with it.

`DESIGN_V2.md` proposes a screen-capture sensor built on OBS, which is GPL v2 or later.
Linking it would make this repository GPL as well. That decision has not been made.
