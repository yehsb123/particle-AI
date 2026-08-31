# Privacy — Particle AI browser extension

**One sentence: the extension observes the *shape* of what you do, never the content, and sends it
only to a runtime you run yourself.**

## What is sensed (each layer has its own switch in Options)

| Layer | Default | Sent | Never sent |
|---|---|---|---|
| Interactions (L0) | on | that a click/scroll/keypress happened, counts per 10 s, idle time | which key, what text, what was clicked |
| Tabs & focus (L3) | on | site **hostnames** you navigate to, time away from the window | full URLs, paths, queries, titles, page text |
| Communication shape (L2) | **off** | hostname · status code · latency of requests (transitions only) | paths, queries, headers, request/response bodies |

## Where it goes

To the runtime at the URL configured in Options — `http://localhost:8787` by default, i.e. **your
own machine**. The extension has no remote endpoint of its own. Nothing is sent anywhere else, sold,
or shared. If the runtime is not running, events are simply dropped.

## What the extension never does

- Read or transmit page content, form input, keystrokes, or clipboard
- Observe its own pages, browser-internal pages (`chrome://`), or the runtime host itself
- Talk to any server other than the runtime URL you configured
- Store anything beyond your consent choices, the optional runtime token, and the runtime URL
  (all in `chrome.storage.sync`)

## Verifiability

The privacy-relevant code is small and pure: `apps/extension/src/shape.ts` (every byte that can
leave the page is derived here) and `src/content.ts` (~40 lines). An automated end-to-end test
(`apps/web/e2e/extension.spec.ts`) navigates to a synthetic URL with a secret path and query and
asserts the runtime's event log **contains neither**.
