import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "customer-tracking.spec.ts",
  outputDir: "../test-results/customer-tracking",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3113",
    viewport: { width: 375, height: 812 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node tests/e2e/customer-tracking-api.mjs",
      cwd: "..",
      url: "http://127.0.0.1:3213/health",
      timeout: 30000,
    },
    {
      command: "pnpm --filter @giromesa/customer exec next dev --hostname 127.0.0.1 -p 3113",
      cwd: "..",
      url: "http://127.0.0.1:3113",
      timeout: 120000,
      env: {
        NEXT_PUBLIC_CUSTOMER_API_ENABLED: "true",
        NEXT_PUBLIC_CUSTOMER_API_URL: "http://127.0.0.1:3213",
      },
    },
  ],
});
