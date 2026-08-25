import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node tests/e2e/commercial-api-fixture.mjs",
      url: "http://127.0.0.1:3200/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @giromesa/site exec next dev -p 3110",
      env: {
        NEXT_PUBLIC_API_URL: "http://localhost:3200",
        NEXT_PUBLIC_OPS_URL: "http://127.0.0.1:3112",
        NEXT_PUBLIC_GOOGLE_AUTH_ENABLED: "false",
      },
      url: "http://localhost:3110",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @giromesa/customer exec next dev -p 3111",
      url: "http://localhost:3111",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @giromesa/ops exec vite --host 127.0.0.1 --port 3112",
      env: {
        VITE_API_URL: "http://127.0.0.1:3112",
      },
      url: "http://127.0.0.1:3112",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
