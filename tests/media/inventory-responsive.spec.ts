import { expect, test } from "@playwright/test";

test("inventory count stays operable at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const payload = path.endsWith("/management/inventory/returnables")
      ? {
          configurations: [],
          returnables: [],
          incidents: [],
          recentReturnableMovements: [],
          capabilities: {
            canConfirmReturnables: true,
            canRecordReturnableIncident: true,
            canApproveReturnableIncident: true,
          },
        }
      : path.endsWith("/management/inventory")
        ? {
            locations: [{ id: "location-1", name: "Estoque seco", code: "SECO", active: true }],
            items: [
              {
                id: "item-1",
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
                locationId: "location-1",
                inventoryItemId: "item-1",
                quantity: "18",
                reservedQuantity: "4",
                availableQuantity: "14",
                averageCostCents: 250,
              },
            ],
            lots: [],
            assets: [],
            inventoryReviewRequests: [],
            transfers: [],
            reservations: [
              {
                id: "reservation-1",
                inventoryItemId: "item-1",
                locationId: "location-1",
                quantity: "4",
                status: "active",
                sourceType: "event",
                sourceId: "event-1",
                reason: "Evento de sábado",
                createdAt: "2026-08-17T12:00:00.000Z",
              },
            ],
            countSchedules: [],
            productionBatches: [],
            interunitTransfers: [],
            closings: [],
            organizationUnits: [{ id: "unit-1", name: "Unidade Centro" }],
            interunitCatalog: { items: [], locations: [] },
            forecasts: [
              {
                inventoryItemId: "item-1",
                horizonDays: 7,
                expectedDemand: 20,
                suggestedPurchaseQuantity: 6,
                projectedAvailableQuantity: -6,
              },
            ],
            supplierPerformance: [],
            pendingActions: [],
            recentMovements: [],
            automation: { pending: 0, failed: 0, lastProcessedAt: null },
            capabilities: {
              canApproveInventoryRisk: true,
              canResolveTransfers: true,
              canManageAssets: true,
            },
          }
        : path.endsWith("/pilot/catalog")
          ? { products: [] }
          : path.endsWith("/management/suppliers")
            ? { items: [] }
            : {};
    await route.fulfill({ json: payload });
  });

  await page.goto("http://127.0.0.1:3112");
  await page.getByRole("button", { name: /entrar no giromesa/i }).click();
  await page.getByRole("button", { name: /abrir operação/i }).click();
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await page.getByRole("link", { name: /^estoque$/i }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^estoque$/i })).toBeVisible();
  await page.getByRole("button", { name: /contar \/ ajustar/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Adicionar item", { exact: true })).toBeVisible();
  await dialog.getByLabel("Local").selectOption("location-1");
  await dialog.getByLabel("Item de estoque").selectOption("item-1");
  await dialog.getByLabel(/Saldo contado/).fill("18");
  await expect(dialog.getByLabel("Lote")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Adicionar" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await dialog.getByRole("button", { name: "Continuar depois" }).click();
  await page.getByRole("button", { name: /planejamento/i }).click();
  await expect(page.getByRole("heading", { name: "Reservas operacionais" })).toBeVisible();
  await expect(page.getByText("Comprar 6")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
