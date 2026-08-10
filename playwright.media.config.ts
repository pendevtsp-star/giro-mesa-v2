import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/media",
  workers: 1,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  webServer: {
    command: "pnpm --filter @giromesa/ops exec vite --host 127.0.0.1 --port 3112",
    env: { VITE_DEMO_MODE: "true" },
    url: "http://127.0.0.1:3112",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
