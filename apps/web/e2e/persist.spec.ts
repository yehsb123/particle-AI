import { test, expect } from "@playwright/test";

/** Browser-side event sourcing: the workspace survives a refresh by replaying the saved log. */
test("session persists across reload and can be reset", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await expect(async () => {
    await page.getByRole("button", { name: "HTTP 500" }).click();
    await expect(page.getByText("Runtime incident")).toBeVisible({ timeout: 1200 });
  }).toPass({ timeout: 15_000 });

  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Runtime incident")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/session restored/)).toBeVisible();

  await page.getByRole("button", { name: "Reset session" }).click();
  await page.waitForLoadState("networkidle");
  await expect(page.getByText("Runtime incident")).toHaveCount(0);
});
