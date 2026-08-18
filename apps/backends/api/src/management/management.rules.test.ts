import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConflictException } from "@nestjs/common";
import {
  assertManagementScope,
  COMMISSION_CENTS_MAX,
  cashConference,
  commissionAmountFromBasisPoints,
  inventoryChange,
  managementReplay,
  managementRequestHash,
  profitabilityCoverage,
  purchaseLineReconciliation,
  purchaseReceiptPlan,
  purchaseStockConversion,
  reportPercentageChange,
  reportPeriodContext,
  settlement,
} from "./management.rules.js";

describe("management rules", () => {
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
        suppliesCents: 5_000,
        withdrawalsCents: 2_500,
        cashReceiptsCents: 37_000,
        countedCents: 59_000,
      }),
      { expectedCents: 59_500, differenceCents: -500 },
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
