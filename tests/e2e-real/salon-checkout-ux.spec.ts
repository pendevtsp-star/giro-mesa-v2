import { expect, type Page, test } from "@playwright/test";
import { mockCompatibleApiHealth } from "./api-health-mock";

type CheckoutState = {
  tab: Record<string, unknown>;
  payments: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  paymentBodies: Array<Record<string, unknown>>;
  printSplitBodies: Array<Record<string, unknown>>;
  closeBodies: Array<Record<string, unknown>>;
  closed: boolean;
};

function createState(totalCents: number, eventCount = 0): CheckoutState {
  return {
    tab: {
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
      serviceChargeBasisPoints: 0,
      tipCents: 0,
      subtotalCents: totalCents,
      discountCents: 0,
      serviceChargeCents: 0,
      totalCents,
    },
    payments: [],
    events: Array.from({ length: eventCount }, (_, index) => ({
      id: `event-${index}`,
      type: "tab_opened",
      payload: {},
      actorIdentityId: "identity-1",
      actorName: "Ana Operação",
      createdAt: "2026-09-08T12:00:00.000Z",
    })),
    paymentBodies: [],
    printSplitBodies: [],
    closeBodies: [],
    closed: false,
  };
}

async function mockCheckoutApi(
  page: Page,
  totalCents = 28_740,
  eventCount = 0,
  cashShiftRequired = false,
) {
  const state = createState(totalCents, eventCount);
  await mockCompatibleApiHealth(page, "salon-checkout-ux-e2e");
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = `${url.pathname}${url.search}`;

    if (request.method() === "GET" && path === "/v1/auth/terminal-session") {
      await route.fulfill({ status: 401, json: { code: "TERMINAL_SESSION_INVALID" } });
      return;
    }
    if (request.method() === "GET" && path === "/v1/auth/me") {
      await route.fulfill({
        json: {
          identity: { id: "identity-1", email: "ana@giromesa.test", displayName: "Ana Operação" },
          memberships: [
            { membershipId: "membership-1", organizationId: "org-1", status: "active" },
          ],
          platformAdmin: false,
        },
      });
      return;
    }
    if (request.method() === "GET" && path === "/v1/organizations") {
      await route.fulfill({
        json: [
          {
            membershipId: "membership-1",
            organization: { id: "org-1", tradeName: "Grupo Aurora", document: "12345678000199" },
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
        ],
      });
      return;
    }

    if (request.method() === "POST" && path.endsWith("/payments")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.paymentBodies.push(body);
      if (cashShiftRequired && body.method === "cash") {
        await route.fulfill({
          status: 409,
          json: {
            code: "CASH_SHIFT_REQUIRED",
            message: "Abra o caixa desta unidade antes de registrar dinheiro.",
          },
        });
        return;
      }
      const payment = {
        id: `payment-${state.payments.length + 1}`,
        method: body.method,
        amountCents: body.amountCents,
        netAmountCents: body.amountCents,
        financialStatus: "posted",
        reference: body.reference ?? null,
        createdAt: "2026-09-08T12:01:00.000Z",
      };
      state.payments.push(payment);
      await route.fulfill({ status: 201, json: { payment } });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/print-splits")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.printSplitBodies.push(body);
      const partCount = Number(body.partCount ?? 2);
      await route.fulfill({
        status: 201,
        json: {
          split: { id: "split-1", partCount, balanceSnapshotCents: totalCents },
          parts: Array.from({ length: partCount }, (_, index) => ({
            id: `part-${index + 1}`,
            partNumber: index + 1,
            amountCents: Math.floor(totalCents / partCount),
          })),
          printJobs: [],
        },
      });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/close")) {
      const body = request.postDataJSON() as Record<string, unknown>;
      state.closeBodies.push(body);
      state.closed = true;
      await route.fulfill({
        json: { tab: { ...state.tab, status: "closed" }, paidCents: totalCents, printJob: null },
      });
      return;
    }
    if (request.method() === "POST" && path.endsWith("/calls")) {
      await route.fulfill({ status: 201, json: { id: "call-1", status: "open" } });
      return;
    }

    if (request.method() === "GET" && path.endsWith("/pilot/floor")) {
      await route.fulfill({
        json: {
          floorRevision: 1,
          rooms: [{ id: "room-1", name: "Salão principal", active: true, layoutPolygon: null }],
          tables: [
            {
              id: "m03",
              roomId: "room-1",
              label: "Mesa 03",
              seats: 4,
              status: state.closed ? "needs_cleaning" : "occupied",
              layoutX: null,
              layoutY: null,
              active: true,
            },
          ],
          openTabs: state.closed ? [] : [state.tab],
          tableGroups: [],
          tableGroupMembers: [],
          serviceCalls: [],
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
        },
      });
      return;
    }
    if (request.method() === "GET" && path.endsWith("/pilot/catalog")) {
      await route.fulfill({
        json: {
          categories: [],
          stations: [],
          allergens: [],
          modifierGroups: [],
          modifierOptions: [],
          products: [],
          prices: [],
          availability: [],
          productStations: [],
          productAllergens: [],
          productModifierGroups: [],
          combos: [],
        },
      });
      return;
    }
    if (request.method() === "GET" && url.pathname.endsWith("/pilot/tabs/tab-3")) {
      await route.fulfill({
        json: {
          tab: { ...state.tab, status: state.closed ? "closed" : "open" },
          orders: [],
          items: [],
          payments: state.payments,
          events: state.events,
          presence: [],
        },
      });
      return;
    }
    if (request.method() === "GET" && url.pathname.endsWith("/pilot/tabs")) {
      await route.fulfill({ json: state.closed ? [] : [state.tab] });
      return;
    }
    if (request.method() === "GET" && path.endsWith("/pilot/counter-queue")) {
      await route.fulfill({
        json: {
          items: [],
          counts: { all: 0, new: 0, production: 0, ready: 0, waiting: 0, delivered: 0, late: 0 },
          pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
        },
      });
      return;
    }
    if (request.method() === "GET" && path.includes("/print-jobs")) {
      await route.fulfill({ json: [] });
      return;
    }

    await route.fulfill({ json: {} });
  });
  return state;
}

async function openCheckout(page: Page, selectAccount = true) {
  await page.goto("/");
  await page.evaluate(() => {
    window.location.hash = "#/salon";
  });
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await page.locator(".real-table").filter({ hasText: "Mesa 03" }).click();
  const dialog = page.getByRole("dialog", { name: "Mesa 03" });
  await expect(dialog).toBeVisible();
  if (selectAccount) await dialog.getByRole("button", { name: "Conta", exact: true }).click();
  return dialog;
}

async function expectNoHorizontalOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(width.document, JSON.stringify(width)).toBeLessThanOrEqual(width.viewport);
}

test("Salon/checkout não cria overflow nos breakpoints e temas críticos", async ({ page }) => {
  await mockCheckoutApi(page);
  const dialog = await openCheckout(page);
  for (const theme of ["light", "dark"] as const) {
    await page.locator("html").evaluate((element, value) => {
      if (value === "dark") element.setAttribute("data-theme", value);
      else element.removeAttribute("data-theme");
    }, theme);
    for (const viewport of [
      { width: 375, height: 812 },
      { width: 412, height: 915 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await expectNoHorizontalOverflow(page);
      await expect(dialog).toBeVisible();
    }
  }
  await expect(dialog.locator(".service-action-dock")).toBeVisible();
});

test("checkout registra payloads curtos de dinheiro e Pix", async ({ page }) => {
  const state = await mockCheckoutApi(page);
  const dialog = await openCheckout(page);
  const form = dialog.locator("form.cashier-payment-form");
  await expect(form).toBeVisible();

  const paymentMode = form.getByLabel("Como receber");
  await expect(paymentMode).toHaveValue("full");
  await expect(form.getByLabel("Valor a receber")).toHaveValue("287.4");
  await paymentMode.selectOption("per_person");
  await expect(form.getByLabel("Dividir o saldo por")).toHaveValue("2");
  await expect(form.getByLabel("Valor a receber")).toHaveValue("143.7");
  await paymentMode.selectOption("full");
  await form.getByLabel("Valor a receber").fill("10.01");
  await expect(paymentMode).toHaveValue("custom");
  await form.getByLabel("Valor a receber").fill("");
  await expect(form.getByLabel("Valor a receber")).toHaveValue("");
  await expect(
    dialog.locator(".service-action-dock").getByRole("button", { name: /Confirmar/ }),
  ).toBeDisabled();
  await form.getByLabel("Valor a receber").fill("10.01");
  await form.getByLabel("Forma de pagamento").selectOption("cash");
  await form.getByLabel("Valor a receber").fill("10.01");
  await form.getByLabel("Valor recebido").fill("20.00");
  await dialog
    .locator(".service-action-dock")
    .getByRole("button", { name: /Confirmar/ })
    .click();
  await expect.poll(() => state.paymentBodies).toHaveLength(1);
  expect(state.paymentBodies[0]).toMatchObject({
    method: "cash",
    amountCents: 1001,
    reference: "Recebido R$\u00a020,00; troco R$\u00a09,99",
  });

  await form.getByLabel("Forma de pagamento").selectOption("pix");
  await form.getByLabel("Valor a receber").fill("3.33");
  await form.getByText("Referência e confirmação externa", { exact: true }).click();
  await form.getByLabel("Referência opcional").fill("pix-qr-1");
  await dialog
    .locator(".service-action-dock")
    .getByRole("button", { name: /Confirmar/ })
    .click();
  await expect.poll(() => state.paymentBodies).toHaveLength(2);
  expect(state.paymentBodies[1]).toMatchObject({
    method: "pix",
    amountCents: 333,
    reference: "pix-qr-1",
  });
});

test("aguarda o saldo atualizado antes de permitir outro recebimento", async ({ page }) => {
  const state = await mockCheckoutApi(page);
  const dialog = await openCheckout(page);
  let release = () => {};
  const balanceReady = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/pilot/tabs/tab-3**", async (route) => {
    if (route.request().method() === "GET" && state.payments.length) await balanceReady;
    await route.fallback();
  });
  const amount = dialog.getByLabel("Valor a receber", { exact: true });
  const confirm = dialog.locator(".service-action-dock button[form]");
  try {
    await amount.fill("10.01");
    await confirm.click();
    await expect.poll(() => state.payments.length).toBe(1);
    await expect(confirm).toBeDisabled();
    release();
    await expect(dialog.getByLabel("Como receber")).toHaveValue("full");
    await expect(amount).toHaveValue("277.39");
    await expect(confirm).toBeEnabled();
    expect(state.paymentBodies).toHaveLength(1);
  } finally {
    release();
  }
});

test("poll anterior ao pagamento não libera saldo quando a atualização falha", async ({ page }) => {
  test.setTimeout(45_000);
  const state = await mockCheckoutApi(page);
  const dialog = await openCheckout(page);
  state.tab.totalCents = 30_000;
  const staleSnapshot = {
    tab: { ...state.tab },
    orders: [],
    items: [],
    payments: [],
    events: [],
    presence: [],
  };
  let releaseStale = () => {};
  let releaseFailure = () => {};
  const staleReady = new Promise<void>((resolve) => {
    releaseStale = resolve;
  });
  const failureReady = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  let staleReads = 0;
  let failedReads = 0;
  let recover = false;
  await page.route("**/pilot/tabs/tab-3**", async (route) => {
    if (
      route.request().method() !== "GET" ||
      !new URL(route.request().url()).pathname.endsWith("/pilot/tabs/tab-3")
    )
      return route.fallback();
    if (!state.payments.length) {
      staleReads += 1;
      await staleReady;
      await route.fulfill({ json: staleSnapshot });
    } else if (!recover) {
      failedReads += 1;
      await failureReady;
      await route.fulfill({ status: 503, json: { message: "Saldo indisponível" } });
    } else {
      await route.fallback();
    }
  });
  const confirm = dialog.locator(".service-action-dock button[form]");
  try {
    await page.waitForTimeout(8_100);
    expect(staleReads).toBeGreaterThan(0);
    await dialog.getByLabel("Valor a receber", { exact: true }).fill("10.01");
    await confirm.click();
    await expect.poll(() => failedReads).toBeGreaterThan(0);
    releaseStale();
    await expect(dialog.locator(".account-overview__metrics")).toContainText("300,00");
    releaseFailure();
    await expect(
      dialog.getByText(
        "A ação foi registrada, mas o saldo ainda não foi atualizado. Aguarde a sincronização antes de receber.",
      ),
    ).toBeVisible();
    await expect(confirm).toBeDisabled();
    recover = true;
    await expect(dialog.getByLabel("Valor a receber", { exact: true })).toHaveValue("289.99", {
      timeout: 12_000,
    });
    await expect(confirm).toBeEnabled();
    expect(state.paymentBodies).toHaveLength(1);
  } finally {
    releaseStale();
    releaseFailure();
  }
});

test("erro CASH_SHIFT_REQUIRED permanece inline após três segundos", async ({ page }) => {
  const state = await mockCheckoutApi(page, 28_740, 0, true);
  const dialog = await openCheckout(page);
  const form = dialog.locator("form.cashier-payment-form");
  await form.getByLabel("Como receber").selectOption("custom");
  await form.getByLabel("Forma de pagamento").selectOption("cash");
  await form.getByLabel("Valor a receber").fill("10.01");
  await form.getByLabel("Valor recebido").fill("20.00");
  await dialog
    .locator(".service-action-dock")
    .getByRole("button", { name: /Confirmar/ })
    .click();
  await expect(form).toContainText(
    "Abra o caixa desta unidade em Contas e caixa antes de registrar dinheiro.",
  );
  await page.waitForTimeout(3_100);
  await expect(form).toContainText(
    "Abra o caixa desta unidade em Contas e caixa antes de registrar dinheiro.",
  );
  expect(state.payments).toHaveLength(0);
});

test("impressão e divisão ficam em disclosure secundário", async ({ page }) => {
  const state = await mockCheckoutApi(page);
  const dialog = await openCheckout(page);
  const disclosure = dialog.locator("details.account-print-disclosure");
  await expect(disclosure).toBeVisible();
  await expect(disclosure).not.toHaveAttribute("open", "");
  await disclosure.locator("summary").click();
  await expect(disclosure.locator("form.print-split-form")).toBeVisible();
  await disclosure.getByLabel("Forma da divisão impressa").selectOption("fixed_amount");
  await disclosure.getByLabel("Quantidade de vias").fill("2");
  await disclosure.getByLabel("Valor sugerido por via").fill("100.00");
  await disclosure.getByRole("button", { name: "Criar e imprimir vias" }).click();
  await expect.poll(() => state.printSplitBodies).toHaveLength(1);
  expect(state.printSplitBodies[0]).toMatchObject({
    method: "fixed_amount",
    partCount: 2,
    fixedAmountCents: 10000,
    documentType: "partial_statement",
  });
  expect(state.paymentBodies).toHaveLength(0);
  await expect(disclosure).toContainText("não registra pagamento");
});

test("fechamento sem consumo permanece acessível no fim do scroll", async ({ page }) => {
  const state = await mockCheckoutApi(page, 0, 30);
  await page.on("dialog", (dialog) => dialog.accept());
  const dialog = await openCheckout(page, false);
  await dialog.locator(".workspace-tabs--primary .workspace-tabs__more summary").click();
  await dialog
    .locator(".workspace-tabs__menu")
    .getByRole("button", { name: /Histórico/ })
    .click();
  const body = dialog.locator(".gm-modal__body");
  await expect
    .poll(() => body.evaluate((element) => element.scrollHeight > element.clientHeight))
    .toBe(true);
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const close = dialog.getByRole("button", { name: "Encerrar mesa" });
  await expect(close).toBeVisible();
  const bounds = await close.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { bottom: rect.bottom, height: rect.height };
  });
  const viewport = await page.evaluate(() => ({
    height: window.innerHeight,
    width: window.innerWidth,
  }));
  expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
  expect(bounds.height).toBeGreaterThan(0);
  await close.click();
  await expect.poll(() => state.closeBodies).toHaveLength(1);
  expect(state.closeBodies[0]).toMatchObject({ printRequested: false });
});
