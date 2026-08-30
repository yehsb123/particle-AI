import { test, expect } from "@playwright/test";

/**
 * Concept v2 (P4) - undo is feedback. Dismissing the same augmentation twice teaches the runtime
 * to stop offering it in this session, and the body says so.
 */
test("two dismissals of the same context card make the AI stop offering it (and say why)", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.waitForLoadState("networkidle");

  const cpu = page.getByRole("button", { name: "High CPU" });
  for (let i = 0; i < 3; i++) {
    await cpu.click();
    await page.waitForTimeout(250);
  }
  await expect(page.getByText("You seem stuck on this")).toBeVisible({ timeout: 8_000 });
  await page.getByRole("button", { name: "Dismiss" }).click(); // dismissal 1
  await expect(page.getByText("You seem stuck on this")).toHaveCount(0);

  await cpu.click();
  await expect(page.getByText("You seem stuck on this")).toBeVisible({ timeout: 8_000 }); // offered again
  await page.getByRole("button", { name: "Dismiss" }).click(); // dismissal 2
  await expect(page.getByText("You seem stuck on this")).toHaveCount(0);

  await cpu.click();
  await expect(page.getByTestId("learned-banner")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("augment:stuck")).toBeVisible();
  await expect(page.getByText("You seem stuck on this")).toHaveCount(0); // withheld
  await page.getByTestId("learned-banner").getByRole("button", { name: "Got it" }).click();
  await expect(page.getByTestId("learned-banner")).toHaveCount(0);

  // the lesson is inspectable without developer mode: the AI presence popover names it
  await page.getByRole("button", { name: /AI ·/ }).click();
  await expect(page.getByText(/won't auto-offer: augment:stuck ×2/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/won't auto-offer/)).toHaveCount(0);

  // P4 persistence: what was learned outlives the tab — after a reload the card stays withheld
  // without a single new dismissal (preferences persist; the replayed log is judged with them)
  await page.reload();
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.app[data-restored="1"]')).toBeVisible({ timeout: 10_000 }); // log replayed, live events flow
  await cpu.click();
  await expect(page.getByTestId("learned-banner")).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("You seem stuck on this")).toHaveCount(0);
});
