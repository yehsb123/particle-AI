import { test, expect, type Page } from "@playwright/test";

/**
 * One session, two bodies. The same workspace is open in another tab and in the extension's side
 * panel, and both are watching the same runtime session.
 *
 * The runtime asks a person before it runs something risky. Only the body whose own event caused
 * the question used to learn of it: every other body was told the runtime was waiting for
 * approval and given nothing to answer with. And when somebody did answer, nothing was broadcast
 * either, so the other body kept a card for something already settled — clicking it got a 404.
 *
 * Requires the runtime server on :8787 (pnpm runtime). Skipped if unreachable.
 */
const SESSION = `two-bodies-${Date.now()}`;

/** Open a body already connected to this runtime session. */
const openBody = async (page: Page) => {
  await page.goto(`/?connect=1&session=${SESSION}`);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("button", { name: /Runtime: server/ })).toBeVisible({ timeout: 15_000 });
  return page;
};

test("one session, two bodies: both are asked, and both cards go when either answers", async ({ page, context, request }) => {
  const up = await request.get("http://localhost:8787/health").then((r) => r.ok()).catch(() => false);
  test.skip(!up, "runtime server not running on :8787");

  const first = await openBody(page);
  const second = await openBody(await context.newPage());

  // the first body causes the event; the runtime proposes a risky remediation and waits
  await first.getByRole("button", { name: "Vulnerability found" }).click();
  await expect(first.getByText("Approval required")).toBeVisible({ timeout: 15_000 });

  // the second body never sent that event, and is asked all the same
  await expect(second.getByText("Approval required")).toBeVisible({ timeout: 15_000 });
  await expect(second.getByText("security.update_dependency", { exact: true })).toBeVisible();

  // whichever body answers, the question is gone from both
  await second.getByRole("button", { name: "Approve" }).first().click();
  await expect(second.getByText("Approval required")).toHaveCount(0, { timeout: 15_000 });
  await expect(first.getByText("Approval required")).toHaveCount(0, { timeout: 15_000 });

  await second.close();
});
