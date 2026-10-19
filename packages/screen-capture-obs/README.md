# @particle/screen-capture-obs — GPL-2.0-or-later

**This package is not under the repository's MIT licence.** Everything else in this repository is
MIT; this package is GPL-2.0-or-later, and the full text is in [`LICENSE`](LICENSE) beside it.

Nothing in this repository imports it. No app, no other package, and not `@particle/screen-capture`
itself — `packages/screen-capture/src/boundary.test.ts` reads every source file under `apps/` and
`packages/` on every test run and fails if one does. A build has this package only because
somebody's own code imported it.

## Why GPL when it links nothing

OBS Studio is GPL v2 or later, and so is obs-websocket, the server inside it that this package
talks to. This package bundles neither: it opens a WebSocket to an OBS the person started and asks
it, over the published protocol, for one picture. A socket between two processes is not linking,
and the GPL does not reach across one.

So the argument that this could be MIT exists. The package is GPL anyway, for two reasons. The
boundary should not depend on an argument — a licence that holds only while somebody remembers why
is the kind that stops holding. And the obvious next step for this backend is `libobs` directly,
for the encoding and scene composition a socket cannot reach; keeping it GPL now means that step
changes one package instead of the repository's licence.

The MIT path is `@particle/screen-capture`, which draws a window with Windows' own API and is what
runs when nobody chooses otherwise.

## What it does

One request: a picture of one source that is already configured in OBS. It creates no source,
renames none, starts no recording and changes no scene.

```ts
import { defaultCaptureRegistry, captureWith, readCaptureConfig } from "@particle/screen-capture";
import { obsCaptureBackend } from "@particle/screen-capture-obs"; // GPL enters your build here

const registry = defaultCaptureRegistry([obsCaptureBackend()]);
const result = await captureWith(
  readCaptureConfig(process.env), // DM_CAPTURE=1 DM_CAPTURE_BACKEND=obs
  registry,
  { target: { kind: "app", app: "KakaoTalk" }, path: "C:/shots/kakao.png" },
);
```

`target.kind: "app"` names the OBS **source**, not a window: OBS has no notion of the window in
front of you, so a `foreground` target falls back to `DM_OBS_SOURCE` and is refused when that is
empty, rather than photographing whichever scene happened to be selected.

## Setting OBS up

1. OBS Studio 28 or later (obs-websocket is built in since 28; there is nothing to install).
2. Tools → WebSocket Server Settings → enable the server, and note the port and password.
3. Add a **Window Capture** source pointed at the window you want, and name it. That name is what
   `DM_OBS_SOURCE` or a `kind: "app"` target refers to.

| Variable | Default | Meaning |
|---|---|---|
| `DM_OBS_URL` | `ws://127.0.0.1:4455` | where obs-websocket listens |
| `DM_OBS_PASSWORD` | *(empty)* | the password OBS generated; a secret, so `.env` only |
| `DM_OBS_SOURCE` | *(empty)* | the source or scene to photograph |

The client identifies with `eventSubscriptions: 0`: it wants one picture, not OBS's event stream.
When OBS asks for a password and `DM_OBS_PASSWORD` is empty it refuses before connecting, because
OBS answers an empty authentication string by closing the socket with a code nobody can act on.

## What this is not

It does not read the picture, send it anywhere, or hook into the runtime's sensors. A frame
travels as a filename and the file written stays on the machine that took it. Having a model
read one is the desktop agent's own switch, `DM_SCREEN_READ`, off by default and nothing to do
with this package (`docs/CONSENT_V2.md`, `apps/agent/README.md`).
