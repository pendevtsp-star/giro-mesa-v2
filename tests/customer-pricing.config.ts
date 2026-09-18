import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-customer",
  testMatch: "public-pricing.spec.ts",
  outputDir: "../scratch/customer-price-results",
  timeout: 45_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3113",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "rtk proxy node tests/e2e/customer-tracking-api.mjs",
      cwd: "..",
      url: "http://127.0.0.1:3213/health",
      reuseExistingServer: true,
    },
    {
      command: "rtk proxy pnpm --filter @giromesa/customer exec next dev -p 3113",
      cwd: "..",
      url: "http://localhost:3113",
      reuseExistingServer: true,
      timeout: 120_000,
      env: {
        NEXT_PUBLIC_CUSTOMER_API_URL: "http://127.0.0.1:3213",
        NEXT_PUBLIC_CUSTOMER_API_ENABLED: "true",
      },
    },
  ],
});
