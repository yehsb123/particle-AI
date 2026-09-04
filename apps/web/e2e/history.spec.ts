import { test, expect } from "@playwright/test";

/** The morph history strip makes reversibility visible: click a step to undo back before it. */
test("morph history strip lists morphs and supports multi-step undo", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.waitForLoadState("networkidle");

  await expect(page.getByText("no morphs yet")).toBeVisible();
  await expect(async () => {
    await page.getByRole("button", { name: "HTTP 500" }).click();
    await expect(page.getByText("Runtime incident")).toBeVisible({ timeout: 1200 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Service recovered" }).click();
  await expect(page.getByText("Runtime incident")).toHaveCount(0);

  const chips = page.locator(".history .chip");
  await expect(chips).toHaveCount(2);
  // each chip says what that step did, rather than naming the intent behind it
  await expect(chips.nth(0)).toContainText("surfaced the incident");
  await expect(chips.nth(1)).toContainText("back to normal");

  // undo back to before step 1 → both morphs reverted, strip empty, no incident
  await chips.nth(0).click();
  await expect(page.locator(".history .chip")).toHaveCount(0);
  await expect(page.getByText("Runtime incident")).toHaveCount(0);
  await expect(page.getByText(/undo ×2/)).toBeVisible();
});
