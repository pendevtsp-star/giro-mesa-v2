import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  approvalExpiresAt,
  assertKdsOrderHandoff,
  assertKdsTransition,
  assertPrintJobTransition,
  assertTabCanClose,
  assertTenantScope,
  initialKdsCourseDispatch,
  isApprovalActive,
  isWithinAvailability,
  itemAmounts,
  kdsAttentionRevision,
  kdsCapacityRecommendation,
  kdsPartialState,
  normalizeKdsAttentionText,
  projectKdsAvailability,
  replayResult,
  requestHash,
  shouldAlertKdsCancellation,
  summarizeKdsDurations,
  tabTotals,
} from "./pilot-rules.js";
import {
  approvalRequestSchema,
  closeOperationalShiftSchema,
  closeTabSchema,
  comboSchema,
  floorLayoutSchema,
  kdsItemStateSchema,
  openOperationalShiftSchema,
  openTabSchema,
  orderSchema,
  paymentSchema,
  pointInsideFloorPolygon,
  printJobSchema,
  printJobStatusSchema,
  productUnitConfigSchema,
  reopenTabSchema,
  serviceSectionSchema,
  shiftLayoutSchema,
  shiftSectionAssignmentSchema,
  shiftSectionCoverageSchema,
  temporaryTableTransferSchema,
} from "./pilot-schemas.js";

describe("pilot POS rules", () => {
  it("requires a paid balance before closing and validates approval requests", () => {
    assert.doesNotThrow(() => assertTabCanClose(4_000, 4_000));
    assert.throws(() => assertTabCanClose(4_000, 3_999), ConflictException);
    assert.equal(closeTabSchema.safeParse({ printRequested: true }).success, true);
    assert.equal(
      approvalRequestSchema.safeParse({
        itemId: "00000000-0000-4000-8000-000000000001",
        action: "discount",
        reason: "Cortesia",
      }).success,
      false,
    );
    assert.equal(
      reopenTabSchema.safeParse({ pin: "1234", reason: "Cliente voltou" }).success,
      true,
    );
    assert.equal(reopenTabSchema.safeParse({ pin: "12", reason: "x" }).success, false);
  });

  it("validates print jobs and only allows forward delivery transitions", () => {
    assert.equal(
      printJobSchema.safeParse({ documentType: "partial_statement", copies: 2 }).success,
      true,
    );
    assert.equal(
      printJobSchema.safeParse({ documentType: "partial_statement", copies: 11 }).success,
      false,
    );
    assert.equal(
      printJobStatusSchema.safeParse({ status: "failed", error: "Sem papel" }).success,
      true,
    );
    assert.equal(printJobStatusSchema.safeParse({ status: "failed" }).success, false);
    assert.doesNotThrow(() => assertPrintJobTransition("queued", "printing"));
    assert.doesNotThrow(() => assertPrintJobTransition("printing", "printed"));
    assert.throws(() => assertPrintJobTransition("printed", "printing"), ConflictException);
    assert.throws(() => assertPrintJobTransition("failed", "queued"), ConflictException);
  });

  it("expires manager approvals after the operational window", () => {
    const requestedAt = new Date("2026-08-16T12:00:00.000Z");
    assert.equal(approvalExpiresAt(requestedAt).toISOString(), "2026-08-16T12:10:00.000Z");
    assert.equal(isApprovalActive(requestedAt, new Date("2026-08-16T12:09:59.999Z")), true);
    assert.equal(isApprovalActive(requestedAt, new Date("2026-08-16T12:10:00.000Z")), false);
  });

  it("accepts only unique bounded coordinates for the floor layout", () => {
    const tableId = "00000000-0000-4000-8000-000000000001";
    assert.equal(
      floorLayoutSchema.safeParse({ tables: [{ tableId, x: 240, y: 180 }] }).success,
      true,
    );
    assert.equal(
      floorLayoutSchema.safeParse({
        tables: [
          { tableId, x: 240, y: 180 },
          { tableId, x: 260, y: 180 },
        ],
      }).success,
      false,
    );
    assert.equal(
      floorLayoutSchema.safeParse({ tables: [{ tableId, x: -10_001, y: 12_800 }] }).success,
      true,
    );
    assert.equal(
      floorLayoutSchema.safeParse({ tables: [{ tableId, x: 1_000_001, y: 180 }] }).success,
      false,
    );
    const roomId = "00000000-0000-4000-8000-000000000002";
    assert.equal(
      floorLayoutSchema.safeParse({
        rooms: [
          {
            roomId,
            points: [
              { x: 20, y: 20 },
              { x: 400, y: 20 },
              { x: 360, y: 280 },
              { x: 20, y: 280 },
            ],
          },
        ],
      }).success,
      true,
    );
    assert.equal(
      floorLayoutSchema.safeParse({
        rooms: [
          {
            roomId,
            points: [
              { x: 20, y: 20 },
              { x: 360, y: 280 },
              { x: 400, y: 20 },
              { x: 20, y: 280 },
            ],
          },
        ],
      }).success,
      false,
    );
    assert.equal(
      pointInsideFloorPolygon({ x: 200, y: 160 }, [
        { x: 20, y: 20 },
        { x: 400, y: 20 },
        { x: 360, y: 280 },
        { x: 20, y: 280 },
      ]),
      true,
    );
  });

  it("keeps all totals in integer cents", () => {
    assert.deepEqual(itemAmounts(3, 1_999, 250, 500), {
      grossCents: 6_747,
      discountCents: 500,
      netCents: 6_247,
    });
    assert.deepEqual(
      tabTotals(
        [
          { grossCents: 6_747, discountCents: 500 },
          { grossCents: 2_000, discountCents: 0, canceled: true },
          { grossCents: 1_253, discountCents: 0 },
        ],
        1_000,
        300,
      ),
      {
        subtotalCents: 8_000,
        discountCents: 500,
        serviceChargeCents: 750,
        tipCents: 300,
        totalCents: 8_550,
      },
    );
    assert.equal(
      tabTotals([{ grossCents: 10_000, discountCents: 1_000 }], 1_000, 0, "gross")
        .serviceChargeCents,
      1_000,
    );
    assert.throws(() => itemAmounts(2, 2_147_483_647, 0), BadRequestException);
    assert.throws(
      () => tabTotals([{ grossCents: 2_147_483_647, discountCents: 0 }], 0, 1),
      BadRequestException,
    );
  });

  it("validates structured counter, seat, allergy and partial payment inputs", () => {
    const productId = "00000000-0000-4000-8000-000000000001";
    assert.equal(
      openTabSchema.safeParse({ fulfillmentType: "delivery", guestCount: 1 }).success,
      false,
    );
    assert.equal(
      openTabSchema.safeParse({
        fulfillmentType: "delivery",
        deliveryAddress: "Rua Teste, 10",
        customerPhone: "+55 11 99999-9999",
        guestCount: 1,
      }).success,
      true,
    );
    assert.equal(
      orderSchema.safeParse({
        items: [
          {
            productId,
            quantity: 1,
            modifierOptionIds: [],
            seatNumber: 2,
            course: "main",
            allergyNote: "Sem lactose",
          },
        ],
      }).success,
      true,
    );
    assert.equal(paymentSchema.safeParse({ method: "pix", amountCents: 0 }).success, false);
    assert.equal(
      paymentSchema.safeParse({ method: "pix", amountCents: 2_147_483_648 }).success,
      false,
    );
    assert.equal(
      comboSchema.safeParse({
        name: "Combo",
        priceCents: 1_000,
        items: [
          { productId, quantity: 1 },
          { productId, quantity: 2 },
        ],
      }).success,
      false,
    );
  });

  it("separates reusable service sections from shift assignments", () => {
    const tableId = "00000000-0000-4000-8000-000000000001";
    const identityId = "00000000-0000-4000-8000-000000000002";
    assert.equal(
      serviceSectionSchema.safeParse({
        name: "Praça varanda",
        color: "#176B4D",
        serviceMode: "full_service",
        tableIds: [tableId],
      }).success,
      true,
    );
    assert.equal(
      openOperationalShiftSchema.safeParse({
        serviceMode: "quick_service",
        copyPreviousAssignments: true,
      }).success,
      true,
    );
    assert.equal(
      shiftSectionAssignmentSchema.safeParse({
        tableIds: [tableId],
        primaryIdentityId: identityId,
        supportIdentityIds: [identityId],
      }).success,
      false,
    );
    assert.equal(
      shiftLayoutSchema.safeParse({
        tables: [{ tableId, roomId: tableId, x: 640, y: 420 }],
      }).success,
      true,
    );
    assert.equal(shiftSectionCoverageSchema.safeParse({ active: true }).success, true);
    assert.equal(shiftSectionCoverageSchema.safeParse({ active: true, identityId }).success, false);
    assert.equal(
      temporaryTableTransferSchema.safeParse({
        targetShiftSectionId: tableId,
        durationMinutes: 60,
        transferOpenTab: true,
        reason: "Cobertura da varanda",
      }).success,
      true,
    );
    assert.equal(
      temporaryTableTransferSchema.safeParse({
        targetShiftSectionId: tableId,
        durationMinutes: 721,
        reason: "Prazo inválido",
      }).success,
      false,
    );
    assert.equal(
      closeOperationalShiftSchema.safeParse({
        acknowledgeOpenTabs: true,
        handoverAssignments: [
          {
            sourceResponsibleIdentityId: null,
            targetResponsibleIdentityId: identityId,
          },
        ],
        reason: "Passagem para equipe noturna",
      }).success,
      true,
    );
    assert.equal(
      closeOperationalShiftSchema.safeParse({
        acknowledgeOpenTabs: true,
        handoverIdentityId: identityId,
        handoverAssignments: [
          {
            sourceResponsibleIdentityId: null,
            targetResponsibleIdentityId: identityId,
          },
        ],
      }).success,
      false,
    );
  });

  it("rejects cross-tenant entities", () => {
    assert.throws(
      () =>
        assertTenantScope(
          { organizationId: "org-a", unitId: "unit-a" },
          { organizationId: "org-b", unitId: "unit-a" },
        ),
      ConflictException,
    );
  });

  it("allows only forward KDS transitions", () => {
    assert.doesNotThrow(() => assertKdsTransition("pending", "preparing"));
    assert.doesNotThrow(() => assertKdsTransition("preparing", "ready"));
    assert.throws(() => assertKdsTransition("ready", "preparing"), ConflictException);
    assert.throws(() => assertKdsTransition("ready", "done"), ConflictException);
    assert.throws(() => assertKdsTransition("preparing", "canceled"), ConflictException);
    assert.throws(() => assertKdsTransition("done", "canceled"), ConflictException);
  });

  it("tracks partial KDS readiness and bounded recent duration metrics", () => {
    assert.equal(kdsPartialState(3, 1), "preparing");
    assert.equal(kdsPartialState(3, 3), "ready");
    assert.throws(() => kdsPartialState(3, 4), BadRequestException);
    assert.deepEqual(summarizeKdsDurations([1, 2, 3, 10]), {
      average: 4,
      median: 2.5,
      p90: 10,
      sampleSize: 4,
    });
  });

  it("projects operational availability without mutating consumed daily stock", () => {
    const now = new Date("2026-08-17T18:00:00.000Z");
    assert.deepEqual(
      projectKdsAvailability(
        {
          available: false,
          dailyStock: 10,
          soldToday: 7,
          stockDate: "2026-08-17",
          resetAt: new Date("2026-08-17T17:59:00.000Z"),
          reason: "Pausa operacional",
        },
        "2026-08-17",
        now,
      ),
      {
        available: true,
        status: "limited",
        soldToday: 7,
        remainingQuantity: 3,
        reason: null,
        resetAt: null,
        resetElapsed: true,
      },
    );
    assert.equal(
      projectKdsAvailability(
        {
          available: true,
          dailyStock: 2,
          soldToday: 2,
          stockDate: "2026-08-17",
          resetAt: null,
          reason: null,
        },
        "2026-08-17",
        now,
      ).status,
      "unavailable",
    );
  });

  it("turns bounded queue and history into an explicit capacity recommendation", () => {
    assert.deepEqual(
      kdsCapacityRecommendation({
        activeAssignments: 2,
        blockedAssignments: 0,
        queuedQuantity: 1,
        preparingQuantity: 1,
        sampleSize: 2,
        p50PrepMinutes: null,
        p90PrepMinutes: null,
        estimatedUnitsPerHour: null,
      }),
      {
        state: "normal",
        suggestedDelayMinutes: null,
        reasons: ["insufficient_history"],
      },
    );
    const overloaded = kdsCapacityRecommendation({
      activeAssignments: 21,
      blockedAssignments: 3,
      queuedQuantity: 20,
      preparingQuantity: 5,
      sampleSize: 20,
      p50PrepMinutes: 18,
      p90PrepMinutes: 35,
      estimatedUnitsPerHour: 10,
    });
    assert.equal(overloaded.state, "overloaded");
    assert.equal(overloaded.suggestedDelayMinutes, 150);
    assert.deepEqual(overloaded.reasons, ["blocked_items", "queue_depth", "slow_history"]);
  });

  it("normalizes critical KDS notes into stable SHA-256 revisions", () => {
    assert.equal(normalizeKdsAttentionText("  Sem lactose\r\nURGENTE  "), "Sem lactose\nURGENTE");
    assert.equal(
      kdsAttentionRevision("allergy", "  Sem lactose\r\nURGENTE  "),
      "8559a91f0d944dd322533376a3fad3122f24b9f53ef21b6d969a4e7406280983",
    );
    assert.notEqual(
      kdsAttentionRevision("notes", "Sem lactose\nURGENTE"),
      kdsAttentionRevision("allergy", "Sem lactose\nURGENTE"),
    );
  });

  it("holds later courses only for full-service flows", () => {
    assert.deepEqual(initialKdsCourseDispatch("full_service", "main"), {
      held: true,
      fired: false,
    });
    assert.deepEqual(initialKdsCourseDispatch("hybrid", "dessert"), {
      held: true,
      fired: false,
    });
    assert.deepEqual(initialKdsCourseDispatch("quick_service", "main"), {
      held: false,
      fired: true,
    });
    assert.deepEqual(initialKdsCourseDispatch("bar", "dessert"), {
      held: false,
      fired: true,
    });
  });

  it("requires at least one production station and accepts multi-station routing", () => {
    const stationId = "00000000-0000-4000-8000-000000000001";
    const base = { priceCents: 1_000, available: true };
    assert.equal(
      productUnitConfigSchema.safeParse({ ...base, stationIds: [stationId] }).success,
      true,
    );
    assert.equal(productUnitConfigSchema.safeParse({ ...base, stationIds: [] }).success, false);
    assert.equal(
      productUnitConfigSchema.safeParse({
        ...base,
        stationIds: [stationId, "00000000-0000-4000-8000-000000000002"],
      }).success,
      true,
    );
  });

  it("requires an aggregate expedition before serving a KDS order", () => {
    const ready = { status: "ready" as const, handedOffAt: null, servedAt: null };
    const preparing = { status: "preparing" as const, handedOffAt: null, servedAt: null };
    const expedition = {
      status: "done" as const,
      handedOffAt: new Date("2026-08-16T12:00:00.000Z"),
      servedAt: null,
    };
    assert.doesNotThrow(() => assertKdsOrderHandoff("expedition", [ready, ready]));
    assert.throws(() => assertKdsOrderHandoff("expedition", [ready, preparing]), ConflictException);
    assert.throws(() => assertKdsOrderHandoff("served", [ready]), ConflictException);
    assert.doesNotThrow(() => assertKdsOrderHandoff("served", [expedition, expedition]));
    assert.doesNotThrow(() => assertKdsOrderHandoff("runner", [expedition, expedition]));
    assert.throws(() => assertKdsOrderHandoff("expedition", [expedition]), ConflictException);
  });

  it("does not turn a full financial split into a kitchen cancellation alert", () => {
    assert.equal(shouldAlertKdsCancellation([]), false);
    assert.equal(shouldAlertKdsCancellation(["ready"]), false);
    assert.equal(shouldAlertKdsCancellation(["canceled"]), true);
  });

  it("accepts partial quantity only for a ready item transition", () => {
    assert.equal(kdsItemStateSchema.safeParse({ state: "ready", quantity: 2 }).success, true);
    assert.equal(kdsItemStateSchema.safeParse({ state: "preparing" }).success, true);
    assert.equal(kdsItemStateSchema.safeParse({ state: "preparing", quantity: 2 }).success, false);
  });

  it("enforces unit-local availability windows, including overnight", () => {
    const schedule = { windows: [{ dayOfWeek: 6, start: "18:00", end: "02:00" }] };
    assert.equal(
      isWithinAvailability(schedule, new Date("2026-08-09T02:30:00.000Z"), "America/Sao_Paulo"),
      true,
    );
    assert.equal(
      isWithinAvailability(schedule, new Date("2026-08-09T06:00:00.000Z"), "America/Sao_Paulo"),
      false,
    );
  });

  it("replays the same idempotent request and rejects divergent reuse", () => {
    const hash = requestHash("tab.open", { guests: 2, label: "Ana" });
    const existing = {
      actorIdentityId: "actor-1",
      operation: "tab.open",
      requestHash: hash,
      response: { tabId: "tab-1" },
    };
    assert.deepEqual(replayResult(existing, "tab.open", hash, "actor-1"), {
      tabId: "tab-1",
      idempotentReplay: true,
    });
    assert.throws(
      () => replayResult(existing, "tab.open", requestHash("tab.open", { guests: 3 }), "actor-1"),
      ConflictException,
    );
    assert.throws(() => replayResult(existing, "tab.open", hash, "actor-2"), ConflictException);
  });
});
