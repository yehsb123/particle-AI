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

Three sensors. Ten of their twelve layers are **shape only**: no file contents, no page contents,
no message text. Two of them read content, and both are **off** until you turn them on: the browser
extension reads the names on the page you are on (its title, a few headings, box labels, button
names, never a value you typed and never a box that could hold a password or a card), and the
desktop agent photographs the apps you list. Having a model read one of those pictures is **a third
switch again**, off by default, and it is the only thing in this repository that sends pixels
anywhere. See [`docs/CONSENT_V2.md`](docs/CONSENT_V2.md) for which layer reads what.

| Sensor | Senses |
|---|---|
| Web body | clicks, dwell, idle time, visibility |
| Browser extension (MV3) | tab focus, navigation hostnames, opt-in traffic shape (host, status, latency), and, opt-in, the structure of the page in front of you |
| Desktop agent (opt-in) | file **saves** (relative paths), test/build pass↔fail transitions, the window in front, and, with `DM_CAPTURE=1` and `DM_CAPTURE_APPS`, a picture of those apps' windows, which `DM_SCREEN_READ=1` additionally has a model read |

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

## Screen capture (off by default)

The agent's window sensor reads a window through the Windows accessibility API, which works only
when the program answers. Measured on a Windows 11 machine: Hancell names every menu and button;
KakaoTalk gives six unnamed panes and no conversation list, because it never implemented the
functions that answer. A window like that can only be read as a picture.

`packages/screen-capture` takes one picture of one window and writes a png. By hand:

```bash
DM_CAPTURE=1 pnpm --filter @particle/screen-capture exec tsx src/bin.ts --app KakaoTalk
```

As a sense, it is the desktop agent's screen layer, and it takes two switches and a list:

```bash
DM_WATCH_WINDOWS=1 DM_CAPTURE=1 DM_CAPTURE_APPS=KakaoTalk pnpm agent
```

It photographs a listed app's window while you are in it, at most once a minute per app, and
never a window of a program you did not list. With nothing configured the repository behaves
exactly as before.

A frame travels as a **filename**: the pixels stay on the machine that took them, in
`DM_CAPTURE_DIR` or the temp directory, until you delete them. What the runtime is told is that a
picture was taken, of which app, and where it landed (`sensor.captured_window`). While the layer
runs the body says so by name — `screen: KakaoTalk` in the sensing indicator — and carries this
layer's own consent wording. [`docs/CONSENT_V2.md`](docs/CONSENT_V2.md) is the decision behind it.
See [`apps/agent/README.md`](apps/agent/README.md) and
[`packages/screen-capture/README.md`](packages/screen-capture/README.md).

## Reading a picture with a model (a third switch, also off)

```bash
DM_WATCH_WINDOWS=1 DM_CAPTURE=1 DM_CAPTURE_APPS=KakaoTalk DM_SCREEN_READ=1 pnpm agent
```

With `DM_SCREEN_READ` set, each picture the layer takes is handed to a model, which answers with
a **validated reading** — what situation the window is in (`messaging`, `error`, `waiting`, …),
one sentence, a few topics, whether it is waiting on you, and how sure it is. That reading is
sent as `sensor.screen_read`; a model that answers with prose, with a word outside the
vocabulary, or with an instruction aimed at your terminal produces no reading and nothing is
sent. The schema is `packages/contracts/src/screen.ts`.

This is a separate switch from the camera because it is a separate thing to agree to: **this is
where the pixels leave the disk they were written to.** With no API key configured the model is
the deterministic one, which answers without looking at the picture, so nothing leaves the
machine; with a key, the picture goes to that provider. The agent prints which brains may read
before it starts and names the one that read after each picture. Unset `DM_SCREEN_READ` and
pictures are taken and never read.

## Sending events

`POST /api/events` runs the whole loop for that event — world, significance, intent, a model
call, permissions, capabilities, the morph — and answers with the result. That is what the body
wants, and it is still the default.

A **sensor** does not read that answer. The extension and the desktop agent report what they just
observed and were holding the connection open through the entire loop, so one slow model call was
one sensor that had stopped sensing. Both now send `?wait=0`:

| Request | Answer |
|---|---|
| `POST /api/events` | `200` with the world state, decision, morph and the rest — unchanged |
| `POST /api/events?wait=0` | `202 {"accepted":true,"eventId":"...","dropped":0}`, and the event runs behind the ones before it |
| `POST /api/events?wait=0` with a malformed event | `400` — not waiting for the answer is not the same as never hearing that the event was wrong |

`?wait=0` is the only spelling. `wait=false` reads like "do not wait" to whoever typed it, so it
is refused rather than guessed at.

`dropped` is how many of **that session's** events this runtime has let go since it started, and
it is the only thing still travelling back to a sender that no longer waits — a 202 arrives
whether the loop ran the event or threw it away. Both sensors watch the number and say one line
when it goes up.

Either way a session's events are run **one at a time, in the order they arrived**: the loop folds
each event into the belief the one before it left behind, and two of a session's events running at
once would make the body depend on which model call answered first. Sessions never wait on each
other.

| Setting | Default | Meaning |
|---|---|---|
| `DM_EVENT_QUEUE_MAX` | `100` | how many events may be waiting for ONE session before the oldest are let go |

A runtime that falls behind drops the **oldest** waiting events, and says so: an `events_dropped`
record in that session's trail (`GET /api/sessions/:id/decisions`) naming the event id that was
lost and how many that session has lost in all, a line in the runtime log, a running count on
`/health` (`queue: { waiting, dropped, queueMax }`), and `dropped` on every acknowledgement. A
caller that was waiting gets `503`, not a `200` that pretends the event ran.

What a session lost outlives its queue: the queue is thrown away the moment the session goes
quiet, the count is not. Counts are kept for the thousand sessions that most recently lost
something — a session name comes from outside, so even a number per name has to be bounded.

## The channel events travel down (Kafka, optional)

Between the sensor that observed something and the loop that folds it into a belief there is one
part: `packages/event-bus`. By default it is nothing at all — publishing an event IS calling the
loop, in the same process, with nothing installed and no broker anywhere. Everything above
describes that default and none of it changes.

With `DM_EVENT_BUS=kafka` those same two ends become a producer and a consumer. The runtime
publishes what arrives over HTTP to a topic and consumes it back out of the same topic; the
session name is the **partition key**, so one session's events stay on one partition and come
back in the order they went in.

| Setting | Default | Meaning |
|---|---|---|
| `DM_EVENT_BUS` | `inproc` | `inproc` or `kafka` — any other spelling stops the runtime at startup |
| `DM_KAFKA_BROKERS` | `127.0.0.1:9092` | comma-separated `host:port` list |
| `DM_KAFKA_TOPIC` | `digital-matter.events` | the topic events are published to and consumed from |
| `DM_KAFKA_GROUP_ID` | `digital-matter-runtime` | the consumer group this runtime joins |
| `DM_KAFKA_SSL` | *(off)* | TLS to the broker |
| `DM_KAFKA_SASL_MECHANISM` | *(empty)* | `plain`, `scram-sha-256` or `scram-sha-512` — the three go together |
| `DM_KAFKA_SASL_USERNAME` | *(empty)* | the user this runtime connects as |
| `DM_KAFKA_SASL_PASSWORD` | *(empty)* | its password, from the environment only — it is never logged and never put in an error |

**Who can write to the topic can put events into this runtime.** The topic is a second door into
the same loop: a message that fits the event contract is run, and `DM_INGEST_TOKEN` is not asked
for there — it guards HTTP. The broker is the boundary, so on a shared one authenticate (SASL
over TLS) and narrow the **topic-write ACL to the runtime's own producer**. The compose broker
asks nobody who they are, which is why it is published on `127.0.0.1` only.

A runtime that holds its HTTP callers to `DM_INGEST_TOKEN` and is pointed at a broker that is
neither on this machine nor authenticated to **does not start**, because a lock on the front door
while the back one stands open is worse than no lock: whoever set the token believes there is one.

`kafkajs` is **not** a dependency of this repository. It is imported dynamically and only once the
channel is on, so the default install never downloads it and the default build never imports it.
The runtime makes sure the topic exists at startup (with the broker's own partition count and
replication), because a consumer that subscribes to a topic which is not there yet is answered
"this server does not host this topic-partition" and stops.

```bash
pnpm add -w kafkajs                        # the one extra dependency, and only if you want kafka
docker compose --profile kafka up -d kafka # apache/kafka:3.9.0, one node, KRaft, no volume
DM_EVENT_BUS=kafka pnpm runtime
docker compose --profile kafka down        # stop it again
```

If `kafkajs` is missing, or no broker answers, the runtime **says which and stops**. It never
falls back to the in-process channel: somebody who asked for Kafka and was quietly given
something else would be watching an empty topic, certain their events were on it.

```
Error: DM_EVENT_BUS=kafka could not reach a broker at 127.0.0.1:9099: Connection error:
connect ECONNREFUSED 127.0.0.1:9099. Start one (docker compose --profile kafka up -d kafka)
or unset DM_EVENT_BUS.
```

Watching one event go all the way through:

```bash
curl -s -XPOST 'http://127.0.0.1:8787/api/events' -H 'content-type: application/json' \
  -d '{"id":"demo-1","sessionId":"live-demo","timestamp":"2026-10-22T02:30:00.000Z","source":"development","type":"development.server_error","severity":"critical","payload":{"status":500}}'
# {"accepted":true,"eventId":"demo-1","deliveredTo":"kafka","topic":"digital-matter.events"}

curl -s http://127.0.0.1:8787/api/sessions/live-demo/state   # the consumer ran it: a problem is open
docker exec dm-kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server 127.0.0.1:9092 \
  --topic digital-matter.events --from-beginning --timeout-ms 5000 --property print.key=true
# live-demo	{"id":"demo-1","sessionId":"live-demo",...}
```

**One runtime per group.** A consumer group is how a crowd of workers shares a topic, and a
runtime is not a worker: what it builds out of a session's events is a belief held in its own
memory, and the broker gives one session's partition to exactly one member of the group.

Measured against the compose broker, with two runtimes in one group: six sessions posted to the
first were folded three by it and three by the second, and a rebalance that moved one session
across dropped the count of what that person had done from three to one. Both runtimes were up
and answering the whole time, each blind to half of what happened.

So the second one asks the broker who is already in the group and does not start:

```
Error: DM_EVENT_BUS=kafka will not join the consumer group digital-matter-runtime: 1 member(s)
are already in it (digital-matter-runtime-bcff0b3e-…). A runtime holds each session's belief in
its own memory and the broker gives one session's partition to one member, so a second runtime in
this group would take half the sessions away and fold them into a belief that starts at nothing.
Stop the other runtime, or give this one a topic and a group of its own with DM_KAFKA_TOPIC and
DM_KAFKA_GROUP_ID.
```

It is a guard, not a lock: two runtimes started in the same breath can both find the group empty,
and a runtime restarting before the broker has given up on its old member finds itself, which is
the same answer because that member still holds the partitions. A broker that will not describe
the group leaves it unchecked and says so in the log rather than stopping a runtime over a
permission the check happens to need.

**The same event twice.** A broker delivers at least once: a consumer that restarts, or a group
that rebalances, is handed messages it has already run. Inside one process that could not happen,
and folding one observation twice is not a small error. The behaviour numbers climb at twice the
rate the person moved, a repetition reaches its threshold a step early, and the trail shows one
event under two rows.

So the runtime remembers the event ids it has folded, per session, and lets a second copy go. It
is written down where everything else it lets go is written down: an `event_duplicate` record in
that session's trail (`GET /api/sessions/:id/decisions`) and a line in the runtime log. An event
the queue let go at the ceiling is forgotten again, because that one was never folded and the
copy a broker hands back is the only one left.

What is remembered is bounded: the last 1,000 event ids for each of the 500 sessions that most
recently sent one, oldest forgotten first. The memory belongs to this process, so it does not
reach across a restart (what the group has committed bounds that) and an event older than the
memory is folded a second time.

**What changes for a caller.** With a broker in the middle the loop's result belongs to whichever
runtime consumed the message, and this one has nothing to hand back. So a request that would have
been answered `200` with a world state is answered `202` saying where the event went, rather than
an empty world state that reads like "nothing is wrong with this session":

| Request | Default (`inproc`) | `DM_EVENT_BUS=kafka` |
|---|---|---|
| `POST /api/events` | `200` + world state, morph, decision | `202 {"accepted":true,"eventId":"…","deliveredTo":"kafka","topic":"…"}` |
| `POST /api/events?wait=0` | `202 {"accepted":true,"eventId":"…","dropped":0}` | `202 {"accepted":true,"eventId":"…","deliveredTo":"kafka"}` |
| `POST /api/sim/:id/:key` | `200` + world state, morph | `202`, the same as above |
| a malformed event | `400` | `400`, before anything is published |
| an event this runtime already folded | `200 {"accepted":true,"eventId":"…","duplicate":true}` | the consuming runtime lets the copy go and writes it to that session's trail |
| an event the loop let go | `503` | the consuming runtime writes it to that session's trail and its own log; the sender was answered long before |

`dropped` is left out of the kafka answers on purpose: it counts what THIS runtime's lanes let
go, and a sender whose events went to a broker has nothing in those lanes.

**The simulation lab** in `apps/web` keeps working, and keeps drawing — but from the WebSocket
rather than from the response. Its buttons get a `202` with no world state in it, and the morph,
the world state, approvals and the trail arrive when the runtime that consumed the event
broadcasts them. Two things there come only from the response and are therefore not shown in
kafka mode: the explanation of a morph the guards held back, and the pattern suggestions merged
from a click.

Tests need no broker. The contract — ordering, refusal, closing — is pinned against a stand-in in
`packages/event-bus/src/kafka.test.ts`, and `kafka.live.test.ts` runs against a real broker only
when `DM_KAFKA_LIVE=1` is set.

## Runtime access control

The runtime holds a shape-level record of what you did, so by default it only talks to you:

| Setting | Default | Meaning |
|---|---|---|
| `DM_HOST` | `127.0.0.1` | bind address — set `0.0.0.0` only to expose it on your LAN |
| `DM_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | browser origins allowed to read/write; `chrome-extension://` origins are always allowed; any other page gets no CORS grant and a 403 |
| `DM_INGEST_TOKEN` | *(empty)* | optional shared secret — when set, every read and write needs `x-particle-token` (WS: `?token=`); the extension takes it in its options page, the agent from the same env var |

The token guards HTTP. With `DM_EVENT_BUS=kafka` the topic is a second way into the same loop and
the broker is what guards that one; a runtime holding callers to a token and pointed at a broker
it does not authenticate to refuses to start. See [the channel section](#the-channel-events-travel-down-kafka-optional).

Reads never create sessions, so unknown ids cannot evict real ones. Shape-only is enforced at the
sensors, for the ten layers that claim it; the runtime trusts the body, the extension and token
holders. The two layers that read content are enforced by being off until somebody turns them on,
and the page layer additionally by what it refuses to describe (`isSecretField` in
`apps/extension/src/shape.ts`).

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
honest sensing indicator. On top of it the two content layers: the extension reads the names on
the page you are on, and a model reads a photographed window. Unit/integration tests, Playwright
E2E (including a real extension test against the live runtime and a Korean options page) and CI
are green; the counts are in [`docs/STATUS.md`](docs/STATUS.md). See also
[`docs/CONCEPT_V2.md`](docs/CONCEPT_V2.md).

## License

[MIT](LICENSE) — © 2026 Particle AI contributors. Experimental research software.

The capture backends are deliberately split so the licence is too. `packages/screen-capture` is
the default path, is MIT, and uses the Windows drawing API. `packages/screen-capture-obs` drives
OBS Studio, which is GPL v2 or later, so that package carries its own GPL licence and nothing in
the default build imports it. Using it is a choice that brings GPL with it.

`DESIGN_V2.md` proposes a screen-capture sensor built on OBS, which is GPL v2 or later.
Linking it would make this repository GPL as well. That decision has not been made.
