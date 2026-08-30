import { test, expect, chromium } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Concept v2 (P2) — the browser extension is a real sensor. Loads the built MV3 extension into a
 * Chromium persistent context and checks, against the LIVE runtime (:8787):
 *   1. navigating to a site becomes a hostname-only shape event (`user.opened_file site:<host>`)
 *      and the extension announces its consented layers (honest indicator);
 *   2. the side panel page opens the body already connected to the runtime.
 * Skips (not fails) when the extension is not built or the runtime is down.
 */
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../extension/dist");
const RUNTIME = "http://localhost:8787";

test("extension: navigation → shape events in the runtime; side panel body auto-connects", async () => {
  test.skip(!existsSync(resolve(DIST, "manifest.json")), "extension not built (pnpm --filter @particle/extension build)");
  const up = await fetch(`${RUNTIME}/api/brain`).then((r) => r.ok).catch(() => false);
  test.skip(!up, "runtime not running on :8787");

  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pai-ext-")), {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    const extId = new URL(sw.url()).host;

    // only THIS run's events are judged — the shared `ext` session may hold earlier local activity
    const before = ((await fetch(`${RUNTIME}/api/sessions/ext/events`).then((r) => r.json())) as { events: unknown[] }).events.length;

    // 1) a synthetic site: fulfilled locally so no real network is touched
    await context.route("http://example.test/**", (route) =>
      route.fulfill({ contentType: "text/html", body: "<!doctype html><title>x</title><h1>hello</h1>" }),
    );
    const page = await context.newPage();
    await page.goto("http://example.test/some/secret/path?token=abc");

    await expect
      .poll(
        async () => {
          const s = (await fetch(`${RUNTIME}/api/sessions/ext/state`).then((r) => r.json())) as {
            behavior?: { recentEntities?: string[] };
            sensing?: Record<string, string[]>;
          };
          return { ents: s.behavior?.recentEntities ?? [], layers: s.sensing?.extension ?? [] };
        },
        { timeout: 15_000 },
      )
      .toMatchObject({ ents: expect.arrayContaining(["site:example.test"]), layers: expect.arrayContaining(["tabs", "interactions"]) });

    // shape only: nothing about the path or query ever reached the runtime
    const events = (await fetch(`${RUNTIME}/api/sessions/ext/events`).then((r) => r.json())) as { events: unknown[] };
    const dump = JSON.stringify(events.events.slice(before));
    expect(dump).not.toContain("secret");
    expect(dump).not.toContain("token=abc");
    // network sensing is opt-in and off by default → no network.request events
    expect(dump).not.toContain('"network.request"');

    // 2) the side panel page embeds the body, already connected to the runtime
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
    const body = panel.frameLocator("iframe");
    await expect(body.getByRole("button", { name: /server ●/ })).toBeVisible({ timeout: 20_000 });
  } finally {
    await context.close();
  }
});
