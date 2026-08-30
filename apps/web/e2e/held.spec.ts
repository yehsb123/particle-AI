import { test, expect } from "@playwright/test";

/**
 * Stability made explainable: when the morph guard holds a change (here: the 5s cooldown after a
 * de-escalation), the body shows WHY instead of silently doing nothing.
 */
test("a guard-held morph explains itself in the body", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.waitForLoadState("networkidle");

  // warning-level incident (no cooldown bypass) → morph
  await expect(async () => {
    await page.getByRole("button", { name: "Build failed" }).click();
    await expect(page.getByText("Build failure", { exact: true }).first()).toBeVisible({ timeout: 1200 });
  }).toPass({ timeout: 15_000 });
  // de-escalate (sets lastMorphAt) then re-trigger within the cooldown window
  await page.getByRole("button", { name: "Build succeeded" }).click();
  await expect(page.getByText("Build failure", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Build failed" }).click();

  await expect(page.getByText("Morph held")).toBeVisible();
  await expect(page.getByText(/waiting a moment so it doesn't jump around/)).toBeVisible();
  await expect(page.getByText("Build failure", { exact: true })).toHaveCount(0);
});
