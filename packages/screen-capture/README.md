# @particle/screen-capture — one window, one picture (MIT)

The UI Automation sensor in `apps/agent` reads a window through the accessibility API, which works
only when the program answers. Measured on a Windows 11 machine: Hancell names every menu and
button; Chrome gives its window title and is left to the browser extension anyway; KakaoTalk
gives six unnamed panes and no conversation list at all, because it never implemented the
functions that answer.

A window like that can only be read as a picture. This package takes the picture.

## It is off, and it is not a sensor

Nothing in this repository imports this package. It sends nothing anywhere, it is attached to no
sensor, and it refuses until `DM_CAPTURE` says yes. With no configuration at all the repository
behaves exactly as it did before this package existed.

A capture result travels as a **filename**. The pixels stay on the disk of the machine that took
them — under `DM_CAPTURE_DIR`, or the temp directory when that names nothing — until somebody
deletes them. Reading a captured screen with a model is not built.

The consent wording is written. `screen` is a layer in `SENSING_LAYERS`, the body has words for
it and names the app being photographed, and the extension's options page says this layer is
the runtime's rather than its own. The reasoning is in `docs/CONSENT_V2.md`. What is still not
done is attaching capture to a sensor: nothing in this repository imports this package.

## Taking one

```bash
DM_CAPTURE=1 pnpm --filter @particle/screen-capture exec tsx src/bin.ts --app KakaoTalk
DM_CAPTURE=1 pnpm --filter @particle/screen-capture exec tsx src/bin.ts --foreground --out C:/shots/now.png
```

```ts
import { captureWith, defaultCaptureRegistry, readCaptureConfig } from "@particle/screen-capture";

const result = await captureWith(readCaptureConfig(process.env), defaultCaptureRegistry(), {
  target: { kind: "app", app: "KakaoTalk" },
  path: "C:/shots/kakao.png",
});
if (result.ok) console.log(result.frame.width, result.frame.height, result.frame.bytes);
else console.log(result.reason);
```

A backend never throws: a window that is minimised, a program that is not running, a platform that
is not Windows all come back as `{ ok: false, reason }`.

| Variable | Default | Meaning |
|---|---|---|
| `DM_CAPTURE` | *(off)* | the master switch; `1/true/yes/on`, and a value that says neither is refused |
| `DM_CAPTURE_BACKEND` | `windows` | which backend takes the picture |
| `DM_CAPTURE_DIR` | *(empty)* | where the command line writes when `--out` names nothing; empty means the temp directory |
| `DM_CAPTURE_TIMEOUT_MS` | `15000` | how long a backend may take (100…600000) |

## How the Windows backend draws a window

One short-lived PowerShell process, `user32` for the window and `System.Drawing` for the bitmap.
Everything it uses ships with Windows, so the default capture path adds no third-party licence to
a build — which is the point of the arrangement below.

The drawing call is `PrintWindow` with `PW_RENDERFULLCONTENT`. The older way to photograph a
window is to copy the screen where it happens to be, which copies whatever is on top of it and
fails outright when the window is behind another one. `PrintWindow` asks the window to draw
itself, so a window that is not in front still produces its own picture. Measured here: an editor
fully covered by a terminal captured its own contents correctly.

The window to point at and the file to write are passed in the process's **environment**, never
written into the script, so no caller's text can become a statement this machine runs.

### What it cannot do

- **A minimised window has nothing to draw.** It is refused with a reason rather than saved as the
  160×28 strip `PrintWindow` produces for one. Measured: KakaoTalk minimised is refused; restored,
  it captured at 784×527.
- **Windows only.** Everywhere else the backend answers with a refusal naming the platform.
- **Starting a PowerShell process costs seconds**, because the first `Add-Type` compiles. Measured
  on this machine: 3 to 9 seconds per capture. This is a way to take one picture, not a video.

## The licence boundary

This package is **MIT**, like the rest of the repository, and links nothing that is not Windows.

The OBS backend is **GPL-2.0-or-later** and lives in `@particle/screen-capture-obs`. It is a
separate package, no code here imports it, and no environment variable can pull it in: a backend
reaches a process only when that process's own code imported it and passed it to
`createCaptureRegistry`. `src/boundary.test.ts` reads every source file under `apps/` and
`packages/` on each test run and fails if any of them imports the GPL package.

```ts
import { defaultCaptureRegistry } from "@particle/screen-capture";
import { obsCaptureBackend } from "@particle/screen-capture-obs"; // GPL enters the build on this line

const registry = defaultCaptureRegistry([obsCaptureBackend()]);
```

Asking for `DM_CAPTURE_BACKEND=obs` without that import is refused by name, listing the backends
the process actually holds. There is no fallback: a picture taken through a path nobody chose is
worse than no picture.
