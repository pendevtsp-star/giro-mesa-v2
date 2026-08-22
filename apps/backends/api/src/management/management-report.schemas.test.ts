import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  reportAlertActionSchema,
  reportCostBackfillSchema,
  reportDrillDownQuerySchema,
  reportExportInputSchema,
  reportQuerySchema,
  reportReconciliationClosureSchema,
  reportScheduleCreateSchema,
  reportViewCreateSchema,
} from "./management-report.schemas.js";

describe("management report schemas", () => {
  it("accepts CMV only as a protected metric drill-down", () => {
    assert.equal(
      reportDrillDownQuerySchema.safeParse({
        from: "2026-08-01",
        to: "2026-08-31",
        dimension: "metric",
        key: "cmv",
      }).success,
      true,
    );
  });

  it("applies the report range ordering and maximum to budget listing", () => {
    assert.equal(
      reportExportInputSchema.safeParse({ from: "2026-09-01", to: "2026-08-01" }).success,
      false,
    );
    assert.equal(
      reportExportInputSchema.safeParse({ from: "2025-01-01", to: "2026-08-01" }).success,
      false,
    );
  });

  it("requires recurrence fields matching the schedule frequency", () => {
    assert.equal(
      reportScheduleCreateSchema.safeParse({
        name: "Semanal",
        frequency: "weekly",
        weekday: null,
        dayOfMonth: null,
        localTime: "08:00",
        range: "previous_week",
        comparisonMode: "previous_period",
        delivery: "in_app",
        enabled: true,
      }).success,
      false,
    );
    assert.equal(
      reportScheduleCreateSchema.safeParse({
        name: "Mensal por unidade",
        frequency: "monthly",
        weekday: null,
        dayOfMonth: 29,
        localTime: "08:00",
        range: "previous_month",
        comparisonMode: "previous_period",
        family: "multiunit",
        delivery: "in_app",
        enabled: true,
      }).success,
      false,
    );
  });

  it("accepts operational drill-down and family exports", () => {
    assert.equal(
      reportDrillDownQuerySchema.safeParse({
        from: "2026-08-01",
        to: "2026-08-31",
        dimension: "inventory",
        key: "loss",
      }).success,
      true,
    );
    assert.equal(
      reportExportInputSchema.safeParse({
        from: "2026-08-01",
        to: "2026-08-31",
        family: "forecast",
        format: "xlsx",
      }).success,
      true,
    );
    assert.equal(
      reportExportInputSchema.safeParse({
        from: "2026-08-01",
        to: "2026-08-31",
        family: "labor",
        format: "pdf",
      }).success,
      true,
    );
  });

  it("validates shared views, alert actions and explicit estimated cost backfill", () => {
    assert.equal(
      reportViewCreateSchema.safeParse({
        name: "Fechamento semanal",
        visibility: "unit",
        query: {
          from: "2026-08-01",
          to: "2026-08-07",
          comparisonMode: "previous_period",
          family: "reconciliation",
        },
        isDefault: true,
        sortOrder: 4,
      }).success,
      true,
    );
    assert.equal(
      reportAlertActionSchema.safeParse({ status: "resolved", version: 2, comment: "Revisado" })
        .success,
      true,
    );
    assert.equal(
      reportQuerySchema.safeParse({
        from: "2026-08-01",
        to: "2026-08-31",
        family: "multiunit",
        minimumComparableOperatingDays: 7,
      }).success,
      true,
    );
    assert.equal(
      reportReconciliationClosureSchema.safeParse({
        from: "2026-08-01",
        to: "2026-08-31",
        status: "closed",
        checklist: { payments: true, fiscal: true, external: true },
        note: "Fechamento conferido",
        evidence: ["https://example.test/evidence/1"],
      }).success,
      true,
    );
    assert.equal(
      reportCostBackfillSchema.safeParse({
        from: "2026-08-01",
        to: "2026-08-31",
        comparisonMode: "none",
        allowEstimated: false,
      }).success,
      false,
    );
  });
});
