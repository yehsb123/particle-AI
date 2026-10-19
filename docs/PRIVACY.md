# Privacy — Particle AI browser extension

**One sentence: three of the extension's four layers observe the *shape* of what you do and never
the content, the fourth reads the page you are on and is off until you switch it on, and all of it
goes only to a runtime you run yourself.**

## What is sensed (each layer has its own switch in Options)

| Layer | Default | Sent | Never sent |
|---|---|---|---|
| Interactions (L0) | on | that a click/scroll/keypress happened, counts per 10 s, idle time | which key, what text, what was clicked |
| Tabs & focus (L3) | on | site **hostnames** you navigate to, time away from the window | full URLs, paths, queries, titles, page text |
| Communication shape (L2) | **off** | hostname · status code · latency of requests (transitions only) | paths, queries, headers, request/response bodies |
| Page structure | **off** | the page's title, up to five headings, up to eight box labels, up to six button names, and how many boxes were left out | anything you typed into a box, the text of the page, and any box that could hold a password or a card number — label and all |

### The page layer, in detail

It is the one layer of this extension that reads what is on a page, so it says more about itself
than the others do.

- **What it takes**: names a person can read off the page. The title, a few headings, the labels
  beside input boxes, the captions on buttons. Four fields of at most 120 characters each and one
  count — about six hundred characters for a whole page.
- **What it never takes**: a value. Nothing in this extension reads what is in a box — not the
  property, not the attribute. The one thing spelled `value` that is read anywhere is the caption
  attribute a button carries instead of text (`<input type="submit" value="Search">`), which the
  page wrote and nobody typed; it sits in a function of its own, and a test holds every other
  read of a value out of every file that touches a page. A box whose type, autocomplete, name, id
  or label says it can hold a password or a card number is not described at all; only the number
  of such boxes is sent, so you can tell something was held back.
- **Who wrote the names it takes**: the page, nearly always. Not always: in a document editor a
  heading you typed is a real `<h1>`, and a tool that names the browser tab after the document
  puts the name you gave it in the title. Both are read, like any other title or heading — a
  layer that cannot read a title cannot tell a job board from a ticket queue, which is the whole
  reason it exists. What is never read, on any page, is the value of a box.
- **How often**: at most once every 30 seconds per tab, and only when the page's shape has
  actually changed, and only while the tab is the one you are looking at.
- **Where it goes**: the same place everything else goes — the runtime at the URL in Options,
  your own machine by default. Nothing is kept in the browser.
- **How to stop it**: the switch in Options. It is off until you turn it on.

## Where it goes

To the runtime at the URL configured in Options — `http://localhost:8787` by default, i.e. **your
own machine**. The extension has no remote endpoint of its own. Nothing is sent anywhere else, sold,
or shared. If the runtime is not running, events are simply dropped.

## What the extension never does

- Read or transmit form input, keystrokes, or clipboard — in any layer, including the page one
- Read or transmit page content in the three shape layers (the page layer sends the names
  described above, and only once you have switched it on)
- Observe its own pages, browser-internal pages (`chrome://`), or the runtime host itself
- Talk to any server other than the runtime URL you configured
- Store anything beyond your consent choices, the optional runtime token, and the runtime URL
  (all in `chrome.storage.sync`)

## Verifiability

The privacy-relevant code is small and pure: `apps/extension/src/shape.ts` (every byte that can
leave the page is derived here — `isSecretField`, `maskLongDigits`, `nameList`, `pageShape` and
`relayPayload` are the whole of what the page layer may send) and `src/page.ts`, the only file
that holds an element of a page at all — `src/content.ts` keeps the consent and the clock around
it. `src/dom.test.ts` reads real HTML through that file, and `src/page.test.ts` holds every read
of a value out of both. An automated end-to-end test
(`apps/web/e2e/extension.spec.ts`) navigates to a synthetic URL with a secret path and query and
asserts the runtime's event log **contains neither**.
