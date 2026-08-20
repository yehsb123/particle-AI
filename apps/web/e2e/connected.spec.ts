import { test, expect } from "@playwright/test";

/**
 * Connected mode: the browser drives the runtime SERVER, and the UI morphs from WebSocket
 * ui_patch frames. Requires the runtime server on :8787 (pnpm runtime). Skipped if unreachable.
 */
test("connected mode morphs from server ui_patch frames", async ({ page, request }) => {
  const up = await request.get("http://localhost:8787/health").then((r) => r.ok()).catch(() => false);
  test.skip(!up, "runtime server not running on :8787");

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  // Switch to connected mode (retry to absorb hydration).
  await expect(async () => {
    await page.getByRole("button", { name: /^Runtime:/ }).click();
    await expect(page.getByRole("button", { name: /Runtime: server/ })).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });

  // Emit an incident to the server; the UI should morph from the WS ui_patch.
  await page.getByRole("button", { name: "HTTP 500" }).click();
  await expect(page.getByText("Runtime incident")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Error logs")).toBeVisible();

  // The server also returns the pending approval for the risky remediation; approving it
  // hits the server, which executes the capability.
  await expect(page.getByText("Approval required")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText("Approval required")).toHaveCount(0);
});
