import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildScheduledReportCsv,
  nextReportRun,
  reportContentSha256,
  reportCsvCell,
  scheduledReportRange,
} from "./reports.js";

describe("scheduled reports", () => {
  it("advances weekly and monthly recurrences in the unit timezone", () => {
    const weekly = nextReportRun(
      { frequency: "weekly", weekday: 1, dayOfMonth: null, localTime: "09:30:00" },
      new Date("2026-08-17T12:30:00.000Z"),
      "America/Sao_Paulo",
    );
    assert.equal(weekly.toISOString(), "2026-08-24T12:30:00.000Z");

    const monthly = nextReportRun(
      { frequency: "monthly", weekday: null, dayOfMonth: 28, localTime: "08:00:00" },
      new Date("2026-01-28T11:00:00.000Z"),
      "America/Sao_Paulo",
    );
    assert.equal(monthly.toISOString(), "2026-02-28T11:00:00.000Z");
  });

  it("derives completed calendar ranges without UTC boundary drift", () => {
    const scheduledFor = new Date("2026-08-17T12:00:00.000Z");
    assert.deepEqual(scheduledReportRange("previous_week", scheduledFor, "America/Sao_Paulo"), {
      from: "2026-08-10",
      to: "2026-08-16",
    });
    assert.deepEqual(scheduledReportRange("previous_month", scheduledFor, "America/Sao_Paulo"), {
      from: "2026-07-01",
      to: "2026-07-31",
    });
  });

  it("creates deterministic CSV and neutralizes spreadsheet formulas", () => {
    assert.equal(reportCsvCell("=1+1"), "'=1+1");
    assert.equal(reportCsvCell("  +1+1"), "'  +1+1");
    const csv = buildScheduledReportCsv(
      {
        from: "2026-08-10",
        to: "2026-08-16",
        timezone: "America/Sao_Paulo",
        includeCosts: true,
      },
      {
        sales: [
          {
            date: "2026-08-12",
            channel: "dine_in",
            quantity: 2,
            subtotal_cents: 10_000,
            discount_cents: 500,
            service_charge_cents: 1_000,
            tip_cents: 0,
            revenue_cents: 10_500,
          },
        ],
        cashFlow: { inflowsCents: 12_000, outflowsCents: 3_000, netCents: 9_000 },
        incomeStatement: {
          revenueCents: 10_500,
          cmvCents: 4_000,
          grossMarginCents: 6_500,
          operatingExpensesCents: 1_000,
          operatingResultCents: 5_500,
          costCoverage: "complete",
        },
        breakdowns: {
          products: [{ key: "p1", label: "Prato", quantity: 2, revenue_cents: 10_500 }],
          categories: [],
          channels: [{ key: "dine_in", label: "dine_in", quantity: 2, revenue_cents: 10_500 }],
          paymentMethods: [],
        },
      },
    );
    assert.match(csv, /^\uFEFFseção;data;chave;rótulo;/);
    assert.match(csv, /2026-08-12;dine_in;dine_in;2;10000;500;1000;0;10500/);
    assert.match(csv, /fluxo_caixa;;saídas;Saídas realizadas;;;;;;;3000;complete/);
    assert.match(csv, /dre;;cmv;CMV;;;;;;;4000;complete/);
    assert.match(csv, /detalhamento_products;;p1;Prato;2;;;;;10500;;/);
    assert.equal(reportContentSha256(csv), reportContentSha256(csv));
    assert.match(reportContentSha256(csv), /^[a-f0-9]{64}$/);
  });

  it("omits cost-sensitive values when the recipient lacks costs permission", () => {
    const csv = buildScheduledReportCsv(
      { from: "2026-08-10", to: "2026-08-16", timezone: "UTC", includeCosts: false },
      {
        sales: [],
        cashFlow: { inflowsCents: 100, outflowsCents: 90, netCents: 10 },
        incomeStatement: {
          revenueCents: 100,
          cmvCents: 70,
          grossMarginCents: 30,
          operatingExpensesCents: 20,
          operatingResultCents: 10,
          costCoverage: "complete",
        },
        breakdowns: { products: [], categories: [], channels: [], paymentMethods: [] },
      },
    );
    assert.doesNotMatch(csv, /saídas|cmv|despesas_operacionais|resultado_operacional/);
    assert.match(csv, /custos_incluídos;;;;;;;;não;/);
  });

  it("exports only the scheduled report family", () => {
    const csv = buildScheduledReportCsv(
      {
        from: "2026-08-10",
        to: "2026-08-16",
        timezone: "UTC",
        includeCosts: true,
        family: "quality",
      },
      {
        sales: [],
        cashFlow: { inflowsCents: 0, outflowsCents: 0, netCents: 0 },
        incomeStatement: {
          revenueCents: 0,
          cmvCents: null,
          grossMarginCents: null,
          operatingExpensesCents: 0,
          operatingResultCents: null,
          costCoverage: "unavailable",
        },
        breakdowns: { products: [], categories: [], channels: [], paymentMethods: [] },
        familyRows: [
          {
            section: "quality",
            key: "missing_cost",
            label: "Sem custo",
            quantity: 2,
            revenue_cents: 0,
          },
          {
            section: "operations",
            key: "closed_tabs",
            label: "Contas",
            quantity: 3,
            revenue_cents: 100,
          },
        ],
      },
    );
    assert.match(csv, /familia_quality;;missing_cost;Sem custo;2/);
    assert.doesNotMatch(csv, /familia_operations/);
  });
});
