import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const tab = {
  id: "tab-3",
  tableId: "m03",
  operationalShiftId: null,
  shiftSectionId: null,
  label: "Mesa 03",
  displayNumber: 3,
  fulfillmentType: "dine_in",
  customerName: null,
  customerPhone: null,
  deliveryAddress: null,
  promisedAt: null,
  readyNotifiedAt: null,
  responsibleIdentityId: "identity-1",
  guestCount: 4,
  version: 1,
  status: "open",
  serviceChargeBasisPoints: 1_000,
  tipCents: 0,
  subtotalCents: 26_127,
  discountCents: 0,
  serviceChargeCents: 2_613,
  totalCents: 28_740,
};

const floor = {
  rooms: [
    {
      id: "room-1",
      name: "Salão principal",
      active: true,
      layoutPolygon: null,
    },
  ],
  tables: [
    {
      id: "m01",
      roomId: "room-1",
      label: "Mesa 01",
      seats: 4,
      status: "available",
      layoutX: null,
      layoutY: null,
      active: true,
    },
    {
      id: "m03",
      roomId: "room-1",
      label: "Mesa 03",
      seats: 4,
      status: "occupied",
      layoutX: null,
      layoutY: null,
      active: true,
    },
  ],
  openTabs: [tab],
  tableGroups: [],
  tableGroupMembers: [],
  serviceCalls: [
    {
      id: "call-help-3",
      tableId: "m03",
      tabId: "tab-3",
      kind: "assistance",
      status: "open",
      slaMinutes: 5,
      acknowledgedByIdentityId: null,
      acknowledgedAt: null,
      createdAt: "2026-08-16T11:59:00.000Z",
    },
    {
      id: "call-3",
      tableId: "m03",
      tabId: "tab-3",
      kind: "bill",
      status: "open",
      slaMinutes: 5,
      acknowledgedByIdentityId: null,
      acknowledgedAt: null,
      createdAt: "2026-08-16T12:00:00.000Z",
    },
  ],
  staff: [{ identityId: "identity-1", displayName: "Ana Operação" }],
  serviceMode: "full_service",
  serviceSections: [],
  serviceSectionTables: [],
  activeShift: null,
  shiftSections: [],
  shiftSectionTables: [],
  shiftSectionStaff: [],
  shiftTableLayouts: [],
  shiftTableTransfers: [],
};

const catalog = {
  categories: [{ id: "cat-1", name: "Principais", active: true }],
  stations: [{ id: "station-1", name: "Cozinha", active: true }],
  allergens: [],
  modifierGroups: [
    {
      id: "group-1",
      name: "Ponto da carne",
      minimumSelections: 1,
      maximumSelections: 1,
    },
  ],
  modifierOptions: [],
  products: [
    {
      id: "product-1",
      categoryId: "cat-1",
      sku: null,
      name: "Prato da casa",
      description: null,
      imageUrl: null,
      active: true,
    },
    {
      id: "product-2",
      categoryId: "cat-1",
      sku: null,
      name: "Café Expresso",
      description: null,
      imageUrl: null,
      active: true,
    },
  ],
  prices: [
    { productId: "product-1", priceCents: 4_900 },
    { productId: "product-2", priceCents: 900 },
  ],
  availability: [
    { productId: "product-1", available: true, schedule: null },
    { productId: "product-2", available: true, schedule: null },
  ],
  productStations: [
    { productId: "product-1", stationId: "station-1" },
    { productId: "product-2", stationId: "station-1" },
  ],
  productAllergens: [],
  productModifierGroups: [{ productId: "product-1", groupId: "group-1" }],
  combos: [],
};

async function mockProductionApi(
  page: Page,
  onComboCreate?: (request: { body: unknown; headers: Record<string, string> }) => void,
  onProductUnitUpdate?: (body: unknown) => number | undefined,
  floorPayload: typeof floor | (() => typeof floor) = floor,
  onTableTurnover?: (status: "cleaning" | "available") => void,
) {
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = `${url.pathname}${url.search}`;
    const printJob = (status: "queued" | "printing" | "printed" = "queued") => ({
      id: "print-job-1",
      tabId: "pickup-1",
      documentType: "partial_statement",
      status,
      copies: 1,
      attempts: status === "queued" ? 0 : 1,
      terminalId: null,
      printerId: status === "printed" ? "caixa" : null,
      payload: {
        generatedAt: new Date().toISOString(),
        tab: { label: "Retirada teste" },
        totals: {
          subtotalCents: 9_300,
          discountCents: 0,
          serviceChargeCents: 0,
          tipCents: 0,
          totalCents: 9_300,
          paidCents: 0,
          remainingCents: 9_300,
        },
        items: [],
        payments: [],
      },
      reason: null,
      reprintOfJobId: null,
      lastError: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (route.request().method() === "GET" && url.pathname.endsWith("/print-jobs")) {
      await route.fulfill({ json: [] });
      return;
    }
    if (route.request().method() === "POST" && url.pathname.endsWith("/print-jobs")) {
      await route.fulfill({
        status: 201,
        json: { printJob: printJob() },
      });
      return;
    }
    if (
      route.request().method() === "PUT" &&
      url.pathname.endsWith("/print-jobs/print-job-1/status")
    ) {
      const body = route.request().postDataJSON() as { status: "printing" | "printed" };
      await route.fulfill({ json: { printJob: printJob(body.status) } });
      return;
    }
    if (route.request().method() === "POST" && url.pathname.endsWith("/calls")) {
      await route.fulfill({ status: 201, json: { id: "call-1", status: "open" } });
      return;
    }
    if (route.request().method() === "PUT" && /\/tables\/[^/]+\/turnover$/.test(url.pathname)) {
      const { status } = route.request().postDataJSON() as {
        status: "cleaning" | "available";
      };
      onTableTurnover?.(status);
      await route.fulfill({ json: { status } });
      return;
    }
    if (route.request().method() === "POST" && path.endsWith("/pilot/catalog/combos")) {
      onComboCreate?.({
        body: route.request().postDataJSON(),
        headers: route.request().headers(),
      });
      await route.fulfill({ status: 201, json: { id: "combo-real-1" } });
      return;
    }
    if (
      route.request().method() === "PUT" &&
      path.endsWith("/pilot/catalog/products/product-1/unit-config")
    ) {
      const status = onProductUnitUpdate?.(route.request().postDataJSON()) ?? 200;
      await route.fulfill({
        status,
        json: status < 400 ? { updated: true } : { message: "Falha" },
      });
      return;
    }
    const payload =
      path === "/v1/auth/me"
        ? {
            identity: {
              id: "identity-1",
              email: "ana@giromesa.test",
              displayName: "Ana Operação",
            },
            memberships: [
              {
                membershipId: "membership-1",
                organizationId: "org-1",
                status: "active",
              },
            ],
            platformAdmin: false,
          }
        : path === "/v1/organizations"
          ? [
              {
                membershipId: "membership-1",
                organization: {
                  id: "org-1",
                  tradeName: "Grupo Aurora",
                  document: "12345678000199",
                },
                units: [
                  {
                    id: "unit-1",
                    name: "Matriz real",
                    city: "São Paulo",
                    timezone: "America/Sao_Paulo",
                    active: true,
                  },
                ],
                scopes: [{ role: "manager", unitId: "unit-1" }],
              },
            ]
          : path.endsWith("/pilot/floor")
            ? typeof floorPayload === "function"
              ? floorPayload()
              : floorPayload
            : url.pathname.endsWith("/growth/units/unit-1/reservations")
              ? []
              : url.pathname.endsWith("/growth/units/unit-1/waitlist")
                ? []
                : path.endsWith("/pilot/catalog")
                  ? catalog
                  : path.endsWith("/pilot/tabs/tab-3")
                    ? {
                        tab,
                        orders: [],
                        items: [
                          {
                            id: "item-3",
                            orderId: "order-3",
                            orderStatus: "pending",
                            productName: "Pudim de Leite",
                            quantity: 2,
                            grossCents: 7_600,
                            discountCents: 0,
                            netCents: 7_600,
                            status: "draft",
                            seatNumber: null,
                            course: "dessert",
                            allergyNote: null,
                            notes: null,
                          },
                        ],
                        payments: [],
                        events: [],
                        presence: [],
                      }
                    : path.endsWith("/pilot/tabs")
                      ? [tab]
                      : path.endsWith("/pilot/approval-requests?status=pending")
                        ? []
                        : null;

    if (payload === null) {
      await route.fulfill({ status: 404, json: { message: `Mock ausente para ${path}` } });
      return;
    }
    await route.fulfill({ json: payload });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    scrollX: window.scrollX,
    anchors: [
      ".workspace",
      ".main-content",
      ".page-heading",
      ".salon-shell",
      ".counter-operation",
      ".counter-operation .ops-board",
      ".counter-open-form",
    ].map((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      const rect = element?.getBoundingClientRect();
      const style = element ? getComputedStyle(element) : null;
      return `${selector}:${Math.round(rect?.left ?? 0)}-${Math.round(rect?.right ?? 0)} display=${style?.display} width=${style?.width} min=${style?.minWidth} columns=${style?.gridTemplateColumns}`;
    }),
    offenders: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const parent = element.parentElement;
        const parentRect = parent?.getBoundingClientRect();
        return `${element.tagName.toLowerCase()}.${element.className}:${Math.round(rect.left)}-${Math.round(rect.right)} parent=${parent?.tagName.toLowerCase()}.${parent?.className}:${Math.round(parentRect?.left ?? 0)}-${Math.round(parentRect?.right ?? 0)}`;
      }),
  }));
  expect(dimensions.document, JSON.stringify(dimensions)).toBe(dimensions.viewport);
}

async function expectWcagAa(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(result.violations).toEqual([]);
}

test("Atendimento real mantém estado, contexto e layout nos breakpoints críticos", async ({
  page,
}) => {
  const viewports = [
    { width: 375, height: 667 },
    { width: 412, height: 915 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ];
  await mockProductionApi(page);
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/salon";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Mesas e comandas" })).toBeVisible();
  await expect(page.locator(".real-table").filter({ hasText: "Mesa 03" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Alertas" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Mesas e comandas" })).toBeVisible();
  await expect(page.getByText("Onde você vai trabalhar?")).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Recolher menu lateral" }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/sidebar--collapsed/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("giromesa_sidebar_collapsed")))
    .toBe("true");
  await page.setViewportSize({ width: 375, height: 667 });
  await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/sidebar--open/);
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar--collapsed/);
  await expect(
    page.locator(".sidebar").getByRole("link", { name: "Mesas e comandas" }),
  ).toBeVisible();
  await page.locator(".sidebar").getByRole("button", { name: "Fechar menu" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Expandir menu lateral" }).click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar--collapsed/);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await expectWcagAa(page);
  const requestedBill = page.locator(".real-table").filter({ hasText: "Mesa 03" });
  await expect(requestedBill).toContainText("Pediu a conta");
  await expect(requestedBill).not.toContainText("Livre");
  await requestedBill.click();

  const dialog = page.getByRole("dialog", { name: "Mesa 03" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Online", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/no rascunho/)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Conta", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const firstAccountLine = dialog.locator(".account-line-group").first();
  await firstAccountLine.getByRole("button", { name: /Ações para/ }).click();
  await expect(firstAccountLine.locator(".approval-form--inline")).toContainText("Ajustar item");
  await firstAccountLine.getByRole("button", { name: "Fechar" }).click();
  await dialog.getByRole("button", { name: /^Pedido/ }).click();
  await dialog.getByRole("button", { name: "Adicionar Prato da casa", exact: true }).click();
  const productDialog = page.getByRole("dialog", { name: "Prato da casa" });
  await expect(productDialog.getByLabel("Observação para a produção")).toBeVisible();
  await expect(productDialog.getByText("Pessoa, etapa e restrições")).toBeVisible();
  const quantityWidth = await productDialog
    .locator(".product-customization__quantity")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(quantityWidth).toBeLessThan(150);
  await productDialog.getByRole("button", { name: "Fechar" }).click();
  await expectWcagAa(page);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
    const bounds = await dialog.locator(".gm-modal").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.viewportHeight);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(requestedBill).toBeFocused();
  await requestedBill.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await page.getByRole("button", { name: /Abrir menu do perfil/ }).click();
  await page.getByRole("button", { name: /Tema escuro/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expectNoHorizontalOverflow(page);
  await expectWcagAa(page);
});

test("Equipe assume a limpeza e libera a mesa para o próximo atendimento", async ({ page }) => {
  let tableStatus = "needs_cleaning";
  const currentFloor = () => ({
    ...floor,
    tables: floor.tables.map((table) =>
      table.id === "m01" ? { ...table, status: tableStatus } : table,
    ),
  });
  await mockProductionApi(page, undefined, undefined, currentFloor, (status) => {
    tableStatus = status;
  });
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/salon";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();

  await page.getByRole("button", { name: "Assumir", exact: true }).click();
  await expect(page.getByText("Mesa 01: limpeza assumida.")).toBeVisible();
  await page.getByRole("button", { name: "Liberar mesa", exact: true }).click();
  await expect(page.getByText("Mesa 01: limpeza concluída e mesa liberada.")).toBeVisible();
  expect(tableStatus).toBe("available");
});

test("Balcão real mantém abertura rápida e fila operacional no celular", async ({ page }) => {
  await mockProductionApi(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/counter";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Balcão e retirada" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Nova comanda rápida" })).toBeVisible();
  await expect(page.getByText("Operação atualizada")).toBeVisible();
  await expect(page.getByRole("button", { name: /Em andamento/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.getByText("Prazo e identificação").click();
  await expect(page.getByLabel("Data")).toHaveAttribute("type", "date");
  await expect(page.getByLabel("Telefone")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectWcagAa(page);
});

test("Recepção real mantém estados vazios compactos e orientados à próxima ação", async ({
  page,
}, testInfo) => {
  await mockProductionApi(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/reservations";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Recepção e espera" })).toBeVisible();
  const cards = page.locator(".reservations-card");
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    const bounds = await card.boundingBox();
    expect(bounds?.height ?? Number.POSITIVE_INFINITY).toBeLessThan(220);
  }
  const receptionScreenshot = testInfo.outputPath("recepcao-vazia-1440.png");
  await page.screenshot({ path: receptionScreenshot });
  await testInfo.attach("recepcao-vazia-1440", {
    contentType: "image/png",
    path: receptionScreenshot,
  });

  const createReservation = cards
    .filter({ has: page.getByRole("heading", { level: 2, name: "Reservas" }) })
    .getByRole("button", { name: "Criar reserva" });
  await createReservation.click();
  await expect(page.locator("#reservation-composer")).toHaveAttribute("open", "");
  await expect(page.locator("#reservation-composer input").first()).toBeFocused();

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalOverflow(page);
  await expectWcagAa(page);
});

test("Balcão recebe, imprime pré-conta sem mesa e não pisca a confirmação", async ({ page }) => {
  const pickupTab = {
    ...tab,
    id: "pickup-1",
    tableId: null,
    label: "Retirada teste",
    displayNumber: 8,
    fulfillmentType: "pickup",
    customerName: "José",
    guestCount: 1,
    serviceChargeBasisPoints: 0,
    subtotalCents: 9_300,
    serviceChargeCents: 0,
    totalCents: 9_300,
  };
  await page.addInitScript(() => {
    window.HybridWebView = {
      SendRawMessage: () => undefined,
      InvokeDotNet: async (method: string) =>
        method === "SendPrintJobAsync"
          ? {
              Success: true,
              Status: "accepted",
              PrinterId: "caixa",
              Duplicate: false,
            }
          : null,
    };
  });
  await mockProductionApi(page);
  await page.route("**/pilot/tabs**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      json: pathname.endsWith("/pilot/tabs")
        ? [pickupTab]
        : { tab: pickupTab, orders: [], items: [], payments: [], events: [], presence: [] },
    });
  });
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/counter";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => {
    localStorage.setItem(
      "gm:attendance:draft:unit-1:pickup-1",
      JSON.stringify([
        {
          id: "draft-1",
          productId: "product-1",
          name: "Salada Giro com descrição extensa",
          quantity: 1,
          modifierOptionIds: [],
        },
      ]),
    );
  });
  await page.getByRole("button", { name: /Retirada teste/ }).click();

  await expect(page.getByText("Operação atualizada")).toBeVisible();
  await expect(page.getByText("Sincronizando")).toHaveCount(0);
  const cartToggle = page.getByRole("button", { name: /Comanda/ });
  await expect(cartToggle).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Adicionar Café Expresso", exact: true }).click();
  await expect(cartToggle).toHaveAttribute("aria-expanded", "false");
  await cartToggle.click();
  await expect(page.getByRole("button", { name: /Enviar 2 item/ })).toBeVisible();
  const cartHeight = await page
    .locator(".cart-preview")
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(cartHeight).toBeLessThanOrEqual(812 * 0.55);
  await expectNoHorizontalOverflow(page);
  await cartToggle.click();
  await page.getByRole("button", { name: "Receber", exact: true }).click();
  const amount = page.getByLabel("Valor a receber");
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue("93");

  const printAccount = page.getByRole("button", { name: "Imprimir pré-conta", exact: true });
  await expect(printAccount).toBeEnabled();
  await printAccount.click();
  await expect(page.getByText("Entregue à impressora", { exact: true })).toBeVisible();
  await expect(page.getByText(/Não fecha a comanda e não registra pagamento/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Recepção senta em mesa compatível e abre a comanda na mesma requisição", async ({ page }) => {
  const seatedRequests: unknown[] = [];
  const reservation = {
    id: "00000000-0000-4000-8000-000000000010",
    guestName: "Maria Reserva",
    guestPhone: "+5511999999999",
    partySize: 4,
    scheduledAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    durationMinutes: 120,
    status: "confirmed",
    notes: null,
    updatedAt: new Date().toISOString(),
  };
  await mockProductionApi(page);
  await page.route("**/growth/units/unit-1/reservations**", async (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    await route.fulfill({ json: scope === "history" ? [] : [reservation] });
  });
  await page.route("**/growth/units/unit-1/waitlist**", (route) => route.fulfill({ json: [] }));
  await page.route("**/pilot/tabs/open", async (route) => {
    seatedRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 201,
      json: { tab: { ...tab, id: "seated-tab", tableId: "m01" } },
    });
  });

  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/reservations";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  const reservationRow = page.locator(".data-row").filter({ hasText: "Maria Reserva" }).first();
  await reservationRow.getByRole("button", { name: "Sentar" }).click();
  const modal = page.getByRole("dialog", { name: "Sentar Maria Reserva" });
  await modal.getByLabel("Mesa compatível").selectOption("m01");
  await modal.getByRole("button", { name: "Ocupar mesa e abrir comanda" }).click();

  await expect(page.getByText("Mesa ocupada e comanda aberta para Maria Reserva.")).toBeVisible();
  expect(seatedRequests).toEqual([
    expect.objectContaining({
      tableId: "m01",
      reservationId: reservation.id,
      guestCount: 4,
    }),
  ]);
});

test("Cardápio real mantém a interface completa e as integrações reais", async ({
  page,
}) => {
  const requests: Array<{ body: unknown; headers: Record<string, string> }> = [];
  const priceUpdates: unknown[] = [];
  await mockProductionApi(
    page,
    (request) => requests.push(request),
    (body) => {
      priceUpdates.push(body);
      return 500;
    },
  );
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/catalog";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.getByRole("heading", { name: "Gerenciar Cardápio" })).toBeVisible();
  for (const unsupportedAction of [
    "Matriz BCG",
    "Ver como Cliente & QR",
    "Opcionais & Modificadores",
    "Importar CSV",
    "Planilha CSV",
    "Identidade & Branding",
    "Gerar PDF / Imprimir",
    "Reordenar Categorias",
    "Reajuste em Lote",
    "Placas QR de Mesas",
  ]) {
    await expect(page.getByText(unsupportedAction, { exact: false }).first()).toBeVisible();
  }
  for (const availableButton of [
    "Matriz BCG",
    "Ver como Cliente & QR",
    "Opcionais & Modificadores",
    "Planilha CSV",
    "Identidade & Branding",
    "Gerar PDF / Imprimir",
    "Reordenar Categorias",
    "Reajuste em Lote",
    "Placas QR de Mesas",
  ]) {
    await expect(page.getByRole("button", { name: new RegExp(availableButton) })).toBeEnabled();
  }
  await expect(page.locator('.catalog-management-header__import input[type="file"]')).toBeEnabled();
  await expect(page.getByText("Filtro de Dieta & Segurança:")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sem Glúten" })).toBeEnabled();
  const modifierPill = page.getByRole("button", { name: /1 opcionais/ });
  await expect(modifierPill).toHaveCSS("border-radius", "999px");

  await page.locator("#new-product-details > summary").click();
  await expect(page.getByRole("button", { name: "Produto Preparado / Cozinha" })).toBeEnabled();
  await expect(page.getByLabel("Preço Delivery (Opcional)")).toBeEnabled();
  await expect(page.getByLabel("Custo Unitário / Insumos (R$)")).toBeEnabled();
  await expect(page.getByLabel("Foto do Prato (Opcional)")).toBeEnabled();
  await expect(page.getByText("Dados Fiscais para NFC-e / SAT")).toBeVisible();
  await page.locator("#new-product-details > summary").click();

  await page.getByRole("button", { name: "Tabela com edição rápida de preços" }).click();
  const quickPrice = page.locator(".catalog-quick-price input").first();
  await quickPrice.fill("55,00");
  await quickPrice.blur();
  await expect.poll(() => priceUpdates.length).toBe(1);
  await expect(quickPrice).toHaveValue("49,00");
  await expect(page.getByRole("alert")).toHaveClass(/gm-toast--danger/);
  expect(priceUpdates[0]).toEqual({
    availabilitySchedule: null,
    available: true,
    priceCents: 5_500,
    stationIds: ["station-1"],
  });

  await page.getByRole("button", { name: /Combos & Promoções \(0\)/ }).click();

  const dialog = page.getByRole("dialog", {
    name: "Gestão de Combos & Promoções de Horário",
  });
  await expect(dialog.getByRole("button", { name: "Promoções & Happy Hour" })).toBeVisible();
  await dialog.getByLabel("Nome do combo").fill("Combo real");
  await dialog.getByLabel("Preço promocional do combo").fill("39,90");
  await dialog.getByRole("button", { name: /Prato da casa/ }).click();
  await dialog.getByRole("button", { name: "Salvar Combo" }).click();

  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    body: {
      active: true,
      items: [{ productId: "product-1", quantity: 1 }],
      name: "Combo real",
      priceCents: 3_990,
    },
  });
  expect(requests[0]?.headers["idempotency-key"]).toMatch(/.{8,160}/);
  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalOverflow(page);
});
