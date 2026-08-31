import { test, expect } from "@playwright/test";

/**
 * Spec §20: after the same flow repeats to the threshold (3× incident→surface), the runtime
 * SUGGESTS a reusable template — surfaced as a dismissible banner. Suggest-only, no mutation.
 */
test("pattern suggestion banner appears after repeated flows and can be dismissed", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);

  for (let cycle = 0; cycle < 3; cycle++) {
    // incident (critical bypasses cooldown), then recover (de-escalation, not rate-limited)
    await expect(async () => {
      await page.getByRole("button", { name: "HTTP 500" }).click();
      await expect(page.getByText("Runtime incident")).toBeVisible({ timeout: 1200 });
    }).toPass({ timeout: 15_000 });
    // from the 2nd occurrence on, episodic memory marks the incident as recurring ×N
    if (cycle >= 1) {
      await expect(page.getByText("recurring")).toBeVisible();
      await expect(page.getByText(`×${cycle + 1}`)).toBeVisible();
    }
    await page.getByRole("button", { name: "Service recovered" }).click();
    await expect(page.getByText("Runtime incident")).toHaveCount(0);
  }

  await expect(page.getByText("Pattern noticed")).toBeVisible();
  await expect(page.getByText(/development\.server_error->surface_incident · 3/)).toBeVisible();
  // both repeated flows (surface + restore) reach the threshold — dismiss them all
  while ((await page.getByRole("button", { name: "Maybe later" }).count()) > 0) {
    await page.getByRole("button", { name: "Maybe later" }).first().click();
  }
  await expect(page.getByText("Pattern noticed")).toHaveCount(0);

  // offered once, EVER: after a reload (log replayed, suggested marks imported) the same flow
  // repeating does not bring the banner back
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.app[data-restored="1"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Pattern noticed")).toHaveCount(0); // replay itself re-offers nothing
  await expect(async () => {
    await page.getByRole("button", { name: "HTTP 500" }).click();
    await expect(page.getByText("Runtime incident")).toBeVisible({ timeout: 1200 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Service recovered" }).click();
  await expect(page.getByText("Runtime incident")).toHaveCount(0);
  await expect(page.getByText("Pattern noticed")).toHaveCount(0);
});
