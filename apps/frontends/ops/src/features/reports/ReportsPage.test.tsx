import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  parseReportDrillDown,
  parseReports,
  RemoteGate,
  type ReportData,
} from "../../management.shared";
import {
  csvCell,
  parseSavedReportFilters,
  ReportContent,
  reportFiltersFromUrl,
  reportUrl,
} from "./ReportsPage";

const emptyReport: ReportData = {
  period: { from: "2026-08-01", to: "2026-08-16" },
  timezone: "America/Sao_Paulo",
  previousPeriod: { from: "2026-07-16", to: "2026-07-31" },
  comparison: {
    mode: "previous_period",
    revenueCents: 0,
    previousRevenueCents: 0,
    changeCents: 0,
    changePercent: null,
  },
  dailySeries: [],
  breakdowns: { products: [], categories: [], channels: [], paymentMethods: [] },
  cashFlow: { inflowsCents: 0, outflowsCents: 0, netCents: 0, basis: "realized_payments_utc" },
  incomeStatement: {
    revenueCents: 0,
    cmvCents: null,
    grossMarginCents: null,
    operatingExpensesCents: 0,
    operatingResultCents: null,
    costCoverage: { coverage: "unavailable", missingCostLines: 0, completeForRevenue: false },
    basis: "competence",
  },
  meta: {
    generatedAt: "2026-08-16T15:00:00.000Z",
    dataThrough: "2026-08-16T14:59:00.000Z",
    sourceCounts: {
      posSales: 0,
      receivablePayments: 0,
      payablePayments: 0,
      receivables: 0,
      payables: 0,
      costLines: 0,
    },
    coverage: {
      sales: "complete",
      cashFlow: "complete",
      costs: "unavailable",
      budget: "unavailable",
    },
  },
  capabilities: {
    viewCosts: true,
    drillDown: false,
    export: false,
    manageBudget: false,
    manageSchedules: false,
    emailDeliveryConfigured: false,
  },
  budget: null,
  reportFamilies: {
    sales: {
      coverage: "complete",
      closedTabs: 0,
      subtotalCents: 0,
      discountsCents: 0,
      netRevenueCents: 0,
      averageTicketCents: null,
      guests: 0,
      averageSpendPerGuestCents: null,
      hourly: [],
      comparison: {},
    },
    exceptions: {
      coverage: "complete",
      canceledItems: 0,
      canceledValueCents: 0,
      discountedItems: 0,
      itemDiscountCents: 0,
      tabDiscountCents: 0,
      cancellationReasons: [],
      comparison: {},
    },
    inventory: {
      coverage: "complete",
      basis: "period_events_and_current_balance",
      lossEvents: 0,
      lossQuantity: 0,
      lossValueCents: null,
      stockoutItems: 0,
      lowStockItems: 0,
      currentInventoryValueCents: null,
      analysis: [],
      comparison: {},
    },
    purchasing: {
      coverage: "complete",
      orderCount: 0,
      orderedCents: 0,
      canceledOrders: 0,
      receiptCount: 0,
      receivedCents: 0,
      suppliers: [],
      supplierPerformance: [],
      comparison: {},
    },
    operations: {
      coverage: "complete",
      closedTabs: 0,
      dineInTabs: 0,
      tableTurnovers: 0,
      guests: 0,
      averageGuestsPerTab: null,
      averageServiceMinutes: null,
      shifts: [],
      comparison: {},
    },
    profitability: {
      coverage: "unavailable",
      grossMarginPercent: null,
      productProfitabilityCoverage: "unavailable",
      products: [],
      comparison: {},
    },
    multiunit: { coverage: "unavailable", units: [] },
    quality: { scorePercent: 100, issues: [] },
  },
};

describe("relatórios operacionais", () => {
  it("mantém ações e seções visíveis quando o período está vazio", () => {
    const html = renderToStaticMarkup(<ReportContent data={emptyReport} />);
    expect(html).toContain("Período sem movimentação");
    expect(html).toContain("Baixar CSV local");
    expect(html).toContain("Imprimir / PDF");
    expect(html).toContain("Receita diária");
    expect(html).toContain("Detalhamento de vendas");
    expect(html).toContain("DRE gerencial");
    expect(html).toContain("Atualização e cobertura dos dados");
    expect(html).toContain("Biblioteca de relatórios");
    expect(html).toContain("Descontos e cancelamentos");
  });

  it("persiste filtros e escopo antes do hash e restaura apenas o escopo correspondente", () => {
    const scope = { organizationId: "org-1", unitId: "unit-1" };
    const url = reportUrl(new URL("https://ops.test/#/reports"), scope, {
      period: { from: "2026-08-01", to: "2026-08-16" },
      comparisonMode: "previous_year",
    });
    expect(url.toString()).toContain(
      "?reportOrganization=org-1&reportUnit=unit-1&reportFrom=2026-08-01&reportTo=2026-08-16&reportComparison=previous_year#/reports",
    );
    expect(reportFiltersFromUrl(url, scope)?.comparisonMode).toBe("previous_year");
    expect(reportFiltersFromUrl(url, { ...scope, unitId: "unit-2" })).toBeNull();
  });

  it("ignora favoritos locais inválidos", () => {
    expect(parseSavedReportFilters("not-json")).toEqual([]);
    expect(
      parseSavedReportFilters(
        JSON.stringify([
          {
            period: { from: "2026-08-01", to: "2026-08-16" },
            comparisonMode: "previous_year",
          },
          { period: { from: "invalid", to: "2026-08-16" }, comparisonMode: "none" },
        ]),
      ),
    ).toEqual([
      {
        id: "2026-08-01:2026-08-16:previous_year",
        period: { from: "2026-08-01", to: "2026-08-16" },
        comparisonMode: "previous_year",
      },
    ]);
  });

  it("mostra delta confiável, ação de correção e agrupamento secundário", () => {
    const html = renderToStaticMarkup(
      <ReportContent
        data={{
          ...emptyReport,
          comparison: {
            mode: "previous_period",
            revenueCents: 125_000,
            previousRevenueCents: 100_000,
            changeCents: 25_000,
            changePercent: 25,
          },
        }}
        scope={{ organizationId: "org-1", unitId: "unit-1", profileId: "owner" }}
      />,
    );
    expect(html).toContain("+25,0% vs. período anterior");
    expect(html).toContain('href="#/purchases"');
    expect(html).toContain("Revisar compras e custos");
    expect(html).toContain("Mais ações");
  });

  it("neutraliza fórmulas em células de CSV local", () => {
    expect(csvCell('=HYPERLINK("https://example.test")')).toBe(
      '"\'=HYPERLINK(""https://example.test"")"',
    );
    expect(csvCell("  @SUM(1+1)")).toBe("'  @SUM(1+1)");
    expect(csvCell(-120)).toBe("-120");
  });

  it("aceita ocorrência nula e id legado no drill-down sem perder os totais", () => {
    const parsed = parseReportDrillDown({
      period: { from: "2026-08-01", to: "2026-08-16" },
      timezone: "America/Sao_Paulo",
      dimension: "metric",
      key: "competence_revenue",
      rows: [
        {
          id: "entry-1",
          occurredAt: null,
          localDate: "2026-08-03",
          referenceType: "receivable",
          label: "Venda",
          amountCents: 2500,
          quantity: 1,
        },
      ],
      page: { nextCursor: null },
    });
    expect(parsed.rows[0]?.referenceId).toBe("entry-1");
    expect(parsed.rows[0]?.occurredAt).toBeNull();
    expect(parsed.totals).toEqual({ amountCents: 2500, quantity: 1 });
  });

  it("mantém compatibilidade quando a API ainda não envia a família de qualidade", () => {
    const legacy = structuredClone(emptyReport) as unknown as {
      reportFamilies: Partial<ReportData["reportFamilies"]>;
    };
    delete legacy.reportFamilies.quality;
    expect(parseReports(legacy).reportFamilies.quality).toEqual({ scorePercent: 100, issues: [] });
  });

  it("não transforma custo restrito em zero", () => {
    const restricted: ReportData = {
      ...emptyReport,
      capabilities: { ...emptyReport.capabilities, viewCosts: false },
      incomeStatement: {
        ...emptyReport.incomeStatement,
        cmvCents: null,
        grossMarginCents: null,
        operatingExpensesCents: null,
        operatingResultCents: null,
      },
    };
    const html = renderToStaticMarkup(<ReportContent data={restricted} />);
    expect(html).not.toContain("Margem bruta");
    expect(html).not.toContain("DRE gerencial");
  });

  it("mostra referência amigável sem expor a mensagem interna de erro 5xx", () => {
    const html = renderToStaticMarkup(
      <RemoteGate
        remote={{
          state: {
            status: "error",
            httpStatus: 503,
            message: "database connection refused",
            requestId: "req-report-123",
          },
          retry: () => undefined,
        }}
      >
        {() => null}
      </RemoteGate>,
    );
    expect(html).toContain("Serviço temporariamente indisponível");
    expect(html).toContain("req-report-123");
    expect(html).not.toContain("database connection refused");
  });
});
