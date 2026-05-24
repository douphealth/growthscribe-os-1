import { defineConfig, devices } from "@playwright/test";

// Golden-path E2E. Opt-in via PLAYWRIGHT_E2E=1 so `bun run test` (Vitest)
// stays fast and offline. To run locally:
//
//   PLAYWRIGHT_E2E=1 \
//   E2E_BASE_URL=http://localhost:8787 \
//   E2E_TEST_EMAIL=... E2E_TEST_PASSWORD=... \
//   E2E_WP_URL=... E2E_WP_USER=... E2E_WP_APP_PASSWORD=... \
//   bunx playwright test
//
// In CI, gate this on the same env vars in a separate workflow job; the
// default `bun run ci` does not invoke Playwright.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:8787",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});