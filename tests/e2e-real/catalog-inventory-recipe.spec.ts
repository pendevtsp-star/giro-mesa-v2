import { expect, type Page, test } from "@playwright/test";
import { mockCompatibleApiHealth } from "./api-health-mock";

type RecipeInput = {
  productId: string;
  components: Array<{
    inventoryItemId: string;
    locationId: string;
    quantityMilli: number;
    lossBasisPoints: number;
  }>;
};

async function mockCatalogInventory(page: Page) {
  const saves: Array<{ body: RecipeInput; key?: string }> = [];
  const deactivations: Array<{ key?: string }> = [];
  const recipes: Array<
    RecipeInput & { id: string; version: number; validFrom: string; validUntil: null }
  > = [];
  const catalog = {
    capabilities: { canManage: true },
    categories: [{ id: "category-1", name: "Cardápio", active: true }],
    stations: [{ id: "station-1", name: "Cozinha", active: true }],
    products: [
      {
        id: "dish-1",
        categoryId: "category-1",
        name: "Prato do dia",
        active: true,
        productType: "prepared",
      },
      {
        id: "beer-1",
        categoryId: "category-1",
        name: "Cerveja",
        active: true,
        productType: "resale",
      },
    ],
    prices: [
      { productId: "dish-1", priceCents: 3000, deliveryPriceCents: 3500, costCents: null },
      { productId: "beer-1", priceCents: 1200, deliveryPriceCents: null, costCents: 600 },
    ],
    availability: [
      { productId: "dish-1", available: true },
      {
        productId: "beer-1",
        available: true,
        dailyStock: 50,
        soldToday: 2,
        dailyStockRemaining: 48,
      },
    ],
    inventoryProducts: [
      {
        productId: "dish-1",
        inventoryItemId: null,
        itemName: null,
        stockUnit: null,
        physicalQuantity: null,
        availableQuantity: null,
        estimatedCostCents: null as number | null,
        costSource: null as string | null,
        recipeVersion: null as number | null,
        componentCount: 0,
      },
      {
        productId: "beer-1",
        inventoryItemId: "stock-beer",
        itemName: "Cerveja 600 ml",
        stockUnit: "un",
        physicalQuantity: 24,
        availableQuantity: 19,
        estimatedCostCents: 600,
        costSource: "inventory",
        recipeVersion: null,
        componentCount: 0,
      },
    ],
    productStations: [{ productId: "dish-1", stationId: "station-1" }],
    allergens: [],
    modifierGroups: [],
    modifierOptions: [],
    productAllergens: [],
    productModifierGroups: [],
    combos: [],
    recipes: [],
  };
  const inventory = {
    locations: [{ id: "location-1", name: "Cozinha", code: "COZ", kind: "other", active: true }],
    items: [
      {
        id: "ingredient-1",
        name: "Arroz",
        kind: "ingredient",
        unit: "kg",
        purchaseToStockFactor: 1,
        minimumQuantity: 0,
        reorderQuantity: 0,
        active: true,
        leadTimeDays: 0,
        allowNegative: false,
      },
    ],
    balances: [
      {
        inventoryItemId: "ingredient-1",
        locationId: "location-1",
        quantity: 0,
        averageCostCents: 2000,
      },
    ],
    lots: [],
    recentMovements: [],
    automation: { pending: 0, failed: 0, lastProcessedAt: null },
  };
  await mockCompatibleApiHealth(page, "catalog-inventory-recipe-e2e");
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/auth/terminal-session") {
      await route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_INVALID" } });
      return;
    }
    if (path.endsWith("/management/inventory/recipes/dish-1/deactivate")) {
      expect(route.request().method()).toBe("POST");
      deactivations.push({ key: route.request().headers()["idempotency-key"] });
      if (deactivations.length === 1) {
        await route.fulfill({ status: 503, json: { message: "Falha temporária ao desativar." } });
        return;
      }
      recipes.splice(0);
      catalog.inventoryProducts[0].recipeVersion = null;
      catalog.inventoryProducts[0].componentCount = 0;
      catalog.inventoryProducts[0].costSource = null;
      catalog.inventoryProducts[0].estimatedCostCents = null;
      await route.fulfill({ status: 201, json: { productId: "dish-1", active: false } });
      return;
    }
    if (path.endsWith("/management/inventory/recipes") && route.request().method() === "POST") {
      const body = route.request().postDataJSON() as RecipeInput;
      saves.push({ body, key: route.request().headers()["idempotency-key"] });
      recipes.splice(0, recipes.length, {
        ...body,
        id: "recipe-1",
        version: saves.length,
        validFrom: "2026-09-17T12:00:00Z",
        validUntil: null,
      });
      catalog.inventoryProducts[0].recipeVersion = saves.length;
      catalog.inventoryProducts[0].componentCount = body.components.length;
      catalog.inventoryProducts[0].costSource = "recipe";
      catalog.inventoryProducts[0].estimatedCostCents = 550;
      await route.fulfill({ status: 201, json: recipes[0] });
      return;
    }
    const payload =
      path === "/v1/auth/me"
        ? {
            identity: { id: "identity-1", email: "manager@giromesa.test", displayName: "Gestão" },
            memberships: [
              { membershipId: "membership-1", organizationId: "org-1", status: "active" },
            ],
            platformAdmin: false,
          }
        : path === "/v1/organizations"
          ? [
              {
                membershipId: "membership-1",
                organization: { id: "org-1", tradeName: "GiroMesa", document: "12345678000199" },
                units: [
                  {
                    id: "unit-1",
                    name: "Matriz",
                    city: "São Paulo",
                    timezone: "America/Sao_Paulo",
                    active: true,
                  },
                ],
                scopes: [{ role: "manager", unitId: "unit-1" }],
              },
            ]
          : path.endsWith("/pilot/catalog")
            ? catalog
            : path.endsWith("/management/inventory/recipes")
              ? recipes
              : path.endsWith("/management/inventory")
                ? inventory
                : path.endsWith("/management/inventory/returnables")
                  ? {
                      capabilities: { canConfigure: true },
                      configurations: [],
                      classificationStatus: [],
                    }
                  : null;
    await route.fulfill({
      status: payload === null ? 404 : 200,
      json: payload ?? { message: "Sem rota" },
    });
  });
  return { saves, catalog, deactivations };
}

async function openCatalog(page: Page) {
  await page.goto("/#/catalog");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.getByRole("heading", { name: "Cardápio operacional" })).toBeVisible();
}

test("ficha opcional salva, recupera e desativa com confirmação e retry em 375 px", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const { saves, catalog, deactivations } = await mockCatalogInventory(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await openCatalog(page);
  const dish = page.locator(".catalog-product-card").filter({ hasText: "Prato do dia" });
  await expect(dish).toContainText("Ficha técnica opcional");
  await expect(dish.getByRole("button", { name: "Pausar", exact: true })).toBeVisible();
  await dish.getByRole("button", { name: "Editar Produto & Histórico" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar Item: Prato do dia" });
  await dialog.locator("summary").filter({ hasText: "Estoque e ficha técnica · opcional" }).click();
  await expect(
    dialog.getByText(
      "Sem ficha técnica: o produto continua disponível para venda, sem baixa automática de insumos.",
    ),
  ).toBeVisible();
  const recipe = dialog.locator(".recipe-card");
  await expect(recipe.getByLabel("Produto vendido")).toHaveValue("dish-1");
  await expect(recipe.getByLabel("Produto vendido")).toBeDisabled();
  await recipe.getByRole("combobox", { name: "Insumo", exact: true }).selectOption("ingredient-1");
  await recipe
    .getByRole("combobox", { name: "Local de baixa", exact: true })
    .selectOption("location-1");
  await recipe.getByLabel("Quantidade por venda").fill("0,250");
  await recipe.getByLabel("Perda prevista (%)").fill("10");
  await recipe.getByRole("button", { name: "Adicionar componente" }).click();
  await recipe.getByRole("button", { name: "Salvar nova versão" }).click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0].body).toEqual({
    productId: "dish-1",
    components: [
      {
        inventoryItemId: "ingredient-1",
        locationId: "location-1",
        quantityMilli: 250,
        lossBasisPoints: 1000,
      },
    ],
  });
  expect(saves[0].key).toBeTruthy();
  await expect(recipe.getByText("Versão 1", { exact: true })).toBeVisible();
  await expect(recipe.locator(".recipe-version")).toContainText("Arroz · Cozinha");
  expect(catalog.availability[0].available).toBe(true);
  await page.locator("html").evaluate((element) => element.setAttribute("data-theme", "dark"));
  await recipe.scrollIntoViewIfNeeded();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await recipe.screenshot({ path: testInfo.outputPath("optional-recipe-375-dark.png") });
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Cardápio operacional" })).toBeVisible();
  await page
    .locator(".catalog-product-card")
    .filter({ hasText: "Prato do dia" })
    .getByRole("button", { name: "Editar Produto & Histórico" })
    .click();
  await dialog.locator("summary").filter({ hasText: "Estoque e ficha técnica · opcional" }).click();
  await expect(dialog.getByText("Versão 1", { exact: true })).toBeVisible();
  await expect(dialog.locator(".recipe-draft")).toContainText("Arroz");
  expect(saves).toHaveLength(1);
  await recipe.getByRole("button", { name: "Desativar ficha técnica" }).click();
  await recipe.getByRole("button", { name: "Manter ficha" }).click();
  expect(deactivations).toHaveLength(0);
  await recipe.getByRole("button", { name: "Desativar ficha técnica" }).click();
  await recipe
    .locator(".recipe-version")
    .screenshot({ path: testInfo.outputPath("deactivate-recipe-375.png") });
  await recipe.getByRole("button", { name: "Confirmar desativação" }).click();
  await expect(recipe.getByRole("alert").filter({ hasText: "Tente novamente" })).toBeVisible();
  await expect(recipe.getByText("Versão 1", { exact: true })).toBeVisible();
  await recipe.getByRole("button", { name: "Confirmar desativação" }).click();
  await expect(recipe.getByText("Nenhuma ficha técnica ativa", { exact: true })).toBeVisible();
  expect(deactivations).toHaveLength(2);
  expect(deactivations[0].key).toBeTruthy();
  expect(deactivations[1].key).toBe(deactivations[0].key);
  expect(catalog.availability[0].available).toBe(true);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(
    page.locator(".catalog-product-card").filter({ hasText: "Prato do dia" }),
  ).toContainText("Ficha técnica opcional");
});

test("revenda separa saldo físico, saldo disponível e limite diário em 385 px", async ({
  page,
}) => {
  await mockCatalogInventory(page);
  await page.setViewportSize({ width: 385, height: 900 });
  await openCatalog(page);
  const beer = page.locator(".catalog-product-card").filter({ hasText: "Cerveja" });
  await expect(beer).toContainText("Físico: 24 un · Disponível: 19 un");
  await expect(beer).toContainText("Limite diário: restam 48 un");
  await expect(beer).not.toContainText("48 un em estoque");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(385);
  await beer.getByRole("button", { name: "Editar Produto & Histórico" }).click();
  const dialog = page.getByRole("dialog", { name: "Editar Item: Cerveja" });
  await dialog.locator("summary").filter({ hasText: "Estoque e ficha técnica · opcional" }).click();
  await expect(dialog.getByText(/Vinculado a/)).toContainText("Cerveja 600 ml");
  await expect(dialog.getByText(/Custo médio do estoque/)).toContainText(/6,00/);
  await expect(dialog.locator(".recipe-card")).toHaveCount(0);
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});
