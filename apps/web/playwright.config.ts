import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Reuses a running dev/prod server on :3000 if present, otherwise starts one.
 * Only Chromium is configured to keep the browser download small.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  // every spec talks to the SAME live web+runtime (shared sessions like `ext`) — parallel workers
  // race each other's consent toggles and event logs, so E2E is strictly serial
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --filter @particle/web start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
