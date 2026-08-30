import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Automated accessibility audit: no serious/critical WCAG violations on the main states. */
async function audit(page: import("@playwright/test").Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  if (bad.length) {
    console.log(`[a11y:${label}]`, JSON.stringify(bad.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target) })), null, 1));
  }
  expect(bad, `${label}: serious/critical a11y violations`).toEqual([]);
}

test("no serious accessibility violations (workspace, incident, developer mode)", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "Reset session" }).click().catch(() => {});
  await page.waitForLoadState("networkidle");
  await audit(page, "initial");

  await expect(async () => {
    await page.getByRole("button", { name: "HTTP 500" }).click();
    await expect(page.getByText("Runtime incident")).toBeVisible({ timeout: 1200 });
  }).toPass({ timeout: 15_000 });
  await page.waitForTimeout(900); // let morph-in animations settle
  await audit(page, "incident");

  await page.getByRole("button", { name: "Developer mode" }).click();
  await page.mouse.move(0, 0); // leave hover state
  await page.waitForTimeout(400); // let the .15s button transition settle (axe must not sample mid-transition)
  await audit(page, "developer-mode");
});
