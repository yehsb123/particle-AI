import { test, expect } from "@playwright/test";

test.describe("Particle AI — autonomous incident morph", () => {
  test("morphs on incident, recovers, and undoes — without the user asking", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // 1. Starts as a development workspace (editor visible), no incident.
    await expect(page.getByText("src/routes.ts").first()).toBeVisible();
    await expect(page.getByText("Runtime incident")).toHaveCount(0);

    // 2. Emit HTTP 500 — the runtime autonomously surfaces an incident workspace.
    // Retry the first interaction to absorb the client-hydration race (idempotent: a second
    // HTTP 500 while the incident is present is a no-op).
    await expect(async () => {
      await page.getByRole("button", { name: "HTTP 500" }).click();
      await expect(page.getByText("Runtime incident")).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByText("Error logs")).toBeVisible();
    // editor (unsaved work) is preserved through the morph
    await expect(page.getByText("src/routes.ts").first()).toBeVisible();
    // inspector explains why
    await expect(page.getByText(/ran·development.read_logs/)).toBeVisible();

    // the risky remediation is gated behind approval (external effect never auto-runs)
    await expect(page.getByText("Approval required")).toBeVisible();
    await expect(page.getByText("development.revert_diff", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Approve" }).click();
    await expect(page.getByText("Approval required")).toHaveCount(0);

    // 3. Recovery returns to the development workspace.
    await page.getByRole("button", { name: "Service recovered" }).click();
    await expect(page.getByText("Runtime incident")).toHaveCount(0);

    // 4. Re-trigger, then undo the last morph.
    await page.getByRole("button", { name: "HTTP 500" }).click();
    await expect(page.getByText("Runtime incident")).toBeVisible();
    await page.getByRole("button", { name: "Undo last morph" }).click();
    await expect(page.getByText("Runtime incident")).toHaveCount(0);

    // 5. An unrelated event does not morph the UI.
    await page.getByRole("button", { name: "High CPU" }).click();
    await expect(page.getByText("Runtime incident")).toHaveCount(0);
    await expect(page.getByText(/no morph/)).toBeVisible();
  });
});
