import { defineConfig } from "@playwright/test";

/**
 * Browser E2E suite. Runs against a dev server on :3000 — locally any already
 * running server is reused; in CI one is booted. These tests assert product
 * behaviour, including the honesty invariants (labels, fallbacks, no invented
 * numbers), so they fail if a "simulated" claim ever comes back.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: BASE_URL },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "npx next dev -H 127.0.0.1 -p 3000",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
