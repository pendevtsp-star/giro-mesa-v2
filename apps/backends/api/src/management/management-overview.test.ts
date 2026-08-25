import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SystemRole } from "@giromesa/domain";
import {
  type OverviewProfileId,
  type OverviewSnapshot,
  overviewRoutes,
  resolveOverviewProfile,
  shapeManagementOverview,
} from "./management-overview.js";

const generatedAt = new Date("2026-08-16T18:00:00.000Z");
const snapshot: OverviewSnapshot = {
  activeShift: { label: "Jantar", startsAt: new Date("2026-08-16T17:00:00.000Z") },
  cashShift: {
    startsAt: new Date("2026-08-16T17:15:00.000Z"),
    lastDifferenceCents: 200,
  },
  operations: {
    salesCents: 120_00,
    closedTabs: 4,
    openTabs: 3,
    myOpenTabs: 2,
    openValueCents: 80_00,
    receivedCents: 100_00,
    tables: 10,
    occupiedTables: 8,
    turnoverTables: 2,
    openCalls: 2,
    overdueCalls: 1,
    kdsPending: 2,
    kdsPreparing: 3,
    kdsReady: 1,
    kdsDelayed: 1,
    readyForMe: 1,
    activePeople: 6,
    pendingApprovals: 2,
    previousSalesCents: 100_00,
    previousClosedTabs: 4,
    previousReceivedCents: 90_00,
    busiestStationLabel: "Grelha",
    busiestStationQueue: 4,
  },
  inventory: {
    outOfStock: 1,
    belowMinimum: 2,
    awaitingReceipt: 1,
    eventsToday: 3,
    previousEvents: 2,
    coverageRisk: 2,
    suggestedPurchases: 3,
    supplierDelays: 1,
  },
  finance: {
    overduePayables: 1,
    overduePayablesCents: 50_00,
    overdueReceivables: 1,
    overdueReceivablesCents: 30_00,
    projectedBalanceCents: 40_00,
    unresolvedReconciliations: 2,
    grossMarginCents: 70_00,
    payablesDueSoon: 2,
    payablesDueSoonCents: 40_00,
    receivablesDueSoon: 3,
    receivablesDueSoonCents: 60_00,
  },
  delivery: {
    active: 4,
    preparing: 2,
    ready: 1,
    delayed: 1,
    atRisk: 2,
    busyCouriers: 2,
    totalCouriers: 3,
    canceledToday: 1,
  },
  reservations: { upcoming: 2, overdue: 1, waitlist: 3 },
};

const cases: readonly [SystemRole, OverviewProfileId][] = [
  ["owner", "owner"],
  ["manager", "manager"],
  ["cashier", "cashier"],
  ["delivery", "delivery"],
  ["waiter", "waiter"],
  ["receptionist", "receptionist"],
  ["busser", "busser"],
  ["kds", "kitchen"],
  ["inventory", "inventory"],
  ["finance", "finance"],
];

describe("management overview role matrix", () => {
  it("derives every profile from scoped bindings and only emits authorized routes", () => {
    assert.ok(overviewRoutes.cashier.includes("salon"));
    for (const [role, expectedProfile] of cases) {
      const profile = resolveOverviewProfile(
        [
          { role: "owner", unitId: "other-unit" },
          { role, unitId: "selected-unit" },
        ],
        "selected-unit",
      );
      assert.equal(profile, expectedProfile);
      const result = shapeManagementOverview(expectedProfile, generatedAt, snapshot, [
        "test-source",
      ]);
      const routes = [
        ...result.metrics.map(({ route }) => route),
        ...result.priorities.map(({ route }) => route),
        ...result.pulse.flatMap(({ route }) => (route ? [route] : [])),
        ...result.quickActions.map(({ route }) => route),
      ];
      assert.ok(routes.every((route) => overviewRoutes[expectedProfile].includes(route)));
      assert.ok(result.priorities.every(({ occurrenceKey }) => occurrenceKey.length === 64));
      assert.deepEqual(result.unavailableSources, ["test-source"]);
    }
  });

  it("uses frontend precedence, ignores foreign-unit elevation and sorts actionable priorities", () => {
    assert.equal(resolveOverviewProfile([{ role: "owner", unitId: "other-unit" }], "unit"), null);
    assert.equal(
      resolveOverviewProfile(
        [
          { role: "finance", unitId: null },
          { role: "waiter", unitId: "unit" },
          { role: "delivery", unitId: "unit" },
          { role: "owner", unitId: "other-unit" },
        ],
        "unit",
      ),
      "delivery",
    );
    const result = shapeManagementOverview("manager", generatedAt, snapshot);
    assert.equal(result.priorities[0]?.tone, "danger");
    assert.ok(result.priorities.some(({ id }) => id === "pending-approvals"));
    assert.ok(result.metrics.some(({ id }) => id === "pending-approvals"));
    const owner = shapeManagementOverview("owner", generatedAt, snapshot, [], {
      alertsEnabled: true,
      minimumTone: "warning",
      digestMinutes: 15,
      thresholds: {
        kdsDelayMinutes: 15,
        stockCoverageDays: 7,
        deliveryRiskMinutes: 15,
        salesGoalCents: 150_00,
        maxKdsDelayed: 0,
        maxStockouts: 0,
        maxDeliveryDelayed: 0,
        maxReconciliations: 0,
      },
    });
    assert.equal(owner.metrics.find(({ id }) => id === "sales")?.comparison?.value, "+20%");
    assert.equal(owner.metrics.find(({ id }) => id === "sales")?.goal?.tone, "warning");
    assert.ok(snapshot.operations);
    const reservationResult = shapeManagementOverview("waiter", generatedAt, {
      activeShift: snapshot.activeShift,
      cashShift: null,
      operations: { ...snapshot.operations, openCalls: 0, overdueCalls: 0, readyForMe: 0 },
      reservations: snapshot.reservations,
    });
    assert.ok(reservationResult.priorities.some(({ id }) => id === "waitlist"));
    assert.ok(reservationResult.priorities.some(({ id }) => id === "upcoming-reservations"));
  });

  it("returns no synthetic priority when all available sources are clear", () => {
    const result = shapeManagementOverview("inventory", generatedAt, {
      activeShift: null,
      cashShift: null,
      inventory: {
        outOfStock: 0,
        belowMinimum: 0,
        awaitingReceipt: 0,
        eventsToday: 0,
        previousEvents: 0,
        coverageRisk: 0,
        suggestedPurchases: 0,
        supplierDelays: 0,
      },
    });
    assert.deepEqual(result.priorities, []);
  });

  it("keeps operational metric slots and independent sources when operations are unavailable", () => {
    const withoutOperations = { ...snapshot, operations: undefined };

    for (const profile of ["manager", "waiter", "kitchen"] as const) {
      const result = shapeManagementOverview(profile, generatedAt, withoutOperations, [
        "operations",
      ]);
      assert.equal(result.metrics.length, 4);
      assert.ok(
        result.metrics.every(
          ({ value, detail, source }) =>
            value === "—" &&
            detail === "Dados temporariamente indisponíveis" &&
            source === "operations",
        ),
      );
    }

    const owner = shapeManagementOverview("owner", generatedAt, withoutOperations, ["operations"]);
    assert.equal(owner.metrics.length, 4);
    assert.deepEqual(
      owner.metrics.map(({ id, source, value }) => ({ id, source, value })),
      [
        { id: "pending-approvals", source: "operations", value: "—" },
        { id: "sales", source: "operations", value: "—" },
        { id: "gross-margin", source: "finance", value: "R$\u00a070,00" },
        { id: "projected-balance", source: "finance", value: "R$\u00a040,00" },
      ],
    );

    const cashier = shapeManagementOverview("cashier", generatedAt, withoutOperations, [
      "operations",
    ]);
    assert.equal(cashier.metrics.length, 4);
    assert.equal(cashier.metrics.find(({ id }) => id === "cash-status")?.value, "Aberto");
    assert.equal(cashier.metrics.find(({ id }) => id === "cash-status")?.source, "cash");
    assert.equal(cashier.metrics.find(({ id }) => id === "cash-difference")?.value, "R$\u00a02,00");
    assert.ok(
      cashier.metrics
        .filter(({ id }) => id === "received" || id === "tabs-to-receive")
        .every(
          ({ value, detail, source }) =>
            value === "—" &&
            detail === "Dados temporariamente indisponíveis" &&
            source === "operations",
        ),
    );
  });
});
