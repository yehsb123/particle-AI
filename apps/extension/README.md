# @particle/extension — browser layer (Concept v2, P2)

Chrome/Edge MV3 extension that turns the whole browser into Particle AI's senses,
and puts the **body** in a side panel on any page.

## What it senses (shape only — never content)

| Layer | Signal | Event | Default |
|---|---|---|---|
| L0 | clicks / scroll / typing **counts** + idle | `user.interaction`, `user.idle`, `user.visibility` | on |
| L3 | window focus, navigation **hostnames** | `user.visibility`, `user.action`, `user.opened_file` | on |
| L2 | request **hostname · status · latency** | `network.request` | **off (opt-in)** |

Never sent: URLs paths/queries, request/response bodies, keystroke content, page text,
form values. Consent is per layer in the options page (`chrome.storage.sync`).

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

## Files

- `src/background.ts` — service worker: focus/navigation/webRequest → shape events → runtime.
- `src/content.ts` — interaction counts, idle, visibility (no content access).
- `src/options.ts` — consent toggles.
- `src/shape.ts` — pure helpers (`hostOf`, `networkSeverity`, `matterEvent`) — unit tested.
- `build.mjs` — esbuild bundle + asset copy (file-by-file: `fs.cpSync` recursive segfaults on
  Node 22.17 / Windows for this path).
