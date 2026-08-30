import { test, chromium } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Chrome Web Store screenshot generator (1280×800). Not a test — runs only with SHOTS=1:
 *   SHOTS=1 pnpm --filter @particle/web exec playwright test store-shots
 * Outputs to docs/store/. Requires the extension dist and, for the side panel, web+runtime up.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const DIST = join(ROOT, "apps/extension/dist");
const OUT = join(ROOT, "docs/store");

test("generate store screenshots", async () => {
  test.skip(process.env.SHOTS !== "1", "screenshot generator — run with SHOTS=1");
  test.skip(!existsSync(join(DIST, "manifest.json")), "extension not built");
  test.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });

  for (const scheme of ["light", "dark"] as const) {
    const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), `pai-shot-${scheme}-`)), {
      channel: "chromium",
      headless: true,
      colorScheme: scheme,
      locale: "ko-KR",
      viewport: { width: 1280, height: 800 },
      args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
    });
    try {
      let [sw] = context.serviceWorkers();
      if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
      const extId = new URL(sw.url()).host;

      const options = await context.newPage();
      await options.goto(`chrome-extension://${extId}/options.html`);
      await options.waitForTimeout(400);
      await options.screenshot({ path: join(OUT, `options-${scheme}.png`) });

      const up = await fetch("http://localhost:3000/").then((r) => r.ok).catch(() => false);
      if (up) {
        const panel = await context.newPage();
        await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
        // wait for the embedded body to paint (probe → iframe → hydration)
        await panel.frameLocator("iframe").getByText("Simulation").first().waitFor({ timeout: 20_000 }).catch(() => {});
        await panel.waitForTimeout(1_200);
        await panel.screenshot({ path: join(OUT, `sidepanel-${scheme}.png`) });
      }
    } finally {
      await context.close();
    }
  }
});
