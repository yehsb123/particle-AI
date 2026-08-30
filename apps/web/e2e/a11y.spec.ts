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

/** The same states must hold up in DARK mode (contrast is theme-specific), plus the behavior card. */
test("no serious accessibility violations in dark mode (workspace, incident, context card, developer mode)", async ({ page }) => {
  await page.goto("http://localhost:3000");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.waitForLoadState("networkidle");
  // theme button cycles system → dark → light; one click from a fresh session lands on dark
  await page.getByRole("button", { name: /Theme:/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await audit(page, "dark-initial");

  // behavior-driven context card (no error): 3× the same action
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: "High CPU" }).click();
    await page.waitForTimeout(250);
  }
  await expect(page.getByText("You seem stuck on this")).toBeVisible({ timeout: 8_000 });
  await page.waitForTimeout(900);
  await audit(page, "dark-context-card");

  await expect(async () => {
    await page.getByRole("button", { name: "HTTP 500" }).click();
    await expect(page.getByText("Runtime incident")).toBeVisible({ timeout: 1200 });
  }).toPass({ timeout: 15_000 });
  await page.waitForTimeout(900);
  await audit(page, "dark-incident");

  await page.getByRole("button", { name: "Developer mode" }).click();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
  await audit(page, "dark-developer-mode");
});
