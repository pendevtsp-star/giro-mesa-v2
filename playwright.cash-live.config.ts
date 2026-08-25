import { defineConfig, devices } from "@playwright/test";

const databaseUrl = process.env.CASH_E2E_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "CASH_E2E_DATABASE_URL is required and must point to a disposable PostgreSQL database",
  );

export default defineConfig({
  testDir: "./tests/e2e-live",
  testMatch: "cash-live.spec.ts",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3115",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command:
        "rtk pnpm db:migrate && rtk node --env-file-if-exists=.env apps/backends/api/dist/main.js",
      env: {
        DATABASE_URL: databaseUrl,
        PORT: "3215",
        HOST: "127.0.0.1",
        CORS_ORIGINS: "http://127.0.0.1:3115",
      },
      reuseExistingServer: false,
      timeout: 240_000,
      url: "http://127.0.0.1:3215/health",
    },
    {
      command: "rtk pnpm --filter @giromesa/ops exec vite --host 127.0.0.1 --port 3115",
      env: { VITE_API_URL: "http://127.0.0.1:3215" },
      reuseExistingServer: false,
      timeout: 120_000,
      url: "http://127.0.0.1:3115",
    },
  ],
});
