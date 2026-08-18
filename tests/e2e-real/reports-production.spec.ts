import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

const organizationId = "org-1";
const unitId = "unit-1";

function report(period: { from: string; to: string }, legacyEmpty = false) {
  const financials = {
    period,
    cashFlow: {
      inflowsCents: legacyEmpty ? 0 : 120_000,
      outflowsCents: legacyEmpty ? 0 : 45_000,
      netCents: legacyEmpty ? 0 : 75_000,
      basis: "realized_payments_utc",
    },
    incomeStatement: {
      revenueCents: legacyEmpty ? 0 : 150_000,
      cmvCents: null,
      grossMarginCents: null,
      operatingExpensesCents: legacyEmpty ? 0 : 50_000,
      operatingResultCents: null,
      costCoverage: {
        coverage: "partial",
        revenueCents: legacyEmpty ? 0 : 150_000,
        coveredRevenueCents: legacyEmpty ? 0 : 90_000,
        missingCostLines: legacyEmpty ? 0 : 2,
        cmvCents: null,
        grossMarginCents: null,
        completeForRevenue: false,
      },
      basis: "competence",
    },
  };
  return {
    ...financials,
    timezone: "America/Sao_Paulo",
    previousPeriod: { from: "2026-07-01", to: "2026-07-31" },
    comparison: {
      mode: "previous_period",
      revenueCents: legacyEmpty ? 0 : 150_000,
      previousRevenueCents: legacyEmpty ? 0 : 120_000,
      changeCents: legacyEmpty ? 0 : 30_000,
      changePercent: legacyEmpty ? null : 25,
    },
    dailySeries: legacyEmpty
      ? []
      : [
          { date: period.from, revenueCents: 100_000, previousRevenueCents: 80_000 },
          { date: period.to, revenueCents: 50_000, previousRevenueCents: 40_000 },
        ],
    breakdowns: {
      products: legacyEmpty
        ? []
        : [{ key: "product-1", label: "Prato executivo", revenueCents: 90_000, quantity: 30 }],
      categories: legacyEmpty
        ? []
        : [{ key: "category-1", label: "Almoço", revenueCents: 90_000, quantity: 30 }],
      channels: legacyEmpty
        ? []
        : [{ key: "dine_in", label: "Salão", revenueCents: 120_000, quantity: 40 }],
      paymentMethods: legacyEmpty
        ? []
        : [{ key: "pix", label: "Pix", revenueCents: 120_000, quantity: 35 }],
    },
    reportFamilies: {
      sales: {
        coverage: "complete",
        closedTabs: legacyEmpty ? 0 : 40,
        subtotalCents: legacyEmpty ? 0 : 160_000,
        discountsCents: legacyEmpty ? 0 : 10_000,
        netRevenueCents: legacyEmpty ? 0 : 150_000,
        averageTicketCents: legacyEmpty ? null : 3_750,
        guests: legacyEmpty ? 0 : 60,
        averageSpendPerGuestCents: legacyEmpty ? null : 2_500,
      },
      exceptions: {
        coverage: "complete",
        canceledItems: legacyEmpty ? 0 : 2,
        canceledValueCents: legacyEmpty ? 0 : 4_000,
        discountedItems: legacyEmpty ? 0 : 5,
        itemDiscountCents: legacyEmpty ? 0 : 10_000,
        tabDiscountCents: legacyEmpty ? 0 : 10_000,
        cancellationReasons: legacyEmpty
          ? []
          : [{ label: "Erro de lançamento", quantity: 2, amountCents: 4_000 }],
      },
      inventory: {
        coverage: "complete",
        basis: "period_events_and_current_balance",
        lossEvents: legacyEmpty ? 0 : 1,
        lossQuantity: legacyEmpty ? 0 : 2.5,
        stockoutItems: legacyEmpty ? 0 : 2,
        lowStockItems: legacyEmpty ? 0 : 3,
        currentInventoryValueCents: legacyEmpty ? 0 : 75_000,
      },
      purchasing: {
        coverage: "complete",
        orderCount: legacyEmpty ? 0 : 3,
        orderedCents: legacyEmpty ? 0 : 80_000,
        canceledOrders: 0,
        receiptCount: legacyEmpty ? 0 : 2,
        receivedCents: legacyEmpty ? 0 : 50_000,
        suppliers: legacyEmpty
          ? []
          : [
              {
                key: "supplier-1",
                label: "Fornecedor Central",
                orderCount: 3,
                orderedCents: 80_000,
                receiptCount: 2,
                receivedCents: 50_000,
              },
            ],
      },
      operations: {
        coverage: "complete",
        closedTabs: legacyEmpty ? 0 : 40,
        dineInTabs: legacyEmpty ? 0 : 30,
        tableTurnovers: legacyEmpty ? 0 : 28,
        guests: legacyEmpty ? 0 : 60,
        averageGuestsPerTab: legacyEmpty ? null : 1.5,
        averageServiceMinutes: legacyEmpty ? null : 52,
      },
      profitability: {
        coverage: "partial",
        grossMarginPercent: null,
        productProfitabilityCoverage: "unavailable",
      },
    },
    meta: {
      generatedAt: "2026-08-17T12:00:00.000Z",
      dataThrough: "2026-08-17T11:59:00.000Z",
      sourceCounts: {
        posSales: legacyEmpty ? 0 : 2,
        receivablePayments: 1,
        payablePayments: 1,
        receivables: 1,
        payables: 1,
        costLines: 0,
      },
      coverage: { sales: "complete", cashFlow: "complete", costs: "partial", budget: "complete" },
    },
    capabilities: {
      viewCosts: true,
      drillDown: true,
      export: true,
      manageBudget: true,
      manageSchedules: true,
      emailDeliveryConfigured: true,
    },
    budget: {
      coverage: "complete",
      basis: "calendar_month_prorated_by_days",
      targets: {
        posRevenueCents: 180_000,
        cashInflowsCents: 150_000,
        cashOutflowsCents: 80_000,
        competenceRevenueCents: 180_000,
        competenceExpensesCents: 70_000,
      },
    },
  };
}

async function mockReportsApi(page: Page, requestedPeriods: string[]) {
  const csvContent = "\uFEFFseção;rótulo;timezone\r\nvendas;Prato executivo;America/Sao_Paulo\r\n";
  const csvSha256 = createHash("sha256").update(csvContent).digest("hex");
  const exportRecord = {
    id: "export-1",
    status: "ready",
    format: "csv",
    filename: "relatorio-giromesa-2026-08-01-2026-08-17.csv",
    rowCount: 2,
    sha256: csvSha256,
    requestedAt: "2026-08-17T12:00:00.000Z",
    completedAt: "2026-08-17T12:00:01.000Z",
    expiresAt: "2026-08-18T12:00:00.000Z",
  };
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/management/reports/exports/export-1/content")) {
      await route.fulfill({
        json: { filename: exportRecord.filename, content: csvContent, sha256: csvSha256 },
      });
      return;
    }
    if (url.pathname.endsWith("/management/reports/exports")) {
      await route.fulfill({
        json: route.request().method() === "POST" ? exportRecord : { exports: [exportRecord] },
      });
      return;
    }
    if (url.pathname.endsWith("/management/reports/drill-down")) {
      await route.fulfill({
        json: {
          period: { from: url.searchParams.get("from"), to: url.searchParams.get("to") },
          timezone: "America/Sao_Paulo",
          dimension: url.searchParams.get("dimension"),
          key: url.searchParams.get("key"),
          totals: { amountCents: 90_000, quantity: 30 },
          rows: [
            {
              occurredAt: "2026-08-17T15:00:00.000Z",
              localDate: "2026-08-17",
              referenceType: "order",
              referenceId: "PED-101",
              label: "Prato executivo",
              amountCents: 90_000,
              quantity: 30,
            },
          ],
          page: { nextCursor: null },
        },
      });
      return;
    }
    if (url.pathname.endsWith("/management/reports/budgets")) {
      await route.fulfill({ json: { months: [] } });
      return;
    }
    if (/\/management\/reports\/budgets\/\d{4}-\d{2}$/.test(url.pathname)) {
      await route.fulfill({ json: { metric: "pos_revenue", targetCents: 100_000, version: 1 } });
      return;
    }
    if (url.pathname.endsWith("/management/reports/schedules")) {
      await route.fulfill({
        json:
          route.request().method() === "GET"
            ? { schedules: [] }
            : {
                id: "schedule-1",
                ...route.request().postDataJSON(),
                nextRunAt: null,
                lastRunAt: null,
                version: 1,
              },
      });
      return;
    }
    if (url.pathname.endsWith("/management/reports")) {
      const from = url.searchParams.get("from") ?? "";
      const to = url.searchParams.get("to") ?? "";
      requestedPeriods.push(`${from}:${to}:${url.searchParams.get("comparisonMode")}`);
      await route.fulfill({ json: report({ from, to }, from === "2026-07-01") });
      return;
    }

    const payload =
      url.pathname === "/v1/auth/me"
        ? {
            identity: {
              id: "identity-1",
              email: "finance@giromesa.test",
              displayName: "Clara Financeiro",
            },
            memberships: [{ membershipId: "membership-1", organizationId, status: "active" }],
            platformAdmin: false,
          }
        : url.pathname === "/v1/organizations"
          ? [
              {
                membershipId: "membership-1",
                organization: {
                  id: organizationId,
                  tradeName: "Grupo Aurora",
                  document: "12345678000199",
                },
                units: [
                  {
                    id: unitId,
                    name: "Matriz real",
                    city: "São Paulo",
                    timezone: "America/Sao_Paulo",
                    active: true,
                  },
                ],
                scopes: [{ role: "finance", unitId }],
              },
            ]
          : null;

    await route.fulfill(
      payload === null
        ? { status: 404, json: { message: `Mock ausente para ${url.pathname}` } }
        : { json: payload },
    );
  });
}

test("navegação sai de Relatórios ao selecionar outro módulo", async ({ page }) => {
  await mockReportsApi(page, []);
  await page.goto("/#/reports");
  await page.getByRole("button", { name: "Abrir operação" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Relatórios" })).toBeVisible();

  await page.getByRole("link", { name: "Financeiro", exact: true }).click();

  await expect(page).toHaveURL(/#\/finance$/);
  await expect(page.getByRole("heading", { level: 1, name: "Financeiro" })).toBeVisible();
});

test("financeiro consulta relatório real por período sem inventar margem", async ({ page }) => {
  const requestedPeriods: string[] = [];
  await mockReportsApi(page, requestedPeriods);
  await page.goto("/#/reports");
  await page.getByRole("button", { name: "Abrir operação" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Relatórios" })).toBeVisible();
  await expect(page.getByText("R$ 1.200,00").first()).toBeVisible();
  await expect(page.getByText("Margem ainda não calculável")).toBeVisible();
  await expect(page.getByText("Fuso: America/Sao_Paulo")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Atualização e cobertura dos dados" }),
  ).toContainText("Atualizado");
  await expect(page.getByRole("heading", { name: "Metas rateadas para o período" })).toBeVisible();
  await expect(page).toHaveURL(/reportOrganization=org-1.*reportUnit=unit-1.*#\/reports/);
  await expect(page.getByText("+25,0% vs. período anterior").first()).toBeVisible();
  await page.getByRole("button", { name: "Vendas" }).click();
  await expect(page.getByRole("heading", { name: "Desempenho comercial" })).toBeVisible();
  await page.getByRole("button", { name: "Descontos e cancelamentos" }).click();
  await expect(page.getByRole("heading", { name: "Motivos de cancelamento" })).toBeVisible();
  await page.getByRole("button", { name: "Estoque" }).click();
  await expect(page.getByRole("heading", { name: "Perdas e cobertura atual" })).toBeVisible();
  await page.getByRole("button", { name: "Compras" }).click();
  await expect(
    page.getByRole("heading", { name: "Pedidos, recebimentos e fornecedores" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Operação" }).click();
  await expect(page.getByRole("heading", { name: "Giro e atendimento das mesas" })).toBeVisible();
  await page.getByRole("button", { name: "Rentabilidade" }).click();
  await expect(page.getByRole("heading", { name: "Margem e resultado operacional" })).toBeVisible();
  await page.getByRole("button", { name: "Multiunidade" }).click();
  await expect(page.getByRole("heading", { name: "Comparativo entre unidades" })).toBeVisible();
  await page.getByRole("button", { name: "Qualidade dos dados" }).click();
  await expect(page.getByRole("heading", { name: "Confiabilidade do relatório" })).toBeVisible();
  await page.getByRole("button", { name: "Visão geral" }).click();
  await expect(page.getByRole("link", { name: "Revisar lançamentos financeiros" })).toHaveAttribute(
    "href",
    "#/finance",
  );
  await page.getByRole("button", { name: "Salvar filtro atual" }).click();
  const appliedToLabel = (await page.getByLabel("Data final").inputValue())
    .split("-")
    .reverse()
    .join("/");
  await expect(page.getByRole("region", { name: "Filtros salvos" })).toContainText(
    `01/08/2026 a ${appliedToLabel}`,
  );
  await expect(page.getByRole("button", { name: "Salvar filtro atual" })).toBeDisabled();
  await expect(
    page.getByRole("img", { name: "Receita diária comparada ao período anterior" }),
  ).toBeVisible();
  await expect(page.getByRole("table", { name: "Produtos por receita" })).toContainText(
    "Prato executivo",
  );
  await page.getByRole("button", { name: "Prato executivo" }).click();
  await expect(page.getByRole("dialog", { name: "Produtos: Prato executivo" })).toContainText(
    "PED-101",
  );
  await page.getByRole("button", { name: "Fechar" }).click();
  await page.getByRole("button", { name: "Categorias" }).click();
  await expect(page.getByRole("table", { name: "Categorias por receita" })).toContainText("Almoço");
  await page.getByRole("button", { name: "Canais" }).click();
  await expect(page.getByRole("table", { name: "Canais por receita" })).toContainText("Salão");
  await page.getByRole("button", { name: "Pagamentos" }).click();
  await expect(page.getByRole("table", { name: "Pagamentos por receita" })).toContainText("Pix");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar CSV auditado" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^relatorio-giromesa-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/,
  );
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const csv = await readFile(downloadPath as string, "utf8");
  expect(csv).toContain("America/Sao_Paulo");
  expect(csv).toContain("Prato executivo");

  await page.evaluate(() => {
    window.print = () => {
      document.body.dataset.printCalled = "true";
    };
  });
  await page.getByRole("button", { name: "Imprimir / PDF local" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-print-called", "true");

  const updateButton = page.getByRole("button", { name: "Atualizar relatório" });
  await expect(updateButton).toBeDisabled();
  expect((await updateButton.boundingBox())?.width).toBeLessThan(240);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole("button", { name: "Exportar CSV auditado" })).toBeHidden();
  await page.getByRole("button", { name: "Mais ações" }).click();
  await expect(page.getByRole("button", { name: "Exportar CSV auditado" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.getByLabel("Data inicial").fill("2026-07-01");
  await page.getByLabel("Data final").fill("2026-07-31");
  await expect(updateButton).toBeEnabled();
  await updateButton.click();

  await expect.poll(() => requestedPeriods.at(-1)).toBe("2026-07-01:2026-07-31:previous_period");
  await expect(page.getByText("Período sem movimentação")).toBeVisible();
});
