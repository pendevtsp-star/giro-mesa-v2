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

type CreateBehavior = "timeout-once" | "permanent" | "stock-warning";
type CounterCalls = { createKeys: string[]; sendKeys: string[] };

async function mockCounterApi(
  page: Page,
  behavior: CreateBehavior,
  calls: CounterCalls,
  role: "manager" | "cashier" = "cashier",
) {
  const acceptedCreateKeys = new Set<string>();
  await page.route("**/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        version: "2.0.0",
        buildSha: "counter-continuity-e2e",
        schemaVersion: 84,
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
      if (behavior === "timeout-once" && !acceptedCreateKeys.has(key)) {
        acceptedCreateKeys.add(key);
        await route.fulfill({ status: 503, json: { code: "API_UNAVAILABLE", message: "Timeout" } });
        return;
      }
      await route.fulfill({ json: { order: { id: "order-continuity" } } });
      return;
    }
    if (request.method() === "POST" && url.pathname.endsWith("/orders/order-continuity/send")) {
      calls.sendKeys.push(request.headers()["idempotency-key"]);
      if (
        behavior === "stock-warning" &&
        request.postDataJSON()?.acknowledgeInventoryShortage !== true
      ) {
        await route.fulfill({
          status: 409,
          json: {
            code: "INVENTORY_SHORTAGE_CONFIRMATION_REQUIRED",
            products: [{ id: "product-espresso", name: "Café Continuidade" }],
          },
        });
        return;
      }
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
                scopes: [{ role, unitId }],
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
                  ? {
                      tab: { ...tab, subtotalCents: 900, totalCents: 900 },
                      orders: [
                        {
                          id: "order-existing",
                          status: "sent",
                          createdAt: "2026-09-17T12:00:00.000Z",
                        },
                      ],
                      items: [
                        {
                          id: "item-existing",
                          orderId: "order-existing",
                          productId: "product-espresso",
                          productName: "Café Continuidade",
                          quantity: 1,
                          grossCents: 900,
                          discountCents: 0,
                          netCents: 900,
                          status: "sent",
                        },
                      ],
                      payments: [],
                      events: [],
                      presence: [],
                    }
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
  if (!(await page.getByRole("button", { name: /Enviar 1 item/ }).isVisible())) {
    await page.getByRole("button", { name: /Comanda 1 item/ }).click();
  }
  await page.getByRole("button", { name: /Enviar 1 item/ }).click();
}

test("atalho de nova comanda foca o formulário sem enviar e preserva o alvo existente", async ({
  page,
}) => {
  const calls: CounterCalls = { createKeys: [], sendKeys: [] };
  const postRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/v1/")) {
      postRequests.push(request.url());
    }
  });
  await mockCounterApi(page, "timeout-once", calls);
  await page.goto("/#/counter?action=new");
  await page.getByRole("button", { name: "Abrir operação" }).click();

  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/#/counter?action=new");
    const firstField = page
      .locator(".counter-open-form")
      .getByRole("combobox", { name: /^Atendimento/ });
    await expect(firstField).toBeFocused();
    await expect(firstField).toBeInViewport();
    await expect(page).toHaveURL(/#\/counter$/);
  }

  await page.goto(`/#/counter?action=new&tab=${tab.id}&paymentAttempt=attempt-counter`);
  await expect(page.getByRole("button", { name: "Voltar para a fila" })).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`#\\/counter\\?tab=${tab.id}&paymentAttempt=attempt-counter$`),
  );
  expect(postRequests).toEqual([]);
  expect(calls.createKeys).toEqual([]);
  expect(calls.sendKeys).toEqual([]);
});

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

test("avisa estoque sem expor dados internos e envia somente após confirmação em 375 px", async ({
  page,
}, testInfo) => {
  const calls: CounterCalls = { createKeys: [], sendKeys: [] };
  await mockCounterApi(page, "stock-warning", calls);
  await page.setViewportSize({ width: 375, height: 850 });
  await openCounter(page);
  await addAndSend(page);
  const warning = page.getByRole("dialog", { name: "Conferir estoque" });
  await expect(warning).toContainText("Café Continuidade");
  await expect(warning).toContainText("ficará registrada");
  expect(calls.sendKeys).toHaveLength(1);
  await expectNoHorizontalOverflow(page);
  await warning.screenshot({ path: testInfo.outputPath("stock-warning-375.png") });
  await warning.getByRole("button", { name: "Lançar mesmo assim" }).click();
  await expect(warning).not.toBeVisible();
  await expect(page.getByText("Pedido enviado à produção.")).toBeVisible();
  expect(calls.sendKeys).toHaveLength(2);
  expect(calls.sendKeys[0]).toBe(calls.sendKeys[1]);
  expect(calls.createKeys).toHaveLength(1);
});

test("voltar do aviso de estoque não envia nem duplica o pedido", async ({ page }) => {
  const calls: CounterCalls = { createKeys: [], sendKeys: [] };
  await mockCounterApi(page, "stock-warning", calls);
  await openCounter(page);
  await addAndSend(page);
  const warning = page.getByRole("dialog", { name: "Conferir estoque" });
  await warning.getByRole("button", { name: "Voltar ao pedido" }).click();
  await expect(warning).not.toBeVisible();
  await expect(
    page.getByText("Pedido não enviado. Confira os itens antes de lançar."),
  ).toBeVisible();
  expect(calls.sendKeys).toHaveLength(1);
  expect(calls.createKeys).toHaveLength(1);
});

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.viewport);
}

async function expectControlsContained(page: Page, selector: string) {
  const bounds = await page.locator(selector).evaluate((container) => {
    const boundary = container.getBoundingClientRect();
    return [
      ...container.querySelectorAll<HTMLElement>(
        "input, select, button, summary, .counter-notification-consent",
      ),
    ]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden";
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          name:
            element.getAttribute("aria-label") ?? element.textContent?.trim() ?? element.tagName,
          left: rect.left - boundary.left,
          right: rect.right - boundary.left,
          width: rect.width,
          containerWidth: boundary.width,
        };
      });
  });
  for (const control of bounds) {
    expect(control.width, control.name).toBeGreaterThan(0);
    expect(control.left, control.name).toBeGreaterThanOrEqual(-1);
    expect(control.right, control.name).toBeLessThanOrEqual(control.containerWidth + 1);
  }
}

test("mantém os campos da abertura contidos na coluna operacional estreita", async ({ page }) => {
  const calls: CounterCalls = { createKeys: [], sendKeys: [] };
  await mockCounterApi(page, "timeout-once", calls);
  await page.setViewportSize({ width: 1280, height: 900 });
  await openCounter(page);

  const advanced = page.locator(".counter-open-advanced");
  const openCardWidth = await page
    .locator(".counter-quick-open-card")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(openCardWidth).toBeLessThan(600);
  await advanced.locator("summary").click();
  await expect(advanced).toHaveAttribute("open", "");
  await expectControlsContained(page, ".counter-open-advanced > div");
  await expectNoHorizontalOverflow(page);
});

test("troca de painel preserva cabeçalho e deixa o fim de cada fluxo alcançável", async ({
  page,
}, testInfo) => {
  const calls: CounterCalls = { createKeys: [], sendKeys: [] };
  await mockCounterApi(page, "timeout-once", calls, "manager");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openCounter(page);

  const panel = page.locator("#counter-order-panel");
  const tabs = page.getByRole("navigation", { name: "Ações do atendimento" });
  const orderTab = tabs.getByRole("button", { name: "Lançar pedido" });
  const accountTab = tabs.getByRole("button", { name: "Conta e pagamento" });
  await page.getByRole("button", { name: "Adicionar Café Continuidade", exact: true }).click();
  await expect(orderTab).toHaveAttribute("aria-current", "page");

  await page.screenshot({
    path: testInfo.outputPath("counter-order-desktop-light.png"),
    fullPage: false,
  });

  await panel.locator(".service-workspace").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const orderEnd = await panel.locator(".service-action-dock").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { bottom: rect?.bottom ?? 0, height: rect?.height ?? 0, viewport: window.innerHeight };
  });
  expect(orderEnd.height).toBeGreaterThan(0);
  expect(orderEnd.bottom).toBeLessThanOrEqual(orderEnd.viewport + 1);

  await accountTab.click();
  await expect(accountTab).toHaveAttribute("aria-current", "page");
  const account = page.getByRole("region", { name: /Conta de Retirada continuidade/ });
  await expect(account).toBeVisible();
  const accountGeometry = await page.evaluate(() => {
    const tabs = document.querySelector<HTMLElement>(".service-workspace-actions");
    const account = document.querySelector<HTMLElement>(".service-account-area");
    const charges = [...document.querySelectorAll<HTMLElement>(".account-disclosure")].find(
      (element) => element.textContent?.includes("Taxa de serviço e gorjeta"),
    );
    const tabRect = tabs?.getBoundingClientRect();
    const accountRect = account?.getBoundingClientRect();
    const chargeRect = charges?.getBoundingClientRect();
    return {
      accountTop: accountRect?.top ?? 0,
      accountHeight: accountRect?.height ?? 0,
      chargesTop: chargeRect?.top ?? 0,
      chargesPreviousGap:
        chargeRect && charges?.previousElementSibling instanceof HTMLElement
          ? chargeRect.top - charges.previousElementSibling.getBoundingClientRect().bottom
          : Number.NaN,
      tabsBottom: tabRect?.bottom ?? 0,
      viewport: window.innerHeight,
    };
  });
  expect(accountGeometry.accountTop).toBeGreaterThanOrEqual(accountGeometry.tabsBottom - 1);
  expect(accountGeometry.accountHeight).toBeGreaterThan(0);
  expect(accountGeometry.chargesPreviousGap).toBeLessThanOrEqual(24);
  await page.screenshot({
    path: testInfo.outputPath("counter-account-desktop-light.png"),
    fullPage: false,
  });
  await page.locator("html").evaluate((element) => element.setAttribute("data-theme", "dark"));
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("counter-account-desktop-dark.png"),
    fullPage: false,
  });
  const chargeDisclosure = page
    .locator(".account-disclosure")
    .filter({ hasText: "Taxa de serviço e gorjeta" });
  await chargeDisclosure.locator("summary").click();
  await chargeDisclosure.scrollIntoViewIfNeeded();
  await expectControlsContained(page, ".account-charge-grid");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("counter-charges-desktop-dark.png"),
    fullPage: false,
  });
  await accountTab.focus();
  await page.keyboard.press("/");
  await expect(orderTab).toHaveAttribute("aria-current", "page");
  await expect(page.getByPlaceholder("Buscar produto ou descrição")).toBeFocused();
  await page.setViewportSize({ width: 375, height: 812 });
  await orderTab.click();
  await expect(orderTab).toHaveAttribute("aria-current", "page");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("counter-order-mobile-dark.png"),
    fullPage: false,
  });
});

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
      await panel.locator(".service-workspace").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await expect(close).toBeVisible();
      const closeBounds = await close.boundingBox();
      expect(closeBounds?.y ?? -1).toBeGreaterThanOrEqual(0);
      expect((closeBounds?.y ?? 0) + (closeBounds?.height ?? 0)).toBeLessThanOrEqual(
        viewport.height + 1,
      );
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
