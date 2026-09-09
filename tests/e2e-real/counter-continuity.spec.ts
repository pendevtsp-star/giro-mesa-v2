import { expect, type Page, test } from "@playwright/test";

const organizationId = "org-counter";
const unitId = "unit-counter";
const tab = {
  id: "tab-counter",
  tableId: null,
  operationalShiftId: null,
  shiftSectionId: null,
  label: "Retirada continuidade",
  displayNumber: 12,
  fulfillmentType: "pickup",
  customerName: null,
  customerPhone: null,
  deliveryAddress: null,
  promisedAt: null,
  readyNotifiedAt: null,
  responsibleIdentityId: "identity-counter",
  guestCount: 1,
  version: 1,
  status: "open",
  serviceChargeBasisPoints: 0,
  tipCents: 0,
  subtotalCents: 0,
  discountCents: 0,
  serviceChargeCents: 0,
  totalCents: 0,
};

type CreateBehavior = "timeout-once" | "permanent";
type CounterCalls = { createKeys: string[]; sendKeys: string[] };

async function mockCounterApi(page: Page, behavior: CreateBehavior, calls: CounterCalls) {
  const acceptedCreateKeys = new Set<string>();
  await page.route("**/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        version: "2.0.0",
        buildSha: "counter-continuity-e2e",
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
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = `${url.pathname}${url.search}`;
    if (request.method() === "GET" && path === "/v1/auth/terminal-session") {
      await route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_REQUIRED" } });
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith(`/tabs/${tab.id}/orders`)) {
      const key = request.headers()["idempotency-key"];
      calls.createKeys.push(key);
      if (behavior === "permanent") {
        await route.fulfill({
          status: 422,
          json: { code: "PRODUCT_UNAVAILABLE", message: "Produto indisponível." },
        });
        return;
      }
      if (!acceptedCreateKeys.has(key)) {
        acceptedCreateKeys.add(key);
        await route.fulfill({ status: 503, json: { code: "API_UNAVAILABLE", message: "Timeout" } });
        return;
      }
      await route.fulfill({ json: { order: { id: "order-continuity" } } });
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/orders/order-continuity/send")) {
      calls.sendKeys.push(request.headers()["idempotency-key"]);
      await route.fulfill({ json: { order: { id: "order-continuity", status: "sent" } } });
      return;
    }
    const payload =
      path === "/v1/auth/me"
        ? {
            identity: {
              id: "identity-counter",
              email: "counter@giromesa.test",
              displayName: "Caixa Continuidade",
            },
            memberships: [{ membershipId: "membership-counter", organizationId, status: "active" }],
            platformAdmin: false,
          }
        : path === "/v1/organizations"
          ? [
              {
                membershipId: "membership-counter",
                organization: {
                  id: organizationId,
                  tradeName: "GiroMesa Continuidade",
                  document: "12345678000199",
                },
                units: [
                  {
                    id: unitId,
                    name: "Unidade Continuidade",
                    city: "São Paulo",
                    timezone: "America/Sao_Paulo",
                    active: true,
                  },
                ],
                scopes: [{ role: "cashier", unitId }],
              },
            ]
          : url.pathname.endsWith("/pilot/counter-queue")
            ? {
                items: [{ ...tab, queueStage: "new" }],
                counts: {
                  all: 1,
                  new: 1,
                  production: 0,
                  ready: 0,
                  waiting: 0,
                  delivered: 0,
                  late: 0,
                },
                pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
              }
            : url.pathname.endsWith("/pilot/floor")
              ? {
                  floorRevision: 1,
                  rooms: [],
                  tables: [],
                  openTabs: [tab],
                  tableGroups: [],
                  tableGroupMembers: [],
                  serviceCalls: [],
                  tablePhases: [],
                  staff: [{ identityId: "identity-counter", displayName: "Caixa Continuidade" }],
                  serviceMode: "counter_service",
                  serviceSections: [],
                  serviceSectionTables: [],
                  activeShift: null,
                  shiftSections: [],
                  shiftSectionTables: [],
                  shiftSectionStaff: [],
                  shiftTableLayouts: [],
                  shiftTableTransfers: [],
                }
              : url.pathname.endsWith("/pilot/catalog")
                ? {
                    categories: [{ id: "category-1", name: "Balcão", active: true }],
                    stations: [{ id: "station-1", name: "Cozinha", active: true }],
                    allergens: [],
                    modifierGroups: [],
                    modifierOptions: [],
                    products: [
                      {
                        id: "product-espresso",
                        categoryId: "category-1",
                        sku: null,
                        name: "Café Continuidade",
                        description: null,
                        imageUrl: null,
                        active: true,
                      },
                    ],
                    prices: [{ productId: "product-espresso", priceCents: 900 }],
                    availability: [
                      { productId: "product-espresso", available: true, schedule: null },
                    ],
                    productStations: [{ productId: "product-espresso", stationId: "station-1" }],
                    productAllergens: [],
                    productModifierGroups: [],
                    combos: [],
                  }
                : url.pathname.endsWith(`/pilot/tabs/${tab.id}`)
                  ? { tab, orders: [], items: [], payments: [], events: [], presence: [] }
                  : url.pathname.endsWith("/pilot/tabs")
                    ? [tab]
                    : path.startsWith(`/v1/organizations/${organizationId}/growth/customers/page`)
                      ? { items: [] }
                      : url.pathname.endsWith("/pilot/approval-requests?status=pending")
                        ? []
                        : null;
    if (payload === null) {
      await route.fulfill({ status: 404, json: { message: `Mock ausente para ${path}` } });
      return;
    }
    await route.fulfill({ json: payload });
  });
}

async function openCounter(page: Page) {
  await page.goto(`/#/counter?tab=${tab.id}`);
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(
    page.getByRole("button", { name: "Adicionar Café Continuidade", exact: true }),
  ).toBeVisible();
}

async function addAndSend(page: Page) {
  await page.getByRole("button", { name: "Adicionar Café Continuidade", exact: true }).click();
  await page.getByRole("button", { name: /Enviar 1 item/ }).click();
}

test("retoma após timeout e recarga com a mesma idempotência", async ({ page }) => {
  const calls: CounterCalls = { createKeys: [], sendKeys: [] };
  await mockCounterApi(page, "timeout-once", calls);
  await openCounter(page);
  await addAndSend(page);
  await expect(
    page.getByRole("alert").filter({ hasText: /ficou salva neste dispositivo/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retomar envio do pedido" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Retomar envio do pedido" })).toBeVisible();
  await page.getByRole("button", { name: "Retomar envio do pedido" }).click();
  await expect(page.getByText("Pedido enviado à produção.")).toBeVisible();

  expect(calls.createKeys.length).toBeGreaterThanOrEqual(2);
  expect(new Set(calls.createKeys)).toEqual(new Set([calls.createKeys[0]]));
  expect(calls.sendKeys).toHaveLength(1);
});

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
}

test("retorna a fila preservando rascunho, filtros, foco e tema", async ({ page }) => {
  test.setTimeout(60_000);
  const calls: CounterCalls = { createKeys: [], sendKeys: [] };
  await mockCounterApi(page, "timeout-once", calls);
  await page.goto(`/#/counter?stage=new&channel=pickup&query=coffee&tab=${tab.id}`);
  await page.getByRole("button", { name: "Abrir opera\u00e7\u00e3o" }).click();

  const panel = page.locator("#counter-order-panel");
  await expect(panel).toBeVisible();
  await page.getByRole("button", { name: "Adicionar Caf\u00e9 Continuidade", exact: true }).click();
  const draft = page.getByRole("complementary", { name: "Rascunho do pedido" });
  await expect(draft).toContainText("Caf\u00e9 Continuidade");
  await expect(page.getByRole("button", { name: /Enviar 1 item/ })).toBeVisible();
  expect(calls.createKeys).toHaveLength(0);
  expect(calls.sendKeys).toHaveLength(0);

  const viewports = [
    { width: 360, height: 760 },
    { width: 375, height: 812 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 },
  ];
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate((nextTheme) => {
      document.documentElement.dataset.theme = nextTheme;
    }, theme);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
      const close = page.getByRole("button", { name: "Voltar para a fila", exact: true });
      const closeBounds = await panel.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        const closeButton = element.querySelector<HTMLElement>(".counter-workspace-close");
        const rect = closeButton?.getBoundingClientRect();
        return {
          bottom: rect?.bottom ?? 0,
          height: rect?.height ?? 0,
          top: rect?.top ?? 0,
          viewport: window.innerHeight,
        };
      });
      await expect(close).toBeVisible();
      expect(closeBounds.height).toBeGreaterThan(0);
      expect(closeBounds.top).toBeGreaterThanOrEqual(-1);
      expect(closeBounds.bottom).toBeLessThanOrEqual(closeBounds.viewport + 1);
      await close.click();
      await expect(panel).toHaveCount(0);
      await expect(page).toHaveURL(/#\/counter\?stage=new&channel=pickup&query=coffee$/);

      const reopen = page.getByRole("button", { name: "Ver pedido", exact: true });
      await expect(reopen).toBeVisible();
      await reopen.click();
      await expect(panel).toBeVisible();
      await expect(draft).toContainText("Caf\u00e9 Continuidade");
      await expect(page).toHaveURL(
        /#\/counter\?stage=new&channel=pickup&query=coffee&tab=tab-counter$/,
      );
    }
  }

  const more = panel.locator(".workspace-tabs__more");
  await more.locator("summary").click();
  await expect(more).toHaveAttribute("open", "");
  await page.keyboard.press("Escape");
  await expect(more).not.toHaveAttribute("open", "");
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(
    /#\/counter\?stage=new&channel=pickup&query=coffee&tab=tab-counter$/,
  );

  const returnFocus = page.getByRole("button", { name: "Ver pedido", exact: true });
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(/#\/counter\?stage=new&channel=pickup&query=coffee$/);
  await expect(returnFocus).toBeFocused();
  expect(calls.createKeys).toHaveLength(0);
  expect(calls.sendKeys).toHaveLength(0);
});

test("libera o rascunho quando a API rejeita a criação definitivamente", async ({ page }) => {
  const calls: CounterCalls = { createKeys: [], sendKeys: [] };
  await mockCounterApi(page, "permanent", calls);
  await openCounter(page);
  await addAndSend(page);

  await expect(
    page.getByText("O pedido não foi salvo. Ajuste o rascunho e tente novamente."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retomar envio do pedido" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Remover Café Continuidade" })).toBeEnabled();
  await expect(page.getByText("O pedido ainda não foi confirmado.")).toHaveCount(0);
  expect(calls.createKeys).toHaveLength(1);
  expect(calls.sendKeys).toHaveLength(0);
});
