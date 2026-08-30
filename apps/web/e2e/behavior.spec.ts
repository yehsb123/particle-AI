import { test, expect } from "@playwright/test";

/**
 * Concept v2 — the body reshapes from BEHAVIOR alone. No error is ever emitted here:
 * repeating the same harmless action three times reads as "stuck" and a context card appears.
 */
test("repeating the same action (no error) makes the AI surface context — intent: stuck", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.waitForLoadState("networkidle");

  // 'High CPU' never morphs by itself — only the repeated BEHAVIOR does
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "High CPU" }).click();
    await page.waitForTimeout(250);
  }
  await expect(page.getByText("You seem stuck on this")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Runtime incident")).toHaveCount(0); // no incident, no error
  await expect(page.getByText(/stuck/).first()).toBeVisible(); // intent shown in the rail
  // dismiss = undo
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("You seem stuck on this")).toHaveCount(0);
});
