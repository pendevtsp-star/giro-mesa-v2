import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-real",
  testMatch: "catalog-inventory-recipe.spec.ts",
  outputDir: "../scratch/stock-recipe-results",
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3112",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --filter @giromesa/ops exec vite --host 127.0.0.1 --port 3112",
    env: { VITE_API_URL: "http://127.0.0.1:3112" },
    reuseExistingServer: true,
    timeout: 120_000,
    url: "http://127.0.0.1:3112",
  },
});
