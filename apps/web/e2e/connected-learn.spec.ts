import { test, expect } from "@playwright/test";

/**
 * Connected mode is behaviorally equivalent: sim clicks carry their behavior key to the SERVER,
 * so the server session reads repeats as "stuck", learns from dismissals (undo with attribution
 * over REST), and the withheld morph reaches the body as a learned notice.
 */
test("connected: server-side stuck card, dismissal learning, and the learned notice", async ({ page, request }) => {
  const up = await request.get("http://localhost:8787/health").then((r) => r.ok()).catch(() => false);
  test.skip(!up, "runtime server not running on :8787");

  await page.goto(`/?session=learn${Date.now()}`); // fresh server session per run
  await page.waitForLoadState("networkidle");
  await expect(async () => {
    await page.getByRole("button", { name: /^Runtime:/ }).click();
    await expect(page.getByRole("button", { name: /Runtime: server/ })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  const cpu = page.getByRole("button", { name: "High CPU" });
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < 3; i++) {
      await cpu.click();
      await page.waitForTimeout(300);
    }
    await expect(page.getByText("You seem stuck on this")).toBeVisible({ timeout: 10_000 }); // via WS ui_patch
    await page.getByRole("button", { name: "Dismiss" }).click(); // undo with componentId over REST
    await expect(page.getByText("You seem stuck on this")).toHaveCount(0, { timeout: 10_000 });
  }

  await cpu.click(); // third stuck trigger — the server withholds it and says so
  await expect(page.getByTestId("learned-banner")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("You seem stuck on this")).toHaveCount(0);
});
