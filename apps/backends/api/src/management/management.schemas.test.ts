import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commissionSchema,
  overviewPreferencesSchema,
  overviewPriorityActionSchema,
  purchaseInvoiceConfirmSchema,
  purchaseOrderSchema,
  purchaseOrderUpdateSchema,
  purchaseReversalSchema,
  purchaseTransitionSchema,
  reportPeriodSchema,
  selfClockInSchema,
  supplierInvoiceSchema,
  supplierUpdateSchema,
  timeCorrectionDecisionSchema,
  timeCorrectionSchema,
  timeTrackingClosureSchema,
  timeTrackingSettingsSchema,
} from "./management.schemas.js";

describe("overview action inputs", () => {
  const occurrenceKey = "a".repeat(64);

  it("requires a bounded delay only for snooze", () => {
    assert.equal(
      overviewPriorityActionSchema.safeParse({ occurrenceKey, action: "snooze" }).success,
      false,
    );
    assert.equal(
      overviewPriorityActionSchema.safeParse({
        occurrenceKey,
        action: "snooze",
        snoozeMinutes: 15,
      }).success,
      true,
    );
    assert.equal(
      overviewPriorityActionSchema.safeParse({
        occurrenceKey,
        action: "resolve",
        snoozeMinutes: 15,
      }).success,
      false,
    );
  });

  it("rejects preferences outside operational limits", () => {
    const preferences = {
      alertsEnabled: true,
      minimumTone: "warning",
      digestMinutes: 15,
      thresholds: {
        kdsDelayMinutes: 15,
        stockCoverageDays: 3,
        deliveryRiskMinutes: 15,
        salesGoalCents: 100_000,
        maxKdsDelayed: 2,
        maxStockouts: 0,
        maxDeliveryDelayed: 0,
        maxReconciliations: 0,
      },
    };
    assert.equal(overviewPreferencesSchema.safeParse(preferences).success, true);
    assert.equal(
      overviewPreferencesSchema.safeParse({ ...preferences, digestMinutes: 1 }).success,
      false,
    );
  });
});

describe("management report period", () => {
  it("accepts real ISO dates within 366 days", () => {
    assert.deepEqual(reportPeriodSchema.parse({ from: "2024-01-01", to: "2025-01-01" }), {
      from: "2024-01-01",
      to: "2025-01-01",
      comparisonMode: "previous_period",
    });
    assert.equal(
      reportPeriodSchema.safeParse({ from: "2024-02-29", to: "2024-02-29" }).success,
      true,
    );
  });

  it("rejects impossible, reversed and longer periods", () => {
    assert.equal(
      reportPeriodSchema.safeParse({ from: "2026-02-29", to: "2026-03-01" }).success,
      false,
    );
    assert.equal(
      reportPeriodSchema.safeParse({ from: "2026-08-02", to: "2026-08-01" }).success,
      false,
    );
    assert.equal(
      reportPeriodSchema.safeParse({ from: "2024-01-01", to: "2025-01-02" }).success,
      false,
    );
  });
});

describe("purchase input invariants", () => {
  it("requires a reason when accepting an invoice divergence", () => {
    assert.equal(
      purchaseInvoiceConfirmSchema.safeParse({ acceptDivergence: true, version: 1 }).success,
      false,
    );
    assert.deepEqual(
      purchaseInvoiceConfirmSchema.parse({
        acceptDivergence: true,
        reason: "Ajuste fiscal autorizado",
        version: 1,
      }),
      { acceptDivergence: true, reason: "Ajuste fiscal autorizado", version: 1 },
    );
  });

  it("requires NF-e key and XML together", () => {
    const invoice = {
      documentNumber: "1",
      issuedAt: "2026-08-17",
      competenceDate: "2026-08-17",
      dueDate: "2026-08-17",
      totalCents: 100,
      lines: [
        {
          purchaseOrderItemId: "00000000-0000-4000-8000-000000000003",
          quantity: "1",
          unitCostCents: 100,
        },
      ],
    };
    assert.equal(
      supplierInvoiceSchema.safeParse({ ...invoice, accessKey: "1".repeat(44) }).success,
      false,
    );
    assert.equal(
      supplierInvoiceSchema.safeParse({ ...invoice, xmlContent: "<NFe />" }).success,
      false,
    );
  });

  it("requires optimistic versions for purchase mutations", () => {
    assert.equal(supplierUpdateSchema.safeParse({ name: "Novo nome" }).success, false);
    assert.equal(
      purchaseOrderUpdateSchema.safeParse({ expectedAt: "2026-08-18T10:00:00Z" }).success,
      false,
    );
    assert.equal(purchaseTransitionSchema.safeParse({ reason: "Revisar pedido" }).success, false);
    assert.equal(
      purchaseReversalSchema.safeParse({ reason: "Reverter lançamento" }).success,
      false,
    );
  });

  it("rejects zero unit costs and impossible invoice dates", () => {
    assert.equal(
      purchaseOrderSchema.safeParse({
        supplierId: "00000000-0000-4000-8000-000000000001",
        items: [
          {
            inventoryItemId: "00000000-0000-4000-8000-000000000002",
            quantity: "1",
            unitCostCents: 0,
          },
        ],
      }).success,
      false,
    );
    assert.equal(
      supplierInvoiceSchema.safeParse({
        documentNumber: "NF-1",
        issuedAt: "2026-02-31",
        competenceDate: "2026-02-01",
        dueDate: "2026-02-01",
        totalCents: 100,
        lines: [
          {
            purchaseOrderItemId: "00000000-0000-4000-8000-000000000003",
            quantity: "1",
            unitCostCents: 100,
          },
        ],
      }).success,
      false,
    );
  });
});

describe("time tracking policy", () => {
  it("requires a configured location for enabled geofencing and selected employees", () => {
    assert.equal(
      timeTrackingSettingsSchema.safeParse({
        mode: "off",
        geofenceEnabled: true,
        radiusMeters: 100,
        accuracyToleranceMeters: 50,
        managerCanView: false,
        financeCanView: false,
        selectedPersonIds: [],
      }).success,
      true,
    );
    assert.equal(
      timeTrackingSettingsSchema.safeParse({
        mode: "selected",
        geofenceEnabled: true,
        radiusMeters: 100,
        accuracyToleranceMeters: 50,
        managerCanView: false,
        financeCanView: false,
        selectedPersonIds: [],
      }).success,
      false,
    );
    assert.equal(
      timeTrackingSettingsSchema.safeParse({
        mode: "all",
        geofenceEnabled: true,
        latitude: -19.9167,
        longitude: -43.9345,
        radiusMeters: 100,
        accuracyToleranceMeters: 50,
        managerCanView: true,
        financeCanView: false,
        selectedPersonIds: [],
      }).success,
      true,
    );
  });

  it("requires offline capture metadata and a justification", () => {
    assert.equal(
      selfClockInSchema.safeParse({
        latitude: -19.9167,
        longitude: -43.9345,
        capturedAt: "2026-08-17T12:00:00.000Z",
      }).success,
      true,
    );
    assert.equal(
      selfClockInSchema.safeParse({
        latitude: -19.9167,
        longitude: -43.9345,
        offline: true,
      }).success,
      false,
    );
    assert.equal(
      selfClockInSchema.safeParse({
        latitude: -19.9167,
        longitude: -43.9345,
        capturedAt: "2026-08-17T12:00:00.000Z",
        offline: true,
        offlineJustification: "Internet indisponível na unidade.",
      }).success,
      true,
    );
    assert.equal(
      timeCorrectionSchema.safeParse({
        timeEntryId: "00000000-0000-4000-8000-000000000001",
        clockedInAt: "2026-08-17T12:00:00.000Z",
        clockedOutAt: "2026-08-17T20:00:00.000Z",
        reason: "Esqueci de registrar a entrada.",
      }).success,
      true,
    );
    assert.equal(timeCorrectionDecisionSchema.safeParse({ decision: "approve" }).success, true);
  });

  it("accepts multiple locations and rejects duplicated labels", () => {
    const policy = {
      mode: "all" as const,
      geofenceEnabled: true,
      locationLabel: "Unidade Centro",
      latitude: -19.9167,
      longitude: -43.9345,
      radiusMeters: 100,
      accuracyToleranceMeters: 50,
      maxLocationAccuracyMeters: 80,
      lowAccuracyPolicy: "flag" as const,
      additionalLocations: [
        {
          label: "Unidade Shopping",
          latitude: -19.92,
          longitude: -43.93,
          radiusMeters: 120,
          accuracyToleranceMeters: 40,
        },
      ],
      managerCanView: true,
      financeCanView: false,
      selectedPersonIds: [],
    };
    assert.equal(timeTrackingSettingsSchema.safeParse(policy).success, true);
    assert.equal(
      timeTrackingSettingsSchema.safeParse({
        ...policy,
        additionalLocations: [{ ...policy.additionalLocations[0], label: "unidade centro" }],
      }).success,
      false,
    );
  });

  it("validates period closure reasons and ISO dates", () => {
    assert.equal(
      timeTrackingClosureSchema.safeParse({ from: "2026-08-01", to: "2026-08-31" }).success,
      true,
    );
    assert.equal(
      timeTrackingClosureSchema.safeParse({
        from: "2026-08-01",
        to: "2026-08-31",
        reason: "Fechamento da folha",
      }).success,
      true,
    );
    assert.equal(
      timeTrackingClosureSchema.safeParse({ from: "2026-08-31", to: "2026-08-01" }).success,
      false,
    );
  });
});

describe("commission money bounds", () => {
  const personId = "00000000-0000-4000-8000-000000000001";

  it("rejects cents outside the PostgreSQL integer range", () => {
    assert.equal(
      commissionSchema.safeParse({ personId, baseCents: 2_147_483_647, amountCents: 0 }).success,
      true,
    );
    assert.equal(
      commissionSchema.safeParse({ personId, baseCents: 2_147_483_648, amountCents: 0 }).success,
      false,
    );
    assert.equal(
      commissionSchema.safeParse({ personId, baseCents: 0, amountCents: 2_147_483_648 }).success,
      false,
    );
  });
});
