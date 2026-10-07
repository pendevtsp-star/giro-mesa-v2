import { defineConfig } from "@playwright/test";
import customerTrackingConfig from "./customer-tracking.config";

export default defineConfig({
  ...customerTrackingConfig,
  testDir: "./e2e-customer",
  testMatch: "table-presence.spec.ts",
  outputDir: "../test-results/customer-presence",
  reporter: "list",
});
