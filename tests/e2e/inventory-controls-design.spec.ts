import { expect, type Page, test } from "@playwright/test";
import { mockCompatibleApi } from "./ops-release";

const organizationId = "a1111111-1111-4111-8111-111111111111";
const unitId = "b1111111-1111-4111-8111-111111111111";
const identityId = "c1111111-1111-4111-8111-111111111111";
const locationId = "d1111111-1111-4111-8111-111111111111";
const itemId = "e1111111-1111-4111-8111-111111111111";
const lotId = "f1111111-1111-4111-8111-111111111111";

async function mockInventory(page: Page) {
  await page.addInitScript(
    ({ identityId, organizationId, unitId }) => {
      localStorage.setItem(
        "giromesa_operational_scope_v1",
        JSON.stringify({ identityId, organizationId, unitId }),
      );
      if (!localStorage.getItem("giromesa-theme")) localStorage.setItem("giromesa-theme", "light");
    },
    { identityId, organizationId, unitId },
  );
  await mockCompatibleApi(page);
  await page.route(/\/health$/, (route) =>
    route.fulfill({
      status: 200,
      json: {
        status: "ok",
        version: "2.0.0",
        buildSha: "inventory-e2e",
        schemaVersion: 73,
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
        ],
        database: "up",
        integrations: {},
      },
    }),
  );
  await page.route(/\/v1\//, (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, json: body });
    if (path.endsWith("/auth/terminal-session"))
      return route.fulfill({ status: 401, json: { message: "Terminal sem sessão" } });
    if (path.endsWith("/auth/me"))
      return json({
        identity: { id: identityId, email: "dono@giromesa.test", displayName: "Proprietário" },
        memberships: [
          {
            membershipId: "membership-1",
            organizationId,
            status: "active",
            role: "owner",
            unitId: null,
          },
        ],
      });
    if (path.endsWith("/organizations"))
      return json([
        {
          membershipId: "membership-1",
          status: "active",
          organization: { id: organizationId, tradeName: "Casa Giro", document: "05953016000132" },
          units: [
            { id: unitId, name: "Unidade Centro", timezone: "America/Sao_Paulo", active: true },
          ],
          roles: [{ role: "owner", unitId: null }],
        },
      ]);
    if (path.endsWith("/management/inventory/controls"))
      return json({
        policies: [
          {
            locationId,
            blindCountRequired: true,
            requireDistinctCountReviewer: true,
            scanRequired: true,
            offlineAllowed: true,
            temperatureMinMilli: 2000,
            temperatureMaxMilli: 8000,
          },
        ],
        countSessions: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            locationId,
            status: "submitted",
            reason: "Conferência do fechamento",
            startedByIdentityId: identityId,
            createdAt: "2026-08-25T01:00:00.000Z",
            reviewNote: null,
            lines: [
              {
                id: "22222222-2222-4222-8222-222222222222",
                inventoryItemId: itemId,
                lotId,
                expectedQuantity: "18",
                countedQuantity: "17",
                differenceQuantity: "-1",
              },
            ],
          },
        ],
        lotHolds: [],
        temperatureReadings: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            locationId,
            celsiusMilli: 11000,
            status: "critical",
            occurredAt: "2026-08-25T01:05:00.000Z",
          },
        ],
        confidence: {
          score: 82,
          level: "medium",
          countAccuracyPercent: 94.4,
          transferAccuracyPercent: 98,
          lossRatePercent: 1.2,
        },
        anomalies: [
          {
            id: "temperature:1",
            kind: "critical_temperature",
            severity: "high",
            locationId,
            detail: "Temperatura crítica: 11 °C.",
            occurredAt: "2026-08-25T01:05:00.000Z",
          },
        ],
        purchaseSuggestions: [
          {
            inventoryItemId: itemId,
            inventoryItemName: "Água mineral 500 ml",
            suggestedPurchaseQuantity: "24",
            preferredSupplierId: null,
            leadTimeDays: 1,
          },
        ],
        productionVariances: [],
        returnableDepositExposures: [],
        returnableDepositMode: "disabled",
        capabilities: { canReviewCount: true, canReleaseLot: true, canChargeDeposit: true },
      });
    if (path.endsWith("/management/inventory/controls/returnables/policy"))
      return json({
        depositMode: "disabled",
        defaultDueDays: 7,
        returnableClosePolicy: "warn",
      });
    if (path.endsWith("/management/inventory/returnables"))
      return json({
        policy: {
          depositMode: "disabled",
          defaultDueDays: 7,
          returnableClosePolicy: "warn",
        },
        custodyInbox: [
          {
            issueMovementId: "71111111-1111-4111-8111-111111111111",
            orderId: "order-1042",
            orderCode: "P-1042",
            tableLabel: "Mesa 12",
            responsibleIdentityId: identityId,
            responsibleName: "Ana Souza",
            locationId,
            inventoryItemId: itemId,
            issuedQuantity: "12",
            returnedQuantity: "4",
            incidentQuantity: "0",
            outstandingQuantity: "8",
            dueAt: "2026-08-27T12:00:00.000Z",
            oldestOutstandingAt: "2026-08-25T12:00:00.000Z",
            ageDays: 2,
            depositExposureCents: 800,
            handoff: null,
          },
        ],
        reconciliation: {
          totals: [
            {
              containerInventoryItemId: itemId,
              fullEquivalentQuantity: "24",
              emptyPhysicalQuantity: "10",
              openCustodyQuantity: "8",
              supplierInTransitQuantity: "2",
              approvedLossQuantity: "1",
              explainableBalanceQuantity: "45",
              recentCountDifferenceQuantity: "-1",
            },
          ],
          byLocation: [
            {
              containerInventoryItemId: itemId,
              locationId,
              fullEquivalentQuantity: "12",
              emptyPhysicalQuantity: "10",
              openCustodyQuantity: "8",
              supplierInTransitQuantity: "2",
              approvedLossQuantity: "1",
              explainableBalanceQuantity: "33",
              lastCountedAt: "2026-08-25T18:00:00.000Z",
              lastCountDifferenceQuantity: "-1",
            },
          ],
        },
        configurationHealth: {
          undecidedProductIds: [],
          unlinkedReturnableProductIds: ["product-without-item"],
          missingDepositValueProductIds: [],
          inactiveContainerLinkProductIds: [],
        },
        classificationStatus: [
          {
            productId: "product-without-item",
            productName: "Cerveja 600 ml",
            status: "returnable",
            activeLink: null,
          },
        ],
        incidents: [],
        supplierExchanges: [],
        lossIndicators: [],
        capabilities: {
          canConfirmReturnables: true,
          canRecordReturnableIncident: true,
          canApproveReturnableIncident: true,
          canConfigurePolicy: true,
          canHandoffCustody: true,
          canConfigure: true,
          canManageDeposit: true,
        },
      });
    if (path.endsWith("/management/inventory"))
      return json({
        locations: [
          { id: locationId, name: "Freezer do bar", code: "FRZ", kind: "freezer", active: true },
        ],
        items: [
          {
            id: itemId,
            name: "Água mineral 500 ml",
            sku: "AGUA-500",
            barcode: "789000000001",
            unit: "UN",
            purchaseToStockFactor: "1",
            minimumQuantity: "12",
            reorderQuantity: "24",
            leadTimeDays: 1,
            allowNegative: false,
            kind: "resale",
            active: true,
          },
        ],
        balances: [
          {
            locationId,
            inventoryItemId: itemId,
            quantity: "18",
            reservedQuantity: "0",
            availableQuantity: "18",
            averageCostCents: 250,
          },
        ],
        lots: [
          {
            id: lotId,
            inventoryItemId: itemId,
            locationId,
            batchCode: "L2408",
            quantity: "18",
            expiresAt: "2027-08-25",
            active: true,
          },
        ],
        assets: [],
        inventoryReviewRequests: [],
        transfers: [],
        reservations: [],
        countSchedules: [],
        productionBatches: [],
        interunitTransfers: [],
        closings: [],
        organizationUnits: [{ id: unitId, name: "Unidade Centro" }],
        interunitCatalog: { items: [], locations: [] },
        forecasts: [],
        supplierPerformance: [],
        pendingActions: [],
        recentMovements: [],
        automation: { pending: 0, failed: 0, lastProcessedAt: null },
        capabilities: {
          canApproveInventoryRisk: true,
          canResolveTransfers: true,
          canManageAssets: true,
        },
      });
    if (path.endsWith("/pilot/catalog"))
      return json({ products: [{ id: "product-without-item", name: "Cerveja 600 ml" }] });
    if (path.endsWith("/management/suppliers")) return json([]);
    return json({});
  });
}

test("controles do estoque permanecem operacionais em desktop e 375 px", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "A jornada cobre os dois viewports diretamente.");
  await mockInventory(page);
  for (const [width, theme] of [
    [1440, "light"],
    [375, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    const inventoryUrl = "http://127.0.0.1:3112/#/inventory?inventoryView=returnables";
    if (!page.url().startsWith("http")) await page.goto(inventoryUrl);
    await page.evaluate((value) => localStorage.setItem("giromesa-theme", value), theme);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Estoque" })).toBeVisible();
    const inventoryTabs = page.getByRole("group", { name: "Seções do estoque" });
    await expect(inventoryTabs.getByRole("button").nth(0)).toContainText("Visão geral");
    await expect(inventoryTabs.getByRole("button").nth(1)).toContainText("Vasilhames");
    await expect(page.getByRole("heading", { name: "Retornos pendentes" })).toBeVisible();
    await page.getByRole("button", { name: "Novo item de revenda" }).click();
    const resaleItemDialog = page.getByRole("dialog", { name: "Novo item de revenda" });
    await expect(resaleItemDialog).toBeVisible();
    await expect(resaleItemDialog.getByRole("combobox", { name: "Tipo de item" })).toHaveValue(
      "resale",
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Controles/ }).click();
    await expect(page.getByRole("heading", { name: "Contagem cega" })).toBeVisible();
    await expect(page.getByText("Temperatura crítica: 11 °C.")).toBeVisible();
    await expect(page.getByText("82%")).toBeVisible();
    await page.getByRole("button", { name: /Vasilhames/ }).click();
    await expect(page.getByRole("heading", { name: "Retornos pendentes" })).toBeVisible();
    await expect(page.getByText("Mesa 12").first()).toBeVisible();
    await expect(page.getByText("Última divergência de contagem")).toBeVisible();
    await expect(page.getByText("Caução é opcional.")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
