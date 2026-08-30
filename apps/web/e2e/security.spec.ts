import { test, expect } from "@playwright/test";

test("security scenario: vulnerability morphs a security workspace; update is gated", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);

  await expect(async () => {
    await page.getByRole("button", { name: "Vulnerability found" }).click();
    await expect(page.getByText("Security alert", { exact: true })).toBeVisible({ timeout: 1200 });
  }).toPass({ timeout: 15_000 });

  await expect(page.getByText("Vulnerable dependency")).toBeVisible();
  await expect(page.getByText("CVE-2026-1234")).toBeVisible();
  // the external-effect remediation waits for consent
  await expect(page.getByText("Approval required")).toBeVisible();
  await expect(page.getByText("security.update_dependency", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText("Approval required")).toHaveCount(0);
  // patched → back to the development workspace
  await page.getByRole("button", { name: "Vulnerability patched" }).click();
  await expect(page.getByText("Security alert", { exact: true })).toHaveCount(0);

  // spec §21: replaying the session's event log reproduces this exact UI (determinism)
  await page.getByRole("button", { name: "Developer mode" }).click();
  await page.getByRole("button", { name: "Replay & verify" }).click();
  await expect(page.getByText(/deterministic ✓/)).toBeVisible();
});
