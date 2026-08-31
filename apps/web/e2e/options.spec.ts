import { test, expect, chromium } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The consent page is the privacy contract — it must read correctly in the user's language. */
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../extension/dist");

test("extension options page localizes to Korean and saves consent atomically", async () => {
  test.setTimeout(60_000);
  test.skip(!existsSync(resolve(DIST, "manifest.json")), "extension not built");
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pai-opt-")), {
    channel: "chromium",
    headless: true,
    locale: "ko-KR",
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
  try {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    const extId = new URL(sw.url()).host;
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extId}/options.html`);
    await expect(page.getByText("Particle AI가 감지할 수 있는 것")).toBeVisible();
    await expect(page.getByText("통신 형태 (L2) — 옵트인")).toBeVisible();
    // defaults: interactions+tabs on, network OFF (the widest layer is opt-in)
    await expect(page.locator("#interactions")).toBeChecked();
    await expect(page.locator("#network")).not.toBeChecked();
    // two quick toggles must both land (atomic full-object write, no read-modify-write race)
    await page.locator("#network").check();
    await page.locator("#tabs").uncheck();
    await page.locator("#runtimeUrl").fill("http://127.0.0.1:9999");
    await page.locator("#runtimeUrl").blur();
    await page.reload();
    await expect(page.locator("#network")).toBeChecked();
    await expect(page.locator("#tabs")).not.toBeChecked();
    await expect(page.locator("#runtimeUrl")).toHaveValue("http://127.0.0.1:9999");
  } finally {
    await context.close();
  }
});
