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
  floorPayload: unknown | (() => unknown) = floor,
  onTableTurnover?: (status: "cleaning" | "available") => void,
  onTableGroup?: (body: unknown) => number | undefined,
  actorRole: "owner" | "manager" | "waiter" | "cashier" | "receptionist" | "busser" = "manager",
) {
  await page.route("**/health", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        version: "2.0.0",
        buildSha: "e2e-real",
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
    if (route.request().method() === "POST" && url.pathname.endsWith("/pilot/table-groups")) {
      const status = onTableGroup?.(route.request().postDataJSON()) ?? 201;
      await route.fulfill({
        status,
        json:
          status < 400
            ? { group: { id: "group-1" }, members: [] }
            : { message: "A junção não pôde ser concluída." },
      });
      return;
    }
    if (route.request().method() === "PUT" && /\/shifts\/[^/]+\/sections$/.test(url.pathname)) {
      await route.fulfill({ json: { revision: 3 } });
      return;
    }
    if (
      ["POST", "PUT"].includes(route.request().method()) &&
      /\/service-sections(?:\/[^/]+)?$/.test(url.pathname)
    ) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: route.request().method() === "POST" ? 201 : 200,
        json: { section: { id: "section-saved", ...body }, tableIds: body.tableIds },
      });
      return;
    }
    if (route.request().method() === "DELETE" && /\/service-sections\/[^/]+$/.test(url.pathname)) {
      await route.fulfill({ json: { archived: true } });
      return;
    }
    if (route.request().method() === "POST" && url.pathname.endsWith("/shifts/open")) {
      await route.fulfill({ status: 201, json: { shift: { id: "shift-opened" }, sections: [] } });
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
                scopes: [{ role: actorRole, unitId: "unit-1" }],
              },
            ]
          : url.pathname.endsWith("/pilot/counter-queue")
            ? {
                items: [],
                counts: {
                  all: 0,
                  new: 0,
                  production: 0,
                  ready: 0,
                  waiting: 0,
                  delivered: 0,
                  late: 0,
                },
                pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
              }
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

test("Barras segmentadas do salão usam seleção em pill", async ({ page }) => {
  await mockProductionApi(page);
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/salon";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();

  const statusFilter = page.getByRole("button", { name: /Todas 2/ });
  const viewToggle = page.getByRole("button", { name: "Painel", exact: true });
  const inactiveStatusFilter = page.getByRole("button", { name: /Livres 1/ });
  const inactiveViewToggle = page.getByRole("button", { name: "Planta", exact: true });
  await expect(statusFilter).toHaveCSS("border-radius", "999px");
  await expect(viewToggle).toHaveCSS("border-radius", "999px");
  await expect(viewToggle).toHaveCSS("box-shadow", "none");
  await inactiveStatusFilter.hover();
  await expectWcagAa(page);
  await inactiveViewToggle.hover();
  await expectWcagAa(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator("html").evaluate((element) => element.setAttribute("data-theme", "dark"));
  await inactiveStatusFilter.hover();
  await expectWcagAa(page);
});

test("Cards das mesas priorizam identificação, contexto e próxima ação", async ({ page }) => {
  await mockProductionApi(page);
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/salon";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();

  const availableTable = page.locator(".real-table").filter({ hasText: "Mesa 01" });
  await expect(availableTable.getByText("Livre", { exact: true })).toHaveCount(1);
  await expect(availableTable.getByText("Abrir", { exact: true })).toBeVisible();
  await expect(availableTable).toContainText("Salão principal · Sem praça");

  const header = await availableTable.evaluate((card) => {
    const label = card.querySelector<HTMLElement>(".real-table__label")?.getBoundingClientRect();
    const seats = card.querySelector<HTMLElement>(".real-table__seats")?.getBoundingClientRect();
    return { labelRight: label?.right ?? 0, seatsLeft: seats?.left ?? 0 };
  });
  expect(header.labelRight).toBeLessThanOrEqual(header.seatsLeft);

  await page.setViewportSize({ width: 375, height: 812 });
  await expectNoHorizontalOverflow(page);
});

test("Junção de mesas livres cria o grupo e mostra falhas dentro do diálogo", async ({ page }) => {
  let attempts = 0;
  let requestBody: unknown;
  const freeFloor = {
    ...floor,
    tables: floor.tables.map((table) => ({ ...table, status: "available" })),
    openTabs: [],
    serviceCalls: [],
  };
  await mockProductionApi(page, undefined, undefined, freeFloor, undefined, (body) => {
    requestBody = body;
    attempts += 1;
    return attempts === 1 ? 409 : 201;
  });
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/salon";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await page.getByRole("button", { name: "Juntar mesas", exact: true }).click();
  await page.locator(".real-table").filter({ hasText: "Mesa 01" }).click();
  await page.locator(".real-table").filter({ hasText: "Mesa 03" }).click();
  await page.getByRole("button", { name: "Configurar junção" }).click();

  const dialog = page.getByRole("dialog", { name: "Organizar mesas selecionadas" });
  await dialog.getByRole("radio", { name: /Usar uma única comanda/ }).check();
  await expect(dialog.getByText(/a primeira abertura cria a comanda única/)).toBeVisible();
  const submit = dialog.getByRole("button", { name: "Juntar com comanda única" });
  await submit.click();
  await expect(dialog.getByRole("alert")).toContainText("A junção não pôde ser concluída");

  await submit.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Ao abrir qualquer uma, a comanda será única/)).toBeVisible();
  expect(requestBody).toMatchObject({
    tableIds: ["m01", "m03"],
    anchorTableId: "m01",
    mode: "single_tab",
  });
});

test("Perfis de atendimento explicam o efeito operacional de cada escolha", async ({ page }) => {
  await mockProductionApi(page);
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/salon";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await page.getByRole("button", { name: /Prontidão \d\/4/ }).click();

  const configurationDialog = page.getByRole("dialog", { name: "Configurar atendimento" });
  await configurationDialog.getByRole("button", { name: "Turno e praças" }).click();
  await configurationDialog.getByRole("button", { name: "Nova praça" }).click();
  const serviceModeGroup = configurationDialog.getByRole("group", {
    name: "Como esta praça atende?",
  });
  await expect(serviceModeGroup.getByRole("radio")).toHaveCount(4);
  await expect(serviceModeGroup.getByRole("radio", { name: /Misto por praça/ })).toBeChecked();
  await expect(serviceModeGroup.getByText(/Um toque abre a mesa para 1 pessoa/)).toBeVisible();
});

test("Configuração de praças guia revisão, equipe e abertura sem duplicar o perfil do turno", async ({
  page,
}) => {
  const setupFloor = {
    ...floor,
    serviceSections: [
      {
        id: "section-1",
        name: "Praça salão",
        color: "#176B4D",
        serviceMode: "full_service",
        defaultResponsibleIdentityId: "identity-1",
      },
      {
        id: "section-2",
        name: "Praça varanda",
        color: "#E0A100",
        serviceMode: "bar",
        defaultResponsibleIdentityId: "identity-1",
      },
    ],
    serviceSectionTables: [
      { sectionId: "section-1", tableId: "m01" },
      { sectionId: "section-2", tableId: "m03" },
    ],
  };
  await mockProductionApi(page, undefined, undefined, setupFloor);
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/salon";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await page.getByRole("button", { name: /Prontidão \d\/4/ }).click();

  const dialog = page.getByRole("dialog", { name: "Configurar atendimento" });
  await dialog.getByRole("button", { name: "Turno e praças" }).click();
  await expect(
    dialog.getByRole("navigation", { name: "Etapas da preparação do turno" }),
  ).toBeVisible();
  await expect(dialog.getByText("Praça salão", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Praça varanda", { exact: true })).toBeVisible();

  const salaModel = dialog
    .locator(".service-section-list article")
    .filter({ hasText: "Praça salão" });
  await salaModel.getByRole("button", { name: "Editar" }).click();
  await expect(dialog.getByText("Aparece na borda das mesas durante o turno.")).toBeVisible();
  await dialog.getByLabel("Cor da borda das mesas").fill("#0f766e");
  const updateRequest = page.waitForRequest(
    (request) =>
      request.method() === "PUT" && request.url().endsWith("/service-sections/section-1"),
  );
  await dialog.getByRole("button", { name: "Salvar alterações" }).click();
  expect((await updateRequest).postDataJSON()).toMatchObject({
    name: "Praça salão",
    color: "#0f766e",
    tableIds: ["m01"],
  });
  await expect(dialog.getByRole("status")).toContainText("Modelo de praça atualizado");

  await dialog.getByRole("button", { name: "Continuar para equipe" }).click();
  await expect(dialog.getByRole("heading", { name: "Titulares padrão" })).toBeVisible();
  await expect(dialog.getByText("2/2 com titular")).toBeVisible();
  await dialog.getByRole("button", { name: "Revisar abertura" }).click();
  await expect(dialog.getByText("Misto por praça", { exact: true })).toBeVisible();
  await expect(dialog.getByText("As praças usam formas diferentes de atendimento.")).toBeVisible();
  await expect(dialog.getByRole("group", { name: /Como o turno funciona/ })).toHaveCount(0);

  const openRequest = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/shifts/open"),
  );
  await dialog.getByRole("button", { name: "Abrir turno", exact: true }).click();
  expect((await openRequest).postDataJSON()).toMatchObject({ serviceMode: "hybrid" });

  await page.setViewportSize({ width: 375, height: 667 });
  await expectNoHorizontalOverflow(page);
});

test("Praças existentes são atribuídas aos garçons em um fluxo direto", async ({ page }) => {
  const shiftFloor = {
    ...floor,
    floorRevision: 1,
    shiftRevision: 2,
    staff: [
      { identityId: "identity-1", displayName: "Ana Operação" },
      { identityId: "identity-2", displayName: "Bruno Salão" },
      { identityId: "identity-3", displayName: "Carla Apoio" },
    ],
    activeShift: {
      id: "shift-1",
      label: "Jantar",
      serviceMode: "full_service",
      startsAt: "2026-08-23T18:00:00.000Z",
    },
    shiftSections: [
      {
        id: "shift-section-1",
        shiftId: "shift-1",
        sectionTemplateId: "section-1",
        name: "Salão",
        color: "#176B4D",
        serviceMode: "full_service",
      },
      {
        id: "shift-section-2",
        shiftId: "shift-1",
        sectionTemplateId: "section-2",
        name: "Varanda",
        color: "#2563EB",
        serviceMode: "full_service",
      },
    ],
    shiftSectionTables: [
      { shiftId: "shift-1", shiftSectionId: "shift-section-1", tableId: "m01" },
      { shiftId: "shift-1", shiftSectionId: "shift-section-2", tableId: "m03" },
    ],
    shiftSectionStaff: [
      {
        shiftId: "shift-1",
        shiftSectionId: "shift-section-1",
        identityId: "identity-1",
        role: "primary",
      },
    ],
  };
  await mockProductionApi(page, undefined, undefined, shiftFloor);
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/salon";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await page.getByRole("button", { name: /Prontidão \d\/4/ }).click();

  const dialog = page.getByRole("dialog", { name: "Configurar atendimento" });
  await expect(dialog.getByRole("heading", { name: "Equipe das praças" })).toBeVisible();
  await expect(dialog.getByText("1/2 com titular")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Salão 1 mesa Ana Operação/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await dialog.getByRole("button", { name: /Varanda 1 mesa Sem titular/ }).click();
  await dialog.getByLabel("Garçom titular").selectOption("identity-2");
  await dialog.getByText("Apoios opcionais", { exact: true }).click();
  await dialog.getByRole("checkbox", { name: "Carla Apoio" }).check();

  const updateRequest = page.waitForRequest(
    (request) => request.method() === "PUT" && /\/shifts\/shift-1\/sections$/.test(request.url()),
  );
  await dialog.getByRole("button", { name: "Salvar praça e equipe" }).click();
  const payload = (await updateRequest).postDataJSON() as {
    expectedRevision: number;
    assignments: Array<{
      shiftSectionId: string;
      tableIds: string[];
      primaryIdentityId: string | null;
      supportIdentityIds: string[];
    }>;
  };
  expect(payload.expectedRevision).toBe(2);
  expect(payload.assignments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        shiftSectionId: "shift-section-2",
        tableIds: ["m03"],
        primaryIdentityId: "identity-2",
        supportIdentityIds: ["identity-3"],
      }),
    ]),
  );
  await page.setViewportSize({ width: 375, height: 667 });
  await expectNoHorizontalOverflow(page);
});

test("Salão respeita a operação permitida para cada papel", async ({ browser }) => {
  const cases = [
    { role: "owner", access: "manage", expectation: "configure" },
    { role: "manager", access: "manage", expectation: "configure" },
    { role: "cashier", access: "financial", expectation: "financial" },
    { role: "waiter", access: "operate", expectation: "operate" },
    { role: "receptionist", access: "overview", expectation: "protected" },
    { role: "busser", access: "overview", expectation: "turnover" },
  ] as const;

  for (const actor of cases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let turnoverStatus = "";
    const canAccessTab = ["owner", "manager", "cashier", "waiter"].includes(actor.role);
    const projectedFloor = {
      ...floor,
      serviceCalls: [],
      tables: floor.tables.map((table) => ({
        ...table,
        status: actor.role === "busser" && table.id === "m01" ? "needs_cleaning" : table.status,
        accessLevel: actor.role === "waiter" && table.id === "m01" ? "overview" : actor.access,
      })),
      openTabs: canAccessTab ? [tab] : [],
      capabilities: {
        canManageFloor: actor.role === "owner" || actor.role === "manager",
        canManageShift: actor.role === "owner" || actor.role === "manager",
        canReorganizeTables: ["owner", "manager", "cashier", "waiter"].includes(actor.role),
        canRequestPrint: ["owner", "manager", "cashier", "waiter"].includes(actor.role),
        canManagePrint: ["owner", "manager", "cashier"].includes(actor.role),
        canAccessAllTabs: ["owner", "manager", "cashier"].includes(actor.role),
      },
    };
    await mockProductionApi(
      page,
      undefined,
      undefined,
      projectedFloor,
      (status) => {
        turnoverStatus = status;
      },
      undefined,
      actor.role,
    );
    await page.goto("/");
    await page.evaluate(() => {
      window.location.hash = "#/salon";
    });
    await page.getByRole("button", { name: "Abrir operação" }).click();

    if (actor.expectation === "configure") {
      await expect(page.getByRole("button", { name: "Editar espaço", exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole("button", { name: "Editar espaço", exact: true })).toHaveCount(0);
    }

    if (actor.expectation === "turnover") {
      await page.getByRole("button", { name: "Assumir", exact: true }).click();
      await expect.poll(() => turnoverStatus).toBe("cleaning");
      await context.close();
      continue;
    }

    await page.getByRole("button", { name: "Painel", exact: true }).click();
    const occupiedTable = page.locator(".real-table").filter({ hasText: "Mesa 03" });
    if (actor.expectation === "financial") {
      await expect(occupiedTable).toContainText("R$");
    } else if (actor.expectation === "operate" || actor.expectation === "protected") {
      await expect(occupiedTable).not.toContainText("R$");
    }
    await occupiedTable.click();
    const dialog = page.getByRole("dialog", { name: "Mesa 03" });
    if (actor.expectation === "protected") {
      await expect(dialog.getByText("Panorama protegido")).toBeVisible();
      await expect(dialog).toContainText("não estão no seu escopo");
    } else {
      await expect(dialog.getByRole("button", { name: /^Pedido/ })).toBeVisible();
    }
    await context.close();
  }
});

test("Responsável marca pedido pronto como servido na próxima ação", async ({ page }) => {
  const handoffs: Array<{ orderId: string; body: unknown; idempotencyKey: string }> = [];
  await mockProductionApi(
    page,
    undefined,
    undefined,
    {
      ...floor,
      serviceCalls: [],
      tables: floor.tables.map((table) => ({ ...table, accessLevel: "operate" })),
      tablePhases: [
        {
          tableId: "m03",
          tabId: tab.id,
          phase: "ready",
          readyOrderIds: ["order-3", "order-4"],
          since: "2026-08-16T12:01:00.000Z",
        },
      ],
    },
    undefined,
    undefined,
    "waiter",
  );
  await page.route("**/pilot/kds/orders/*/handoff", async (route) => {
    const orderId = new URL(route.request().url()).pathname.split("/").at(-2) ?? "";
    handoffs.push({
      orderId,
      body: route.request().postDataJSON(),
      idempotencyKey: route.request().headers()["idempotency-key"] ?? "",
    });
    await route.fulfill({ json: { orderId, target: "served", state: "served" } });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/salon";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  const readyTask = page.getByRole("button", { name: /Mesa 03 · pedido pronto/ });
  await readyTask.hover();
  await expectWcagAa(page);
  await page.getByRole("button", { name: "Painel", exact: true }).click();
  await page.locator(".real-table").filter({ hasText: "Mesa 03" }).click();
  const dialog = page.getByRole("dialog", { name: "Mesa 03" });
  await expect(dialog.getByText("Servir pedido", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Marcar como servido" }).click();
  await expect.poll(() => handoffs).toHaveLength(2);
  expect(handoffs.map(({ orderId, body }) => ({ orderId, body }))).toEqual([
    { orderId: "order-3", body: { target: "served" } },
    { orderId: "order-4", body: { target: "served" } },
  ]);
  expect(new Set(handoffs.map(({ idempotencyKey }) => idempotencyKey)).size).toBe(2);
  await expect(page.getByText("2 pedidos marcados como servidos.")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("Atendimento real mantém estado, contexto e layout nos breakpoints críticos", async ({
  page,
}) => {
  test.setTimeout(60_000);
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
  await expect(page.getByRole("region", { name: "Central da operação" })).toBeVisible();
  await expect(page.getByText("Operação geral", { exact: true })).toBeVisible();
  const readinessButton = page.getByRole("button", { name: /Prontidão \d\/4/ });
  await expect(readinessButton).toBeVisible();
  await readinessButton.click();
  const configurationDialog = page.getByRole("dialog", { name: "Configurar atendimento" });
  await expect(configurationDialog.getByText("Assistente de configuração")).toBeVisible();
  await configurationDialog.getByRole("button", { name: "Fechar" }).click();
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
  await expect(page.getByRole("button", { name: "Operar", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: "Editar espaço", exact: true })).toBeVisible();
  await page.locator(".salon-filter-menu > summary").click();
  await expect(page.locator(".salon-filter-menu")).toHaveAttribute("open", "");
  await page.locator(".page-heading").click();
  await expect(page.locator(".salon-filter-menu")).not.toHaveAttribute("open", "");
  await expect(page.getByRole("button", { name: "Organizar salão" })).toHaveCount(0);
  await expect(page.getByLabel("Mais ações do salão")).toHaveCount(0);
  await page.getByRole("button", { name: "Planta", exact: true }).click();
  await page.getByRole("button", { name: "Juntar mesas", exact: true }).click();
  const selectedFloorTable = page.locator(".floor-plan-table").filter({ hasText: "Mesa 03" });
  const originalFill = await selectedFloorTable
    .locator(".floor-plan-table__surface")
    .evaluate((element) => getComputedStyle(element).fill);
  await selectedFloorTable.click();
  await expect(selectedFloorTable).toHaveClass(/floor-plan-table--selected/);
  await expect(selectedFloorTable.locator(".floor-plan-table__selection")).toContainText("1");
  await expect
    .poll(() =>
      selectedFloorTable
        .locator(".floor-plan-table__surface")
        .evaluate((element) => getComputedStyle(element).fill),
    )
    .not.toBe(originalFill);
  await page.getByRole("button", { name: "Painel", exact: true }).click();
  await expect(page.locator(".real-table").filter({ hasText: "Mesa 03" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Lista", exact: true }).click();
  await expect(page.locator(".salon-fast-list-row").filter({ hasText: "Mesa 03" })).toHaveClass(
    /selected/,
  );
  await page.getByRole("button", { name: "Planta", exact: true }).click();
  await page.getByRole("button", { name: "Abrir planta em tela cheia" }).click();
  await expect(page.getByText("Modo operação", { exact: true })).toBeVisible();
  await expect(page.locator(".salon-command-center__header")).toBeHidden();
  await expect(page.locator(".salon-view-toggle")).toBeHidden();
  await expect(page.locator(".salon-workspace-modes")).toBeHidden();
  await expect(page.locator(".floor-plan-layers")).toBeHidden();
  await expect(page.locator(".floor-plan-minimap")).toBeHidden();
  await expect(page.locator(".salon-search")).toBeVisible();
  await expect(page.locator(".service-priority-queue")).toBeHidden();
  await page.getByRole("button", { name: "Prioridades 2" }).click();
  await expect(page.locator(".service-priority-queue")).toBeVisible();
  await page.getByRole("button", { name: "Prioridades 2" }).click();
  await expect(page.locator(".service-priority-queue")).toBeHidden();
  const operationalFloorHeight = await page
    .locator(".floor-plan__viewport")
    .evaluate((element) => element.getBoundingClientRect().height / window.innerHeight);
  expect(operationalFloorHeight).toBeGreaterThan(0.7);
  await page.getByRole("button", { name: "Sair da operação" }).click();
  await page.getByRole("button", { name: "Painel", exact: true }).click();
  const availableTable = page.locator(".real-table").filter({ hasText: "Mesa 01" });
  await availableTable.click();
  const openingDialog = page.getByRole("dialog", { name: "Mesa 01" });
  await expect(openingDialog).toHaveClass(/salon-service-modal--compact/);
  await expect(
    openingDialog
      .getByRole("region", { name: "Próxima ação da mesa" })
      .getByText("Iniciar atendimento", { exact: true }),
  ).toBeVisible();
  await expect(openingDialog.locator(".table-start--opening")).toHaveCSS("display", "grid");
  const guestCount = openingDialog.getByRole("spinbutton", { name: "Pessoas" });
  await expect(guestCount).toHaveValue("2");
  await openingDialog.getByRole("button", { name: "Aumentar quantidade de pessoas" }).click();
  await expect(guestCount).toHaveValue("3");
  await openingDialog.getByRole("button", { name: "Diminuir quantidade de pessoas" }).click();
  await expect(guestCount).toHaveValue("2");
  const openingBounds = await openingDialog.locator(".gm-modal").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { height: rect.height, width: rect.width };
  });
  expect(openingBounds.width).toBeLessThanOrEqual(680);
  expect(openingBounds.height).toBeLessThan(500);
  await openingDialog.getByRole("button", { name: "Fechar" }).click();
  const requestedBill = page.locator(".real-table").filter({ hasText: "Mesa 03" });
  await expect(requestedBill).toContainText("Pediu a conta");
  await expect(requestedBill).not.toContainText("Livre");
  await requestedBill.click();

  const dialog = page.getByRole("dialog", { name: "Mesa 03" });
  await expect(dialog).toBeVisible();
  const desktopDrawerBounds = await dialog.locator(".gm-modal").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { right: rect.right, viewportWidth: window.innerWidth, width: rect.width };
  });
  expect(desktopDrawerBounds.width).toBeLessThanOrEqual(720);
  expect(desktopDrawerBounds.viewportWidth - desktopDrawerBounds.right).toBeLessThanOrEqual(1);
  await expect(dialog.getByText("Preparar conta", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Linha do tempo da mesa", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Online", { exact: true })).toHaveCount(0);
  await expect(dialog.getByText(/no rascunho/)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Conta", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const fullPayment = dialog.getByRole("button", { name: /^Receber conta inteira/ });
  await expect(fullPayment).toBeVisible();
  await expect(fullPayment).toContainText("R$ 287,40");
  await fullPayment.click();
  const cashierPaymentForm = dialog.locator("form.cashier-payment-form");
  await expect(cashierPaymentForm).toBeVisible();
  await expect(
    cashierPaymentForm.getByRole("button", { name: /Conta inteira · R\$ 287,40/ }),
  ).toBeVisible();
  const paymentLayout = await cashierPaymentForm.evaluate((form) => {
    const payment = form.getBoundingClientRect();
    const grid = form.parentElement;
    const gridBounds = grid?.getBoundingClientRect();
    const gridStyle = grid ? getComputedStyle(grid) : null;
    return {
      gridLeft: gridBounds?.left ?? 0,
      gridRight: gridBounds?.right ?? 0,
      left: payment.left,
      paddingLeft: Number.parseFloat(gridStyle?.paddingLeft ?? "0"),
      paddingRight: Number.parseFloat(gridStyle?.paddingRight ?? "0"),
      right: payment.right,
    };
  });
  expect(paymentLayout.left - paymentLayout.gridLeft).toBeCloseTo(paymentLayout.paddingLeft, 1);
  expect(paymentLayout.gridRight - paymentLayout.right).toBeCloseTo(paymentLayout.paddingRight, 1);
  await expect(dialog.getByLabel("Valor a receber")).toHaveValue("287.4");
  await expect(dialog.getByLabel("Valor recebido")).toHaveValue("287.4");
  await expect(dialog.getByLabel("Valor a receber")).toBeFocused();
  const firstAccountLine = dialog.locator(".account-line-group").first();
  await firstAccountLine.getByRole("button", { name: /Ações para/ }).click();
  await expect(firstAccountLine.locator(".approval-form--inline")).toContainText("Ajustar item");
  await firstAccountLine.getByRole("button", { name: "Fechar" }).click();
  await dialog.getByRole("button", { name: /^Pedido/ }).click();
  await dialog.locator(".real-product-picker").evaluate((picker) => {
    const cards = [...picker.children];
    for (let index = 0; index < 4; index += 1) {
      for (const card of cards) picker.append(card.cloneNode(true));
    }
  });
  const productCard = dialog.locator(".real-product-option").first();
  const productCardBounds = await productCard.evaluate((element) => {
    const card = element.getBoundingClientRect();
    const button = element.querySelector("button")?.getBoundingClientRect();
    return { buttonBottom: button?.bottom ?? 0, cardBottom: card.bottom, width: card.width };
  });
  expect(productCardBounds.width).toBeGreaterThan(200);
  expect(productCardBounds.buttonBottom).toBeLessThanOrEqual(productCardBounds.cardBottom + 1);
  await dialog.locator(".real-product-picker").evaluate((picker) => {
    for (const card of [...picker.children].slice(2)) card.remove();
  });
  await dialog.getByRole("button", { name: "Adicionar Prato da casa", exact: true }).click();
  const productDialog = page.getByRole("dialog", { name: "Prato da casa" });
  await expect(productDialog.getByLabel("Observação para a produção")).toBeVisible();
  await expect(productDialog.getByText("Pessoa, etapa e restrições")).toBeVisible();
  const quantityWidth = await productDialog
    .locator(".product-customization__quantity")
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(quantityWidth).toBeLessThan(150);
  await productDialog.getByRole("button", { name: "Fechar" }).click();
  await expect(productDialog).toBeHidden();
  await dialog.getByRole("button", { name: "Adicionar Café Expresso", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Enviar pedido (1)" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Receber no caixa" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Dados e ações" }).click();
  await expect(dialog.locator(".counter-metadata-form")).toBeVisible();
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
    expect(
      await dialog
        .locator(".counter-metadata-form")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
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

test("Balcão real mantém abertura rápida e fila operacional nos breakpoints críticos", async ({
  page,
}) => {
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

  await page.setViewportSize({ width: 1440, height: 900 });
  const formColumns = await page
    .locator(".counter-open-form")
    .evaluate((form) => getComputedStyle(form).gridTemplateColumns.trim().split(/\s+/).length);
  const searchWidthRatio = await page
    .locator(".counter-queue-tools .gm-search-field")
    .evaluate((search) => {
      const queue = search.closest(".counter-queue-tools");
      return queue ? search.getBoundingClientRect().width / queue.getBoundingClientRect().width : 0;
    });
  expect(formColumns).toBe(3);
  expect(searchWidthRatio).toBeGreaterThan(0.9);
  await page.setViewportSize({ width: 375, height: 812 });

  await page.getByText("Prazo e identificação").click();
  await expect(page.getByLabel("Data")).toHaveAttribute("type", "date");
  await expect(page.getByLabel("Telefone")).toBeVisible();
  const quickOpenForm = page.locator(".counter-open-form");

  for (const viewport of [
    { width: 375, height: 812 },
    { width: 1024, height: 768 },
    { width: 1100, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    if (viewport.width > 375) {
      await page.getByRole("button", { name: "Abrir menu", exact: true }).click();
      await expect(
        page.locator(".sidebar").getByRole("link", { name: "Balcão e retirada" }),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.locator(".sidebar").getByRole("button", { name: "Fechar menu" }).click();
    }

    await expectNoHorizontalOverflow(page);
    for (const control of [
      quickOpenForm.locator("select"),
      page.getByLabel("Nome do cliente", { exact: true }),
      page.getByLabel("Telefone", { exact: true }),
      page.getByLabel("Data", { exact: true }),
      page.getByLabel("Hora", { exact: true }),
      page.getByLabel("Referência interna", { exact: true }),
      page.getByLabel("Pessoas", { exact: true }),
      page.getByRole("searchbox", { name: "Buscar atendimento" }),
      page.getByRole("button", { name: "Abrir e pedir" }),
    ]) {
      const bounds = await control.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewportWidth: window.innerWidth };
      });
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(bounds.viewportWidth);
    }
  }

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
    localStorage.setItem(
      "giromesa:terminal-profile:active:unit-1",
      JSON.stringify({
        unitId: "unit-1",
        installationId: "00000000-0000-4000-8000-000000000111",
        mode: "waiter_mobile",
        paymentMode: "homologated_pos",
        printerId: "caixa",
      }),
    );
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
  await page.route("**/pilot/counter-queue**", async (route) => {
    await route.fulfill({
      json: {
        items: [{ ...pickupTab, queueStage: "new" }],
        counts: { all: 1, new: 1, production: 0, ready: 0, waiting: 0, delivered: 0, late: 0 },
        pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
      },
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
  await page.getByRole("button", { name: "Cobrar na POS", exact: true }).click();
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
  await expect(page.getByText("Saída enviada; confirme o papel", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Confirmar saída física" })).toBeVisible();
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
    "Gerar PDF / Imprimir",
    "Reordenar Categorias",
    "Reajuste em Lote",
    "Placas QR de Mesas",
  ]) {
    await expect(page.getByRole("button", { name: new RegExp(availableButton) })).toBeEnabled();
  }
  await expect(page.getByRole("link", { name: /Identidade & Branding/ })).toBeEnabled();
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
