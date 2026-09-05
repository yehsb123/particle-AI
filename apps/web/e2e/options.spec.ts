import { test, expect, chromium } from "@playwright/test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The consent page is the privacy contract — it must read correctly in the user's language. */
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../extension/dist");

test("extension options page localizes to Korean and saves consent atomically", async () => {
  test.slow(); // launches its own Chromium with the extension loaded (see extension.spec)
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
    // the line beneath the box says where events go, and it says the address that was saved
    await expect(page.locator("#runtimeDestination")).toHaveText("http://127.0.0.1:9999");
  } finally {
    await context.close();
  }
});

/**
 * Where a sensor sends what it observes is the other half of consent, so the page has to be right
 * about it. This runs in a real browser because what is being checked is which source feeds the
 * line — storage, not the keystrokes — and that is browser wiring, not a function that can be
 * called from a unit test.
 */
test("the runtime address the options page names is the one events actually go to", async () => {
  test.slow();
  test.skip(!existsSync(resolve(DIST, "manifest.json")), "extension not built");
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "pai-dest-")), {
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
    const line = page.locator("#runtimeDestination");
    const box = page.locator("#runtimeUrl");
    // read the extension's own storage from its service worker; `chrome` is not typed in this app
    const stored = () =>
      sw.evaluate(async () => {
        const api = globalThis as unknown as { chrome: { storage: { sync: { get(key: string): Promise<Record<string, unknown>> } } } };
        return (await api.chrome.storage.sync.get("runtimeUrl")).runtimeUrl ?? null;
      });

    // nothing configured: this machine
    await expect(line).toHaveText("http://localhost:8787");

    // an address that was saved is named, and survives the page being reopened
    await box.fill("http://10.0.0.1:8787");
    await box.blur();
    await expect(line).toHaveText("http://10.0.0.1:8787");
    expect(await stored()).toBe("http://10.0.0.1:8787");
    await page.reload();
    await expect(line).toHaveText("http://10.0.0.1:8787");

    // typing is not saving: until the field is left, events still go where they were going, and
    // the line has to keep saying so rather than naming an address nobody is sending to
    await box.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("http://192.168.1.20:8787", { delay: 5 });
    await expect(line).toHaveText("http://10.0.0.1:8787");
    expect(await stored()).toBe("http://10.0.0.1:8787");
    await box.blur();
    await expect(line).toHaveText("http://192.168.1.20:8787");

    // an address the sensor cannot read is refused out loud, in the reader's language
    await box.fill("192.168.1.20:8787");
    await box.blur();
    await expect(line).toHaveText("http://localhost:8787 (주소로 읽을 수 없어 기본값을 씁니다)");
    // what was typed stays in the box, so it can be corrected rather than silently discarded
    await expect(box).toHaveValue("192.168.1.20:8787");
  } finally {
    await context.close();
  }
});
