import { defineConfig } from "vitest/config";

// Unit/integration tests only — Playwright specs under e2e/ run via `pnpm test:e2e`.
export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts", "components/**/*.test.ts"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
  },
});
