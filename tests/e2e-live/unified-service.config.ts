import { defineConfig, devices } from "@playwright/test";

const databaseUrl =
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: standalone local E2E config is not a cached Turbo task
  process.env.UNIFIED_E2E_DATABASE_URL ??
  "postgresql://giromesa_e2e:giromesa_e2e_local@127.0.0.1:55432/giromesa_e2e";
const parsedDatabaseUrl = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost", "::1"].includes(parsedDatabaseUrl.hostname) ||
  parsedDatabaseUrl.pathname !== "/giromesa_e2e"
) {
  throw new Error("UNIFIED_E2E_DATABASE_URL must point to the local disposable giromesa_e2e DB");
}

export default defineConfig({
  testDir: ".",
  testMatch: "unified-service-live.spec.ts",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3117",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "rtk pnpm db:migrate && rtk node apps/backends/api/dist/main.js",
      env: {
        DATABASE_URL: databaseUrl,
        PORT: "3217",
        HOST: "127.0.0.1",
        CORS_ORIGINS: "http://127.0.0.1:3117",
        INTERNAL_API_KEY: "unified-e2e-internal-key",
        SESSION_SECRET: "unified-e2e-session-secret-at-least-32-bytes",
        QR_TABLE_TOKEN_SECRET: "unified-e2e-qr-secret-at-least-32-bytes",
        TERMINAL_PIN_PEPPER: "unified-e2e-pin-pepper-at-least-32-bytes",
        COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION: "v1",
        COMMAND_FINGERPRINT_KEYS: '{"v1":"unified-e2e-command-key-at-least-32-bytes"}',
        EMAIL_PROVIDER_ENABLED: "false",
        WHATSAPP_PROVIDER_ENABLED: "false",
        DOSECLUB_PROVIDER_ENABLED: "false",
      },
      reuseExistingServer: true,
      timeout: 240_000,
      url: "http://127.0.0.1:3217/health",
    },
    {
      command: "rtk pnpm --filter @giromesa/ops exec vite --host 127.0.0.1 --port 3117",
      env: { VITE_API_URL: "http://127.0.0.1:3217" },
      reuseExistingServer: true,
      timeout: 120_000,
      url: "http://127.0.0.1:3117",
    },
  ],
});
