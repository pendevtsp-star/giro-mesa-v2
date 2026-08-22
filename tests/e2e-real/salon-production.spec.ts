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
    if (route.request().method() === "GET" && path === "/v1/auth/terminal-session") {
      await route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_INVALID" } });
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
  await expect(page.getByRole("button", { name: "Abrir menu", exact: true })).toBeHidden();
  await page.getByTitle("Ir para módulo (Ctrl+K)").click();
  const commandDialog = page.getByRole("dialog", { name: "Ir para módulo" });
  await expect(commandDialog).toBeVisible();
  await expect(commandDialog.locator(".command-palette__result").first()).toHaveCSS(
    "display",
    "grid",
  );
  await expect(commandDialog.getByRole("searchbox")).toHaveCSS("border-top-width", "0px");
  await expect(commandDialog).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await commandDialog.getByRole("button", { name: "Fechar" }).click();
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
  const arrivalBar = page.locator(".arrival-bar");
  const arrivalSearch = arrivalBar.locator(".gm-search-field");
  const arrivalDate = page.getByLabel("Agenda do dia");
  const newReservation = arrivalBar.getByRole("button", { name: "Nova reserva" });
  await expect(arrivalBar).toHaveCSS("display", "grid");
  await expect(page.getByRole("searchbox", { name: "Buscar chegada" })).toBeVisible();
  const desktopSearch = await arrivalSearch.boundingBox();
  const desktopDate = await arrivalDate.boundingBox();
  const desktopAction = await newReservation.boundingBox();
  expect(Math.abs((desktopSearch?.y ?? 0) - (desktopDate?.y ?? 0))).toBeLessThan(3);
  expect(
    Math.abs(
      (desktopDate?.y ?? 0) +
        (desktopDate?.height ?? 0) -
        ((desktopAction?.y ?? 0) + (desktopAction?.height ?? 0)),
    ),
  ).toBeLessThan(3);

  await page.setViewportSize({ width: 768, height: 900 });
  const tabletSearch = await arrivalSearch.boundingBox();
  const tabletDate = await arrivalDate.boundingBox();
  expect(tabletDate?.y ?? 0).toBeGreaterThan((tabletSearch?.y ?? 0) + (tabletSearch?.height ?? 0));
  await expectNoHorizontalOverflow(page);

  await page.setViewportSize({ width: 1440, height: 900 });
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

test("Balcão cobra no SmartPOS, imprime pré-conta e não duplica cartão manual", async ({
  page,
}) => {
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
    const smartPosWindow = window as Window & { smartPosStartArgs?: unknown[] };
    window.HybridWebView = {
      SendRawMessage: () => {
        window.dispatchEvent(
          new CustomEvent("HybridWebViewMessageReceived", {
            detail: {
              message: JSON.stringify({
                type: "shell.context",
                payload: {
                  DeviceId: "00000000-0000-4000-8000-000000000111",
                  DeviceName: "SmartPOS teste",
                  Platform: "android",
                },
              }),
            },
          }),
        );
      },
      InvokeDotNet: async (method: string, args?: unknown[]) => {
        if (method === "SendPrintJobAsync") {
          return {
            Success: true,
            Status: "accepted",
            PrinterId: "caixa",
            Duplicate: false,
          };
        }
        if (method === "StartPaymentAsync") {
          smartPosWindow.smartPosStartArgs = args;
          return {
            Success: true,
            Launched: true,
            Status: "processing",
            AttemptId: "attempt-1",
            ProviderReference: null,
            ErrorCode: null,
            RequiresReconciliation: false,
          };
        }
        if (method === "GetPaymentCapabilitiesAsync") {
          return {
            Available: true,
            Configured: true,
            Homologated: true,
            Provider: "rede",
            Environment: "production",
            Methods: ["credit_card", "debit_card", "pix"],
            CanStart: true,
            CanRecover: true,
            CanCancel: true,
            PendingAttemptId: null,
            ErrorCode: null,
          };
        }
        return { Success: false, ErrorCode: "TEST_NATIVE_CACHE_UNAVAILABLE" };
      },
    };
  });
  await mockProductionApi(page);
  const paymentAttempt = {
    id: "attempt-1",
    tabId: "pickup-1",
    installationId: "00000000-0000-4000-8000-000000000111",
    provider: "rede",
    method: "debit_card",
    amountCents: 9_300,
    installments: 1,
    status: "processing",
    providerReference: null,
    failureCode: null,
    failureMessage: null,
    expiresAt: "2026-08-21T17:10:00.000Z",
    processingAt: "2026-08-21T17:00:01.000Z",
    resolvedAt: null,
    createdAt: "2026-08-21T17:00:00.000Z",
    updatedAt: "2026-08-21T17:00:01.000Z",
  };
  let paymentRequest: { body: unknown; headers: Record<string, string> } | null = null;
  await page.route("**/pilot/**payment-**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/payment-capabilities")) {
      await route.fulfill({
        json: {
          installationId: paymentAttempt.installationId,
          available: true,
          status: "homologated",
          provider: "rede",
          methods: ["credit_card", "debit_card", "pix"],
          maxInstallments: 12,
          supports: { cancel: true, recover: true, reversal: true },
          reason: null,
        },
      });
      return;
    }
    if (route.request().method() === "POST" && url.pathname.endsWith("/payment-attempts")) {
      paymentRequest = {
        body: route.request().postDataJSON(),
        headers: route.request().headers(),
      };
      await route.fulfill({
        status: 201,
        json: {
          attempt: paymentAttempt,
          action: { type: "start", attemptId: paymentAttempt.id, provider: "rede" },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        attempt: {
          ...paymentAttempt,
          status: "approved",
          providerReference: "rede-test-1",
          resolvedAt: "2026-08-21T17:00:03.000Z",
          updatedAt: "2026-08-21T17:00:03.000Z",
        },
      },
    });
  });
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
  const paymentDialog = page.getByRole("dialog", { name: "Cobrar na maquininha" });
  await expect(paymentDialog).toBeVisible();
  await expect(paymentDialog.getByLabel("Valor a cobrar")).toHaveValue("93");
  await expect(paymentDialog.getByRole("button", { name: "Débito" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  for (const width of [360, 480]) {
    await page.setViewportSize({ width, height: 812 });
    await expectNoHorizontalOverflow(page);
    const chargeHeight = await paymentDialog
      .getByRole("button", { name: /Cobrar R\$/ })
      .evaluate((element) => element.getBoundingClientRect().height);
    expect(chargeHeight).toBeGreaterThan(47.9);
  }
  await expectWcagAa(page);
  await paymentDialog.getByRole("button", { name: /Cobrar R\$/ }).click();
  await expect(paymentDialog.getByText("Pagamento aprovado", { exact: true })).toBeVisible();
  expect(paymentRequest).not.toBeNull();
  expect(paymentRequest?.body).toEqual({
    method: "debit_card",
    amountCents: 9_300,
    installments: 1,
    installationId: paymentAttempt.installationId,
  });
  expect(paymentRequest?.headers["idempotency-key"]).toBeTruthy();
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { smartPosStartArgs?: unknown[] }).smartPosStartArgs),
    )
    .toEqual(["attempt-1"]);
  await paymentDialog.getByRole("button", { name: "Voltar à conta" }).click();
  const manualMethods = page.getByLabel("Forma de pagamento");
  await expect(manualMethods.locator("option")).toHaveText(["Dinheiro", "Outro não eletrônico"]);

  const printAccount = page.getByRole("button", { name: "Imprimir pré-conta", exact: true });
  await expect(printAccount).toBeEnabled();
  await printAccount.click();
  await expect(page.getByText("Entregue à impressora", { exact: true })).toBeVisible();
  await expect(page.getByText(/Não fecha a comanda e não registra pagamento/)).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Gestão SmartPOS pareia terminal e mostra saúde fail-closed em tela estreita", async ({
  page,
}) => {
  const installationId = "00000000-0000-4000-8000-000000000111";
  const certificationId = "00000000-0000-4000-8000-000000000222";
  let pairingBody: unknown = null;
  await page.addInitScript(() => localStorage.setItem("giromesa-theme", "dark"));
  await mockProductionApi(page);
  await page.route("**/pilot/installations/*/payment-capabilities", (route) =>
    route.fulfill({
      json: {
        installationId: new URL(route.request().url()).pathname.split("/").at(-2),
        available: false,
        status: "disabled",
        provider: null,
        methods: [],
        maxInstallments: 1,
        supports: { cancel: false, recover: false, reversal: false },
        reason: "PAYMENT_DEVICE_NOT_ENROLLED",
      },
    }),
  );
  await page.route("**/pilot/payment-devices/pairing-codes", async (route) => {
    pairingBody = route.request().postDataJSON();
    await route.fulfill({
      status: 201,
      json: {
        pairingId: "pairing-1",
        code: "AB12CD34",
        qrPayload: "giromesa:payment-pairing:pairing-1",
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      },
    });
  });
  await page.route("**/pilot/payment-devices", (route) =>
    route.fulfill({
      json: {
        devices: [
          {
            installationId,
            label: "POS Balcão 01",
            enrolledAt: "2026-08-21T17:00:00.000Z",
            revokedAt: null,
            lastSeenAt: "2026-08-21T17:03:00.000Z",
            reportedDiagnostics: {
              manufacturer: "Stone",
              model: "Sunmi P2",
              androidVersion: "11",
              firmwareVersion: "1.4.2",
              appVersion: "0.2.3",
              packageName: "com.giromesa.ops",
              signingCertificateSha256: "a".repeat(64),
            },
            capabilities: {
              installationId,
              available: false,
              status: "suspended",
              provider: "stone",
              methods: ["credit_card", "debit_card", "pix"],
              maxInstallments: 12,
              supports: { cancel: true, recover: true, reversal: false },
              reason: "CERTIFICATION_SUSPENDED",
              certificationId,
              diagnosticsMatch: true,
              killSwitch: { enabled: true, reason: "Bloqueio preventivo do suporte" },
            },
            certification: {
              id: certificationId,
              provider: "stone",
              status: "suspended",
              killSwitchEnabled: true,
              killSwitchReason: "Bloqueio preventivo do suporte",
            },
          },
        ],
      },
    }),
  );
  await page.route("**/pilot/payment-operations/health", (route) =>
    route.fulfill({
      json: {
        generatedAt: "2026-08-21T17:05:00.000Z",
        summary: {
          unknownAttempts: 1,
          staleProcessingAttempts: 0,
          offlineDevices: 1,
          reconciliationDivergences: 2,
        },
        incidents: [
          {
            kind: "unknown_attempt",
            severity: "critical",
            entityId: "attempt-1",
            label: "Comanda 18 sem resultado",
            occurredAt: "2026-08-21T16:55:00.000Z",
          },
        ],
      },
    }),
  );
  await page.route("**/pilot/payment-reconciliation**", (route) =>
    route.fulfill({
      json: {
        entries: [],
        summary: { grossCents: 10_000, feeCents: 200, netCents: 9_800, divergences: 2 },
      },
    }),
  );
  await page.route("**/pilot/payment-homologation-runs", (route) =>
    route.fulfill({ json: { runs: [] } }),
  );

  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/device";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await page.setViewportSize({ width: 360, height: 640 });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(
    page.getByRole("heading", { level: 1, name: "SmartPOS e dispositivos" }),
  ).toBeVisible();
  await expect(page.getByText("Comanda 18 sem resultado")).toBeVisible();
  await expect(page.getByText("Bloqueio preventivo do suporte")).toBeVisible();
  await expect(page.getByRole("button", { name: /kill switch/i })).toHaveCount(0);
  await page.getByLabel("Nome operacional do terminal").fill("POS Caixa 02");
  await page.getByRole("button", { name: "Gerar pareamento" }).click();
  await expect(page.getByText("AB12CD34", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /QR Code temporário/ })).toBeVisible();
  expect(pairingBody).toEqual({ label: "POS Caixa 02", expiresInSeconds: 300 });

  for (const viewport of [
    { width: 360, height: 640 },
    { width: 480, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
  }
  await expectWcagAa(page);
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

test("Cardápio real mantém a interface completa e as integrações reais", async ({ page }) => {
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
  await expect(page.locator(".catalog-management-header")).toHaveCSS("flex-direction", "column");
  await expect(page.locator(".catalog-management-header__actions")).toHaveCSS(
    "justify-content",
    "flex-start",
  );
  for (const primaryAction of [
    "Matriz BCG",
    "Ver como Cliente & QR",
    "Opcionais & Modificadores",
  ]) {
    await expect(page.getByText(primaryAction, { exact: false }).first()).toBeVisible();
  }
  await expect(page.getByText("Importar CSV", { exact: false }).first()).toBeHidden();
  await page.getByRole("group", { name: "Ações do cardápio" }).getByText("Mais ações").click();
  for (const secondaryAction of [
    "Importar CSV",
    "Planilha CSV",
    "Identidade & Branding",
    "Gerar PDF / Imprimir",
    "Reordenar Categorias",
    "Reajuste em Lote",
    "Placas QR de Mesas",
  ]) {
    await expect(page.getByText(secondaryAction, { exact: false }).first()).toBeVisible();
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
