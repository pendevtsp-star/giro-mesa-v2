import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  assertCashDrawerDebit,
  assertManagementScope,
  COMMISSION_CENTS_MAX,
  canGrantPersonAccessRole,
  cashConference,
  cashDifferenceSeverity,
  cashTenderConference,
  cashTransferLockOrder,
  commissionAmountFromBasisPoints,
  financialInstallmentSchedule,
  inventoryChange,
  managementReplay,
  managementRequestHash,
  personAccessPublicStatus,
  profitabilityCoverage,
  purchaseLineReconciliation,
  purchaseReceiptPlan,
  purchaseStockConversion,
  reportPercentageChange,
  reportPeriodContext,
  requiresCashApproval,
  settlement,
} from "./management.rules.js";
import { cashShiftExportQuerySchema, closeCashShiftSchema } from "./management.schemas.js";

describe("management rules", () => {
  it("gera parcelas mensais preservando o fim do mês", () => {
    assert.deepEqual(financialInstallmentSchedule("2026-01-31", "2026-01-31", 3, 1), [
      { installmentNumber: 1, competenceDate: "2026-01-31", dueDate: "2026-01-31" },
      { installmentNumber: 2, competenceDate: "2026-02-28", dueDate: "2026-02-28" },
      { installmentNumber: 3, competenceDate: "2026-03-31", dueDate: "2026-03-31" },
    ]);
  });

  it("impede escalada de acesso e deriva expiração sem estado duplicado", () => {
    assert.equal(canGrantPersonAccessRole("manager", "waiter"), true);
    assert.equal(canGrantPersonAccessRole("manager", "finance"), false);
    assert.equal(canGrantPersonAccessRole("owner", "manager"), true);
    assert.equal(canGrantPersonAccessRole("owner", "owner"), false);
    assert.equal(
      personAccessPublicStatus(
        "pending",
        new Date("2026-01-01T00:00:00Z"),
        new Date("2026-01-02T00:00:00Z"),
      ),
      "expired",
    );
    assert.equal(personAccessPublicStatus("terminated", null), "none");
  });

  it("keeps calculated commissions inside PostgreSQL integer cents", () => {
    assert.equal(
      commissionAmountFromBasisPoints(COMMISSION_CENTS_MAX, 10_000),
      COMMISSION_CENTS_MAX,
    );
    assert.throws(
      () => commissionAmountFromBasisPoints(COMMISSION_CENTS_MAX + 1, 10_000),
      /baseCents deve estar entre/,
    );
  });

  it("blocks negative inventory unless the item explicitly allows it", () => {
    assert.throws(() => inventoryChange("2.000", "loss", "2.001", false), ConflictException);
    assert.deepEqual(inventoryChange("2.000", "loss", "2.001", true), {
      previousQuantity: "2.000",
      quantityDelta: "-2.001",
      resultingQuantity: "-0.001",
    });
  });

  it("plans the entire purchase receipt before persistence", () => {
    const items = [
      { id: "item-a", quantity: "2.000", receivedQuantity: "0.500", unitCostCents: 1_250 },
      { id: "item-b", quantity: "3.000", receivedQuantity: "0.000", unitCostCents: 500 },
    ];
    assert.deepEqual(
      purchaseReceiptPlan(items, [
        { purchaseOrderItemId: "item-a", quantity: "1.500" },
        { purchaseOrderItemId: "item-b", quantity: "2.000" },
      ]),
      {
        updates: [
          {
            purchaseOrderItemId: "item-a",
            quantityMilli: 1_500,
            nextReceivedQuantity: "2.000",
            totalCents: 1_875,
          },
          {
            purchaseOrderItemId: "item-b",
            quantityMilli: 2_000,
            nextReceivedQuantity: "2.000",
            totalCents: 1_000,
          },
        ],
        totalCents: 2_875,
      },
    );
    assert.throws(
      () =>
        purchaseReceiptPlan(items, [
          { purchaseOrderItemId: "item-a", quantity: "1.500" },
          { purchaseOrderItemId: "item-b", quantity: "3.001" },
        ]),
      ConflictException,
    );
  });

  it("converts purchase packages into stock units without changing the receipt total", () => {
    assert.deepEqual(purchaseStockConversion("2", "12", 12_000), {
      purchaseMilli: 2_000,
      stockMilli: 24_000,
      purchaseQuantity: "2.000",
      stockQuantity: "24.000",
      totalCents: 24_000,
      stockUnitCostCents: 1_000,
    });
  });

  it("reconciles each purchase item without offsetting opposite divergences", () => {
    const result = purchaseLineReconciliation(
      [
        {
          purchaseOrderItemId: "item-a",
          orderedQuantity: "1.000",
          orderedUnitCostCents: 1_000,
          orderedCents: 1_000,
          receivedQuantity: "1.000",
          receivedCents: 1_000,
          invoicedQuantity: "1.000",
          invoicedUnitCostCents: 1_100,
          invoicedCents: 1_100,
        },
        {
          purchaseOrderItemId: "item-b",
          orderedQuantity: "1.000",
          orderedUnitCostCents: 1_000,
          orderedCents: 1_000,
          receivedQuantity: "1.000",
          receivedCents: 1_000,
          invoicedQuantity: "1.000",
          invoicedUnitCostCents: 900,
          invoicedCents: 900,
        },
      ],
      0,
    );

    assert.equal(result.matched, false);
    assert.deepEqual(
      result.lines.map((line) => [line.purchaseOrderItemId, line.invoicedVsReceivedCents]),
      [
        ["item-a", 100],
        ["item-b", -100],
      ],
    );
  });

  it("rejects cross-tenant and cross-unit references", () => {
    assert.throws(
      () =>
        assertManagementScope(
          { organizationId: "org-a", unitId: "unit-a" },
          { organizationId: "org-b", unitId: "unit-a" },
        ),
      ConflictException,
    );
    assert.throws(
      () =>
        assertManagementScope(
          { organizationId: "org-a", unitId: "unit-a" },
          { organizationId: "org-a", unitId: "unit-b" },
        ),
      ConflictException,
    );
  });

  it("replays identical idempotent payloads and rejects key reuse with another payload", () => {
    const first = managementRequestHash("payable-payment", { amountCents: 1_000, method: "pix" });
    const reordered = managementRequestHash("payable-payment", {
      method: "pix",
      amountCents: 1_000,
    });
    assert.equal(first, reordered);
    assert.deepEqual(
      managementReplay({ payloadHash: first, response: { paymentId: "payment-1" } }, reordered),
      {
        paymentId: "payment-1",
        idempotentReplay: true,
      },
    );
    assert.throws(
      () =>
        managementReplay(
          { payloadHash: first, response: { paymentId: "payment-1" } },
          managementRequestHash("payable-payment", { amountCents: 2_000, method: "pix" }),
        ),
      ConflictException,
    );
  });

  it("closes cash with supplies, withdrawals and realized cash receipts", () => {
    assert.deepEqual(
      cashConference({
        openingCents: 20_000,
        drawerInCents: 42_000,
        drawerOutCents: 2_500,
        countedCents: 59_000,
      }),
      { expectedCents: 59_500, differenceCents: -500 },
    );
    assert.throws(
      () => assertCashDrawerDebit(999, 1_000),
      (error: unknown) => {
        const response = (error as ConflictException).getResponse();
        return typeof response === "object" && response !== null && "code" in response
          ? response.code === "CASH_DRAWER_INSUFFICIENT"
          : false;
      },
    );
    assert.deepEqual(cashTransferLockOrder("shift-b", "shift-a"), ["shift-a", "shift-b"]);
    assert.throws(() => cashTransferLockOrder("shift-a", "shift-a"), ConflictException);
  });

  it("conferences every expected tender and applies approval and discrepancy thresholds", () => {
    const breakdown = cashTenderConference(
      new Map([
        ["cash" as const, 10_000],
        ["pix" as const, 5_000],
      ]),
      [
        { method: "cash", observedCents: 9_500, source: "manual" },
        { method: "pix", observedCents: 5_000, source: "smartpos" },
      ],
    );
    assert.deepEqual(breakdown, [
      {
        method: "cash",
        expectedCents: 10_000,
        observedCents: 9_500,
        differenceCents: -500,
        source: "manual",
      },
      {
        method: "pix",
        expectedCents: 5_000,
        observedCents: 5_000,
        differenceCents: 0,
        source: "smartpos",
      },
    ]);
    assert.equal(cashDifferenceSeverity(breakdown, 1_000), "warning");
    assert.equal(cashDifferenceSeverity(breakdown, 500), "critical");
    assert.equal(requiresCashApproval("cashier", 50_001, 50_000), true);
    assert.equal(requiresCashApproval("cashier", 50_000, 50_000), false);
    assert.equal(requiresCashApproval("manager", 90_000, 50_000), false);
    assert.throws(
      () =>
        cashTenderConference(new Map([["pix", 5_000]]), [
          { method: "cash", observedCents: 0, source: "manual" },
        ]),
      (error: unknown) => {
        const response = (error as BadRequestException).getResponse();
        return typeof response === "object" && response !== null && "code" in response
          ? response.code === "CASH_TENDER_COUNTS_INCOMPLETE"
          : false;
      },
    );
  });

  it("keeps cash export filters importable and rejects browser smartpos evidence", () => {
    assert.deepEqual(
      cashShiftExportQuerySchema.parse({ format: "csv", from: "2026-08-01", to: "2026-08-21" }),
      { format: "csv", from: "2026-08-01", to: "2026-08-21" },
    );
    assert.equal(
      closeCashShiftSchema.safeParse({
        tenderCounts: [{ method: "cash", observedCents: 1_000, source: "smartpos" }],
      }).success,
      false,
    );
  });

  it("blocks overpayment and withholds CMV when cost coverage is incomplete", () => {
    assert.deepEqual(settlement(10_000, 2_000, 3_000), { settledCents: 5_000, status: "partial" });
    assert.throws(() => settlement(10_000, 9_000, 1_001), ConflictException);
    assert.deepEqual(
      profitabilityCoverage([
        { revenueCents: 10_000, costCents: 4_000 },
        { revenueCents: 5_000, costCents: null },
      ]),
      {
        coverage: "partial",
        revenueCents: 15_000,
        coveredRevenueCents: 10_000,
        missingCostLines: 1,
        cmvCents: null,
        grossMarginCents: null,
      },
    );
  });

  it("aligns the previous report period and percentage comparison", () => {
    assert.deepEqual(reportPeriodContext({ from: "2024-02-28", to: "2024-03-01" }), {
      dates: ["2024-02-28", "2024-02-29", "2024-03-01"],
      previousDates: ["2024-02-25", "2024-02-26", "2024-02-27"],
      previousPeriod: { from: "2024-02-25", to: "2024-02-27" },
    });
    assert.equal(reportPercentageChange(12_000, 10_000), 20);
    assert.equal(reportPercentageChange(0, 0), null);
  });

  it("supports previous-year and disabled comparisons without inventing leap-day data", () => {
    assert.deepEqual(
      reportPeriodContext({ from: "2024-02-29", to: "2024-03-01" }, "previous_year"),
      {
        dates: ["2024-02-29", "2024-03-01"],
        previousDates: [null, "2023-03-01"],
        previousPeriod: { from: "2023-02-28", to: "2023-03-01" },
      },
    );
    assert.deepEqual(reportPeriodContext({ from: "2026-08-01", to: "2026-08-01" }, "none"), {
      dates: ["2026-08-01"],
      previousDates: [null],
      previousPeriod: null,
    });
  });
});
