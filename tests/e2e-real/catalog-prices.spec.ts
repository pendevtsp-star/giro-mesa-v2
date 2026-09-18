import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { mockCompatibleApiHealth } from "./api-health-mock";

async function mockCatalogApi(page: Page) {
  const updates: Array<{ deliveryPriceCents?: number | null }> = [];
  const creations: Array<Record<string, unknown>> = [];
  const prices = [
    { productId: "product-1", priceCents: 1_200, deliveryPriceCents: null as number | null },
    { productId: "product-2", priceCents: 800, deliveryPriceCents: 0 as number | null },
  ];
  const catalog = {
    capabilities: { canManage: true },
    categories: [{ id: "category-1", name: "Bebidas", active: true }],
    stations: [{ id: "station-1", name: "Bar", active: true }],
    products: prices.map((price, index) => ({
      id: price.productId,
      categoryId: "category-1",
      name: index === 0 ? "Cerveja retornável" : "Refrigerante",
      active: true,
      productType: "resale",
    })),
    prices,
    availability: prices.map((price) => ({ productId: price.productId, available: true })),
    productStations: [],
    allergens: [],
    modifierGroups: [],
    modifierOptions: [],
    productAllergens: [],
    productModifierGroups: [],
    combos: [],
  };
  await mockCompatibleApiHealth(page, "catalog-prices-e2e");
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/v1/auth/terminal-session") {
      await route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_INVALID" } });
      return;
    }
    if (route.request().method() === "POST" && path.endsWith("/pilot/catalog/products")) {
      creations.push(route.request().postDataJSON());
      await route.fulfill({
        status: creations.length === 1 ? 500 : 201,
        json:
          creations.length === 1 ? { message: "Falha ao criar produto" } : { id: "product-new" },
      });
      return;
    }
    if (route.request().method() === "PUT" && path.endsWith("/product-1/unit-config")) {
      const body = route.request().postDataJSON();
      updates.push(body);
      if (body.deliveryPriceCents === 9_999) {
        await route.fulfill({ status: 500, json: { message: "Falha ao salvar preço" } });
      } else {
        prices[0].deliveryPriceCents = body.deliveryPriceCents;
        await route.fulfill({ json: { updated: true } });
      }
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
            : path.endsWith("/management/inventory")
              ? {
                  locations: [],
                  lots: [],
                  recentMovements: [],
                  automation: { pending: 0, failed: 0, lastProcessedAt: null },
                  items: [
                    {
                      id: "inventory-1",
                      name: "Cerveja do estoque",
                      kind: "resale",
                      unit: "un",
                      active: true,
                      productId: null,
                      barcode: "7890000000001",
                      sku: "CERV",
                      purchaseToStockFactor: 24,
                      purchaseUnit: "caixa",
                      leadTimeDays: 1,
                      allowNegative: false,
                      minimumQuantity: 0,
                      reorderQuantity: 0,
                    },
                  ],
                  balances: [
                    { inventoryItemId: "inventory-1", locationId: "location-1", quantity: 24 },
                  ],
                }
              : null;
    await route.fulfill({
      status: payload === null ? 404 : 200,
      json: payload ?? { message: "Sem rota" },
    });
  });
  return { updates, prices, creations };
}

test("Cardápio distingue preços por canal, herança e zero em 375 px e preserva payload e rollback", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const { updates, prices } = await mockCatalogApi(page);
  await page.goto("/#/catalog");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.getByRole("heading", { name: "Cardápio operacional" })).toBeVisible();

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["light", "dark"]) {
      await page
        .locator("html")
        .evaluate((element, value) => element.setAttribute("data-theme", value), theme);
      for (const view of ["Visualização em lista", "Visualização em grade de fotos"]) {
        await page.getByRole("button", { name: view, exact: true }).click();
        const inherited = page.getByLabel("Preços de Cerveja retornável", { exact: true });
        const specific = page.getByLabel("Preços de Refrigerante", { exact: true });
        await expect(inherited).toContainText("Salão / balcão");
        await expect(inherited).toContainText("Delivery");
        await expect(inherited).toContainText("Usa preço do salão");
        await expect(inherited.locator("dd").last()).toContainText(/12,00/);
        await expect(specific.locator("dd").last()).toContainText(/0,00/);
        await expect(specific).toContainText("Preço específico");
        const columns = await inherited
          .locator(":scope > div")
          .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().x));
        expect(columns[1]).toBeGreaterThan(columns[0]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
        const accessibility = await new AxeBuilder({ page })
          .include(".catalog-product-prices")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze();
        expect(accessibility.violations).toEqual([]);
        if (
          view === "Visualização em lista" &&
          ((width === 1440 && theme === "light") || (width === 375 && theme === "dark"))
        ) {
          await page
            .locator(".catalog-product-list")
            .screenshot({ path: testInfo.outputPath(`prices-${width}-${theme}.png`) });
        }
      }
    }
  }

  await page.getByRole("button", { name: "Tabela com edição rápida de preços" }).click();
  const delivery = page.getByRole("textbox", {
    name: "Preço delivery de Cerveja retornável",
    exact: true,
  });
  await delivery.focus();
  await delivery.blur();
  expect(updates).toHaveLength(0);
  await expect(
    page.getByRole("textbox", { name: "Preço delivery de Refrigerante", exact: true }),
  ).toHaveValue("0,00");

  for (const [input, cents] of [
    ["15,00", 1500],
    ["0,00", 0],
    ["", null],
  ] as const) {
    await delivery.fill(input);
    await delivery.blur();
    await expect.poll(() => updates.at(-1)?.deliveryPriceCents).toBe(cents);
    await expect(delivery).toHaveValue(input);
  }
  await delivery.fill("99,99");
  await delivery.blur();
  await expect(page.getByRole("alert")).toHaveClass(/gm-toast--danger/);
  await expect(delivery).toHaveValue("");
  expect(prices[0].deliveryPriceCents).toBeNull();
});

test("Cardápio vincula revenda ao estoque e preserva seleção após falha", async ({
  page,
}, testInfo) => {
  const { creations } = await mockCatalogApi(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/#/catalog");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await page.locator("#new-product-details > summary").click();
  const form = page.locator("#new-product-details form");
  await form.getByRole("button", { name: "Produto de Revenda (Bebidas / Estoque Direto)" }).click();
  await form.getByLabel("Buscar no estoque").fill("CERV");
  const stock = form.getByLabel("Item de estoque");
  await stock.selectOption("inventory-1");
  await expect(form.getByLabel("Nome do Produto", { exact: true })).toHaveValue(
    "Cerveja do estoque",
  );
  await expect(form.getByLabel(/Código de Barras/)).toHaveValue("7890000000001");
  await expect(form.getByText(/Saldo físico: 24 un/)).toBeVisible();
  await expect(form.getByText(/24 un por caixa/)).toBeVisible();
  await page.locator("html").evaluate((element) => element.setAttribute("data-theme", "dark"));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  const controls = await form.locator("input, select, textarea, button").evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length)
      .map((element) => ({
        left: element.getBoundingClientRect().left,
        right: element.getBoundingClientRect().right,
      })),
  );
  for (const control of controls) {
    expect(control.left).toBeGreaterThanOrEqual(0);
    expect(control.right).toBeLessThanOrEqual(375);
  }
  await expect(
    form.getByRole("button", { name: "Produto de Revenda (Bebidas / Estoque Direto)" }),
  ).toHaveCSS("white-space", "normal");
  await form.screenshot({
    path: testInfo.outputPath("new-resale-375-dark.png"),
    style: "header, nav { visibility: hidden !important; }",
  });
  await form.getByLabel("Preço Salão (R$)").fill("12,00");
  await form.getByRole("button", { name: "Bar", exact: true }).click();
  await form.getByRole("button", { name: "Criar produto", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveClass(/gm-toast--danger/);
  await expect(stock).toHaveValue("inventory-1");
  await expect(form.getByLabel("Nome do Produto", { exact: true })).toHaveValue(
    "Cerveja do estoque",
  );
  await form.getByRole("button", { name: "Criar produto", exact: true }).click();
  await expect.poll(() => creations.length).toBe(2);
  expect(creations[1]).toMatchObject({
    inventoryItemId: "inventory-1",
    name: "Cerveja do estoque",
    ean: "7890000000001",
    priceCents: 1200,
    productType: "resale",
  });
  await expect(form.getByLabel("Nome do Produto", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
});

test("Editor do Cardápio preserva delivery zero e contém preços em 375 px", async ({
  page,
}, testInfo) => {
  await mockCatalogApi(page);
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/#/catalog");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await page.locator("html").evaluate((element) => element.setAttribute("data-theme", "dark"));
  await page
    .locator(".catalog-product-card")
    .filter({ hasText: "Refrigerante" })
    .getByRole("button", { name: "Editar Produto & Histórico" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Editar Item: Refrigerante" });
  const prices = dialog.getByRole("group", { name: "Preços por canal" });
  await expect(prices.getByLabel("Preço Delivery (R$)")).toHaveValue("0,00");
  await prices.scrollIntoViewIfNeeded();
  const controls = await prices.locator("input").evaluateAll((elements) =>
    elements.map((element) => ({
      left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
    })),
  );
  for (const control of controls) {
    expect(control.left).toBeGreaterThanOrEqual(0);
    expect(control.right).toBeLessThanOrEqual(375);
  }
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(375);
  await dialog.screenshot({ path: testInfo.outputPath("edit-prices-375-dark.png") });
});
