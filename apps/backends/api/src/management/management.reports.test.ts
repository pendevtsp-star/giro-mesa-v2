import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTimeTrackingReadPolicy,
  buildReportFamilies,
  buildReportSalesAnalytics,
  buildTimeTrackingAlerts,
  reportMetricComparison,
  summarizeTimeEntries,
  timeTrackingEntryForRead,
} from "./management.service.js";

function hasCode(expected: string) {
  return (error: unknown) => {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (
      typeof response === "object" &&
      response !== null &&
      (response as { code?: string }).code === expected
    );
  };
}

describe("management sales reports", () => {
  it("aligns daily revenue and aggregates stable breakdown lines", () => {
    const result = buildReportSalesAnalytics(
      { from: "2026-08-02", to: "2026-08-03" },
      [
        { date: "2026-07-31", channel: "dine_in", revenueCents: 4_000, quantity: 1 },
        { date: "2026-08-01", channel: "pickup", revenueCents: 6_000, quantity: 2 },
        { date: "2026-08-02", channel: "dine_in", revenueCents: 8_000, quantity: 2 },
        { date: "2026-08-02", channel: "delivery", revenueCents: 2_000, quantity: 1 },
      ],
      [
        {
          productId: "product-1",
          productName: "Prato",
          categoryId: "category-1",
          categoryName: "Refeições",
          revenueCents: 7_000,
          quantity: 3,
        },
        {
          productId: "product-2",
          productName: "Suco",
          categoryId: "category-1",
          categoryName: "Refeições",
          revenueCents: 2_000,
          quantity: 2,
        },
      ],
      [{ method: "pix", revenueCents: 10_000, quantity: 2 }],
    );

    assert.deepEqual(result.previousPeriod, { from: "2026-07-31", to: "2026-08-01" });
    assert.deepEqual(result.comparison, {
      mode: "previous_period",
      period: { from: "2026-07-31", to: "2026-08-01" },
      revenueCents: 10_000,
      previousRevenueCents: 10_000,
      changeCents: 0,
      changePercent: 0,
    });
    assert.deepEqual(result.dailySeries, [
      { date: "2026-08-02", revenueCents: 10_000, previousRevenueCents: 4_000 },
      { date: "2026-08-03", revenueCents: 0, previousRevenueCents: 6_000 },
    ]);
    assert.deepEqual(result.breakdowns.categories, [
      {
        key: "category-1",
        label: "Refeições",
        revenueCents: 9_000,
        quantity: 5,
      },
    ]);
    assert.deepEqual(result.breakdowns.channels, [
      { key: "dine_in", label: "Salão", revenueCents: 8_000, quantity: 2 },
      { key: "delivery", label: "Delivery", revenueCents: 2_000, quantity: 1 },
    ]);
    assert.deepEqual(result.breakdowns.paymentMethods, [
      { key: "pix", label: "Pix", revenueCents: 10_000, quantity: 2 },
    ]);
  });

  it("builds report families without inventing averages", () => {
    const result = buildReportFamilies({
      salesCoverage: "complete",
      tabs: {
        closedTabs: 2,
        dineInTabs: 1,
        tableTurnovers: 1,
        guests: 4,
        subtotalCents: 21_000,
        discountCents: 1_000,
        netRevenueCents: 22_000,
        averageServiceMinutes: 52,
      },
      exceptions: {
        canceledItems: 1,
        canceledValueCents: 2_000,
        discountedItems: 2,
        itemDiscountCents: 1_000,
      },
      cancellationReasons: [{ label: "Erro de lançamento", quantity: 1, amountCents: 2_000 }],
      inventory: {
        lossEvents: 1,
        lossQuantity: 2.5,
        stockoutItems: 2,
        lowStockItems: 3,
        currentInventoryValueCents: null,
      },
      purchasing: {
        orderCount: 2,
        orderedCents: 10_000,
        canceledOrders: 0,
        receiptCount: 1,
        receivedCents: 4_000,
        suppliers: [],
      },
      profitability: { coverage: "complete", grossMarginCents: 6_000, revenueCents: 20_000 },
    });

    assert.equal(result.sales.averageTicketCents, 11_000);
    assert.equal(result.sales.averageSpendPerGuestCents, 5_500);
    assert.equal(result.operations.averageGuestsPerTab, 2);
    assert.equal(result.profitability.grossMarginPercent, 30);
    assert.equal(result.profitability.productProfitabilityCoverage, "complete");
    assert.deepEqual(reportMetricComparison(125, 100), {
      current: 125,
      previous: 100,
      change: 25,
      changePercent: 25,
    });
  });

  it("deducts closed pauses and exposes operational anomalies", () => {
    const clockedInAt = new Date("2026-08-17T08:00:00.000Z");
    const result = summarizeTimeEntries(
      [
        {
          id: "entry-1",
          personId: "person-1",
          clockedInAt,
          clockedOutAt: new Date("2026-08-17T17:00:00.000Z"),
        },
      ],
      [
        {
          id: "break-1",
          timeEntryId: "entry-1",
          startedAt: new Date("2026-08-17T12:00:00.000Z"),
          endedAt: new Date("2026-08-17T13:00:00.000Z"),
        },
      ],
      [],
      new Set(),
    );
    assert.equal(result[0]?.workedMinutes, 480);
    assert.equal(result[0]?.breakMinutes, 60);
    assert.deepEqual(result[0]?.anomalyCodes, []);
  });

  it("applies configured journey rules and detects device risks", () => {
    const firstIn = new Date("2026-08-17T08:30:00.000Z");
    const result = summarizeTimeEntries(
      [
        {
          id: "entry-1",
          personId: "person-1",
          clockedInAt: firstIn,
          clockedOutAt: new Date("2026-08-17T18:00:00.000Z"),
          clockInDeviceId: "device-a",
          clockInFlags: ["clock_skew"],
        },
        {
          id: "entry-2",
          personId: "person-1",
          clockedInAt: new Date("2026-08-18T08:30:00.000Z"),
          clockedOutAt: new Date("2026-08-18T17:00:00.000Z"),
          clockInDeviceId: "device-b",
        },
      ],
      [],
      [
        {
          personId: "person-1",
          startsAt: new Date("2026-08-17T08:00:00.000Z"),
          endsAt: new Date("2026-08-17T16:00:00.000Z"),
          breakMinutes: 60,
        },
      ],
      new Set(),
      new Date("2026-08-17T19:00:00.000Z"),
      {
        lateToleranceMinutes: 15,
        minimumBreakMinutes: 30,
        maxOvertimeMinutes: 60,
        antiFraudEnabled: true,
      },
    );
    assert.equal(result[0]?.anomalyCodes.includes("late_arrival"), true);
    assert.equal(result[0]?.anomalyCodes.includes("overtime_limit_exceeded"), true);
    assert.equal(result[0]?.anomalyCodes.includes("multiple_devices"), true);
    assert.equal(result[0]?.anomalyCodes.includes("clock_skew"), true);

    const alerts = buildTimeTrackingAlerts(
      [],
      [
        {
          id: "schedule-1",
          personId: "person-2",
          startsAt: new Date("2026-08-17T08:00:00.000Z"),
          endsAt: new Date("2026-08-17T16:00:00.000Z"),
        },
      ],
      [],
      {
        notificationsEnabled: true,
        reminderBeforeShiftMinutes: 15,
        reminderAfterShiftMinutes: 15,
        managerAlertOnAnomaly: true,
      },
      new Date("2026-08-17T09:00:00.000Z"),
    );
    assert.equal(alerts[0]?.type, "missing_clock_in");
  });
});

describe("time tracking read policy", () => {
  it("keeps raw location and device data out of regular time-entry payloads", () => {
    const entry = timeTrackingEntryForRead({
      id: "entry-1",
      personId: "person-1",
      clockedInAt: new Date("2026-08-20T12:00:00.000Z"),
      clockedOutAt: null,
      source: "self",
      clockInLatitude: -19.9167,
      clockInLongitude: -43.9345,
      clockInDeviceId: "device-1",
    });
    assert.deepEqual(entry, {
      id: "entry-1",
      personId: "person-1",
      clockedInAt: new Date("2026-08-20T12:00:00.000Z"),
      clockedOutAt: null,
      source: "self",
    });
  });

  it("applies configured manager and finance visibility", () => {
    assert.doesNotThrow(() =>
      assertTimeTrackingReadPolicy("owner", {
        managerCanView: false,
        financeCanView: false,
      }),
    );
    assert.throws(
      () =>
        assertTimeTrackingReadPolicy("manager", {
          managerCanView: false,
          financeCanView: true,
        }),
      hasCode("TIME_TRACKING_MANAGER_VIEW_DISABLED"),
    );
    assert.throws(
      () =>
        assertTimeTrackingReadPolicy("finance", {
          managerCanView: true,
          financeCanView: false,
        }),
      hasCode("TIME_TRACKING_FINANCE_VIEW_DISABLED"),
    );
  });
});
