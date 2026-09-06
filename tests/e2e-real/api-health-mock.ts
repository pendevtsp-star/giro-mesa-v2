import type { Page } from "@playwright/test";

export async function mockCompatibleApiHealth(page: Page, buildSha: string) {
  await page.route("**/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        version: "2.0.0",
        buildSha,
        schemaVersion: 79,
        database: "up",
        integrations: {},
        capabilities: [
          "table_qr_lifecycle_v1",
          "table_qr_metrics_v1",
          "table_qr_presence_code_v1",
          "ops_background_notifications_v1",
          "table_qr_brand_upload_v1",
          "ops_web_push_v1",
          "public_menu_cover_image_v1",
          "platform_backoffice_v1",
          "platform_commercial_site_v1",
          "edge_hub_pairing_v1",
        ],
      },
    }),
  );
}
