import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  csvCell,
  nextReportRun,
  proratedBudgetTarget,
  reportBudgetCoverage,
  reportCsv,
  reportPageOffset,
} from "./management-report.rules.js";

describe("management report rules", () => {
  it("prorates monthly budgets by overlapping calendar days", () => {
    assert.equal(proratedBudgetTarget("2026-08", 3_100, "2026-08-01", "2026-08-10"), 1_000);
    assert.equal(proratedBudgetTarget("2026-07", 3_100, "2026-08-01", "2026-08-10"), 0);
  });

  it("requires every target in every covered month for complete budget coverage", () => {
    const metrics = ["revenue", "expenses"];
    assert.equal(
      reportBudgetCoverage(
        ["2026-01", "2026-02"],
        [
          { month: "2026-01-01", metric: "revenue" },
          { month: "2026-02-01", metric: "expenses" },
        ],
        metrics,
      ),
      "partial",
    );
    assert.equal(
      reportBudgetCoverage(
        ["2026-01", "2026-02"],
        [
          { month: "2026-01-01", metric: "revenue" },
          { month: "2026-01-01", metric: "expenses" },
          { month: "2026-02-01", metric: "revenue" },
          { month: "2026-02-01", metric: "expenses" },
        ],
        metrics,
      ),
      "complete",
    );
  });

  it("emits Excel-compatible UTF-8 CSV while neutralizing formulas", () => {
    assert.equal(csvCell("=2+2"), '"\'=2+2"');
    const csv = reportCsv([{ label: "+SUM(A1)", amountCents: 100 }]);
    assert.ok(csv.startsWith("\uFEFF"));
    assert.match(csv, /"label";"amountCents"\r\n/);
    assert.match(csv, /"'\+SUM\(A1\)";"100"/);
  });

  it("rejects malformed pagination cursors", () => {
    assert.throws(() => reportPageOffset("not-a-cursor"), BadRequestException);
  });

  it("calculates the next weekly run in the unit timezone", () => {
    const next = nextReportRun(
      { frequency: "weekly", weekday: 1, dayOfMonth: null, localTime: "08:00" },
      "America/Sao_Paulo",
      new Date("2026-08-16T12:00:00.000Z"),
    );
    assert.equal(next.toISOString(), "2026-08-17T11:00:00.000Z");
  });

  it("skips a local time that does not exist during a DST gap", () => {
    const next = nextReportRun(
      { frequency: "weekly", weekday: 0, dayOfMonth: null, localTime: "02:30" },
      "America/New_York",
      new Date("2026-03-07T12:00:00.000Z"),
    );
    assert.equal(next.toISOString(), "2026-03-15T06:30:00.000Z");
  });
});
