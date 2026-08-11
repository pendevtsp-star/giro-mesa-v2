import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["salon-map.spec.ts", "kds.spec.ts", "customer-table-session.spec.ts"],
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3212",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm --filter @giromesa/ops exec vite --host 127.0.0.1 --port 3212 --strictPort",
    env: { VITE_DEMO_MODE: "true" },
    url: "http://127.0.0.1:3212",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
