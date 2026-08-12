import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "doseclub-integration.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3213",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm --filter @giromesa/ops exec vite --host 127.0.0.1 --port 3213 --strictPort",
    env: {
      VITE_API_URL: "http://localhost:3200",
      VITE_DEMO_MODE: "false",
    },
    url: "http://127.0.0.1:3213",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
