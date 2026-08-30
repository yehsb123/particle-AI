import { test, expect } from "@playwright/test";

/**
 * Concept v2 (L2) - the body reacts to the SHAPE of traffic (host / status / latency).
 * No content, no error thrown by the app itself: a dependency starts failing and the runtime
 * surfaces a connection view; when the host recovers, the view goes away on its own.
 */
test("failing traffic shape opens a connection view; recovery closes it", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "API 503", exact: true }).click();
  await expect(page.getByText("Connection trouble")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("api.example.com")).toBeVisible(); // bound from network.inspect_shape
  await expect(page.getByText("Runtime incident")).toHaveCount(0);

  await page.getByRole("button", { name: "API recovered" }).click();
  await expect(page.getByText("Connection trouble")).toHaveCount(0, { timeout: 8_000 });
});
