# @particle/extension — browser layer (Concept v2, P2)

Chrome/Edge MV3 extension that turns the whole browser into Particle AI's senses,
and puts the **body** in a side panel on any page.

## What it senses

Three of the four layers are **shape only — never content**. The fourth, `page`, reads the page
you are on; it is off until you switch it on, and it is named as the exception wherever sensing
is shown. See [`docs/CONSENT_V2.md`](../../docs/CONSENT_V2.md) for the decision behind that line.

| Layer | Signal | Event | Default |
|---|---|---|---|
| L0 | clicks / scroll / typing **counts** + idle | `user.interaction`, `user.idle`, `user.visibility` | on |
| L3 | window focus, navigation **hostnames** | `user.visibility`, `user.action`, `user.opened_file` | on |
| L2 | request **hostname · status · latency** | `network.request` | **off (opt-in)** |
| page | the page's **title, a few headings, box labels, button names** | `sensor.read_page` | **off (opt-in)** |

Never sent by any layer, including `page`: URL paths and queries, request/response bodies,
keystroke content, the text of a page, and **anything typed into a box**. A box that could hold
a password or a card number is left out of `page` entirely — its label too, not only its value —
and the event carries how many were left out. One page arrives as four names of at most 120
characters each plus that count; the bounds are `PAGE_LIMITS` in `src/shape.ts`.

A title and a heading are read whoever wrote them. On most sites the site wrote them; in a
document editor you did — a heading you typed is a real `<h1>`, and a tool that names the browser
tab after the document puts the name you gave it in `document.title`. `page` reads those too, and
there is no code that tries to tell the two apart: a layer that cannot read a title cannot tell a
job board from a ticket queue. The line it does hold is the value of a box, which it never reads
on any page.

Consent is per layer in the options page (`chrome.storage.sync`).

## Build & load

```bash
pnpm --filter @particle/extension build     # → apps/extension/dist
pnpm runtime                                # http://localhost:8787 (events go here)
pnpm web                                    # http://localhost:3000 (the body)
```

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → select `apps/extension/dist`.
2. Click the extension icon → the side panel opens the body at
   `http://localhost:3000/?connect=1&session=ext` (auto-connects to the runtime).
3. Right-click the icon → **Options** to toggle sensing layers.

## Verified by E2E

`apps/web/e2e/extension.spec.ts` loads `dist/` into Chromium, navigates to a synthetic site and
asserts against the live runtime: hostname-only event, announced layers, no path/query in the log,
no network events without consent, side panel body connected. Runs in CI.

## Files

- `src/background.ts` — service worker: focus/navigation/webRequest → shape events → runtime.
- `src/content.ts` — interaction counts, idle, visibility (no content access), and the consent,
  clock and sending of the opt-in page layer.
- `src/page.ts` — the page layer's reading: the only file that holds an element of somebody's
  page. Tested against real HTML in `src/dom.test.ts` (jsdom).
- `src/options.ts` — consent toggles.
- `src/shape.ts` — pure helpers (`hostOf`, `networkSeverity`, `matterEvent`) — unit tested.
- `build.mjs` — esbuild bundle + asset copy (file-by-file: `fs.cpSync` recursive segfaults on
  Node 22.17 / Windows for this path).
