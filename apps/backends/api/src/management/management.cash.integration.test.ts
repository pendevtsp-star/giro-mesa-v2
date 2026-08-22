import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  memberships,
  organizations,
  posTabPayments,
  posTabs,
  posTerminalProfiles,
  roleBindings,
  units,
} from "@giromesa/db";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { ManagementService } from "./management.service.js";

function errorCode(error: unknown) {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return typeof response === "object" && response !== null && "code" in response
    ? response.code
    : undefined;
}

it("serializes the cash ledger, close and dual-control review", async (context) => {
  const databaseUrl = process.env.MANAGEMENT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    context.skip("DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const management = new ManagementService(database, new ScopeService(database));
    const suffix = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: `Cash ledger ${suffix}`,
        tradeName: "Cash ledger",
        document: String(Date.now()).padStart(14, "0").slice(-14),
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Cash unit" })
      .returning();
    assert.ok(unit);
    const [owner, reviewer, cashier, finance] = await database.db
      .insert(identities)
      .values([
        { email: `cash-owner-${suffix}@example.test`, displayName: "Owner" },
        { email: `cash-reviewer-${suffix}@example.test`, displayName: "Reviewer" },
        { email: `cashier-${suffix}@example.test`, displayName: "Cashier" },
        { email: `cash-finance-${suffix}@example.test`, displayName: "Finance" },
      ])
      .returning();
    assert.ok(owner && reviewer && cashier && finance);
    const membershipRows = await database.db
      .insert(memberships)
      .values(
        [owner, reviewer, cashier, finance].map((identity) => ({
          identityId: identity.id,
          organizationId: organization.id,
          status: "active" as const,
        })),
      )
      .returning();
    const [ownerMembership, reviewerMembership, cashierMembership, financeMembership] =
      membershipRows;
    assert.ok(ownerMembership && reviewerMembership && cashierMembership && financeMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: ownerMembership.id, role: "owner" },
      { membershipId: reviewerMembership.id, role: "owner" },
      { membershipId: cashierMembership.id, role: "cashier", unitId: unit.id },
      { membershipId: financeMembership.id, role: "finance", unitId: unit.id },
    ]);

    const registerA = await management.createCashRegister(
      owner.id,
      organization.id,
      unit.id,
      `register-a-${suffix}`,
      { name: "Caixa A" },
    );
    const registerB = await management.createCashRegister(
      owner.id,
      organization.id,
      unit.id,
      `register-b-${suffix}`,
      { name: "Caixa B" },
    );
    await assert.rejects(
      () =>
        management.createCashRegister(
          owner.id,
          organization.id,
          unit.id,
          `register-duplicate-${suffix}`,
          { name: "caixa a" },
        ),
      (error) => errorCode(error) === "CASH_REGISTER_NAME_ALREADY_EXISTS",
    );
    await assert.rejects(
      () =>
        management.openCashShift(
          cashier.id,
          organization.id,
          unit.id,
          `open-without-register-${suffix}`,
          { openingCents: 1_000 },
        ),
      (error) => errorCode(error) === "CASH_REGISTER_REQUIRED",
    );
    const shiftA = await management.openCashShift(
      cashier.id,
      organization.id,
      unit.id,
      `open-a-${suffix}`,
      { openingCents: 1_000, cashRegisterId: registerA.id as string },
    );
    const shiftB = await management.openCashShift(
      cashier.id,
      organization.id,
      unit.id,
      `open-b-${suffix}`,
      { openingCents: 500, cashRegisterId: registerB.id as string },
    );
    await assert.rejects(
      () =>
        management.openCashShift(cashier.id, organization.id, unit.id, `open-a-again-${suffix}`, {
          openingCents: 0,
          cashRegisterId: registerA.id as string,
        }),
      (error) => errorCode(error) === "CASH_SHIFT_ALREADY_OPEN",
    );
    await assert.rejects(
      () =>
        management.updateCashRegister(
          owner.id,
          organization.id,
          unit.id,
          registerA.id as string,
          `disable-a-${suffix}`,
          { active: false },
        ),
      (error) => errorCode(error) === "CASH_REGISTER_HAS_OPEN_SHIFT",
    );
    const cashierView = await management.listCashShifts(cashier.id, organization.id, unit.id);
    assert.equal(cashierView.capabilities.canReview, false);
    assert.equal(cashierView.capabilities.canTransfer, true);
    assert.equal(
      cashierView.shifts.every((shift) => shift.expectedCents === null),
      true,
    );
    const financeView = await management.listCashShifts(finance.id, organization.id, unit.id);
    assert.equal(financeView.capabilities.canOpen, false);
    assert.equal(financeView.capabilities.canManageRegisters, false);
    assert.deepEqual(
      financeView.registers.map((register) => [register.name, register.openShiftId]),
      [
        ["Caixa A", shiftA.cashShiftId],
        ["Caixa B", shiftB.cashShiftId],
      ],
    );

    const receivable = await management.createReceivable(
      owner.id,
      organization.id,
      unit.id,
      `receivable-${suffix}`,
      {
        description: "Venda do turno",
        amountCents: 900,
        competenceDate: "2026-08-21",
        dueDate: "2026-08-21",
        lines: [],
      },
    );
    await assert.rejects(
      () =>
        management.receiveReceivable(
          cashier.id,
          organization.id,
          unit.id,
          receivable.receivableId as string,
          `receive-mismatch-${suffix}`,
          {
            amountCents: 100,
            method: "pix",
            cashShiftId: shiftB.cashShiftId as string,
            cashRegisterId: registerA.id as string,
          },
        ),
      (error) => errorCode(error) === "CASH_SHIFT_MISMATCH",
    );
    await management.receiveReceivable(
      cashier.id,
      organization.id,
      unit.id,
      receivable.receivableId as string,
      `receive-cash-${suffix}`,
      { amountCents: 500, method: "cash", cashRegisterId: registerA.id as string },
    );
    await management.receiveReceivable(
      finance.id,
      organization.id,
      unit.id,
      receivable.receivableId as string,
      `receive-pix-${suffix}`,
      { amountCents: 400, method: "pix", cashRegisterId: registerB.id as string },
    );

    const payable = await management.createPayable(
      owner.id,
      organization.id,
      unit.id,
      `payable-${suffix}`,
      {
        description: "Despesa em dinheiro",
        amountCents: 2_000,
        competenceDate: "2026-08-21",
        dueDate: "2026-08-21",
      },
    );
    await assert.rejects(
      () =>
        management.payPayable(
          owner.id,
          organization.id,
          unit.id,
          payable.payableId as string,
          `pay-too-much-${suffix}`,
          { amountCents: 1_501, method: "cash" },
        ),
      (error) => errorCode(error) === "CASH_REGISTER_REQUIRED",
    );
    await assert.rejects(
      () =>
        management.payPayable(
          owner.id,
          organization.id,
          unit.id,
          payable.payableId as string,
          `pay-too-much-selected-${suffix}`,
          { amountCents: 1_501, method: "cash", cashRegisterId: registerA.id as string },
        ),
      (error) => errorCode(error) === "CASH_DRAWER_INSUFFICIENT",
    );
    await management.payPayable(
      owner.id,
      organization.id,
      unit.id,
      payable.payableId as string,
      `pay-cash-${suffix}`,
      { amountCents: 200, method: "cash", cashRegisterId: registerA.id as string },
    );

    const transfer = await management.transferCash(
      cashier.id,
      organization.id,
      unit.id,
      `transfer-${suffix}`,
      {
        fromCashShiftId: shiftA.cashShiftId as string,
        toCashShiftId: shiftB.cashShiftId as string,
        amountCents: 300,
        reason: "Reforço do segundo caixa",
      },
    );
    const transferReplay = await management.transferCash(
      cashier.id,
      organization.id,
      unit.id,
      `transfer-${suffix}`,
      {
        fromCashShiftId: shiftA.cashShiftId as string,
        toCashShiftId: shiftB.cashShiftId as string,
        amountCents: 300,
        reason: "Reforço do segundo caixa",
      },
    );
    assert.ok("transferId" in transfer);
    assert.ok("transferId" in transferReplay);
    assert.equal(transferReplay.transferId, transfer.transferId);
    assert.equal(transferReplay.idempotentReplay, true);
    const afterTransfer = await management.listCashShifts(owner.id, organization.id, unit.id);
    const liveExpected = afterTransfer.shifts
      .filter((shift) => shift.status === "open")
      .reduce((sum, shift) => sum + (shift.expectedCents ?? 0), 0);
    assert.equal(liveExpected, 1_800);

    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: cashier.id,
        label: "Mesa 7",
        totalCents: 1_000,
      })
      .returning();
    assert.ok(tab);
    await database.db.insert(posTabPayments).values({
      organizationId: organization.id,
      unitId: unit.id,
      tabId: tab.id,
      method: "pix",
      amountCents: 400,
      createdByIdentityId: cashier.id,
    });
    const pendingView = await management.listCashShifts(owner.id, organization.id, unit.id);
    assert.deepEqual(pendingView.pendingTabs[0], {
      id: tab.id,
      label: "Mesa 7",
      totalCents: 1_000,
      paidCents: 400,
      remainingCents: 600,
    });

    const closeB = await management.closeCashShift(
      owner.id,
      organization.id,
      unit.id,
      shiftB.cashShiftId as string,
      `close-b-${suffix}`,
      {
        tenderCounts: [
          { method: "cash", observedCents: 800, source: "manual" },
          { method: "pix", observedCents: 400, source: "manual" },
        ],
      },
    );
    assert.equal(closeB.expectedCents, 800);
    assert.equal(closeB.differenceCents, 0);
    assert.deepEqual(closeB.breakdown, [
      { method: "cash", amountCents: 800 },
      { method: "pix", amountCents: 400 },
    ]);

    const concurrent = await Promise.allSettled([
      management.addCashMovement(
        cashier.id,
        organization.id,
        unit.id,
        shiftA.cashShiftId as string,
        `withdraw-${suffix}`,
        { type: "withdrawal", amountCents: 100, reason: "Sangria concorrente" },
      ),
      management.closeCashShift(
        owner.id,
        organization.id,
        unit.id,
        shiftA.cashShiftId as string,
        `close-${suffix}`,
        { countedCents: 950 },
      ),
    ]);
    const closeResult = concurrent[1];
    assert.equal(closeResult.status, "fulfilled");
    if (closeResult.status !== "fulfilled") return;
    const movementResult = concurrent[0];
    if (movementResult.status === "fulfilled") {
      assert.equal(closeResult.value.expectedCents, 900);
      assert.equal(closeResult.value.differenceCents, 50);
    } else {
      assert.equal(errorCode(movementResult.reason), "CASH_SHIFT_CLOSED");
      assert.equal(closeResult.value.expectedCents, 1_000);
      assert.equal(closeResult.value.differenceCents, -50);
    }
    assert.deepEqual(closeResult.value.breakdown, [
      { method: "cash", amountCents: closeResult.value.expectedCents },
    ]);
    await assert.rejects(
      () =>
        management.reviewCashShift(
          owner.id,
          organization.id,
          unit.id,
          shiftA.cashShiftId as string,
          `self-review-${suffix}`,
          { note: "Conferência do responsável" },
        ),
      (error) => errorCode(error) === "CASH_SHIFT_REVIEW_DUAL_CONTROL_REQUIRED",
    );
    const reviewed = await management.reviewCashShift(
      reviewer.id,
      organization.id,
      unit.id,
      shiftA.cashShiftId as string,
      `review-${suffix}`,
      { note: "Divergência revisada pelo segundo gestor" },
    );
    const replay = await management.reviewCashShift(
      reviewer.id,
      organization.id,
      unit.id,
      shiftA.cashShiftId as string,
      `review-${suffix}`,
      { note: "Divergência revisada pelo segundo gestor" },
    );
    assert.equal(reviewed.status, "reviewed");
    assert.equal(replay.idempotentReplay, true);

    const finalView = await management.listCashShifts(owner.id, organization.id, unit.id);
    const finalA = finalView.shifts.find((shift) => shift.id === shiftA.cashShiftId);
    assert.equal(finalA?.status, "reviewed");
    assert.equal(finalA?.cashRegisterName, "Caixa A");
    assert.equal(finalA?.operatorName, "Cashier");
    assert.equal(finalA?.closedByName, "Owner");
    assert.equal(finalA?.reviewedByName, "Reviewer");
    assert.equal("openIdempotencyKey" in (finalA ?? {}), false);
    assert.equal(
      finalView.registers.every((register) => register.openShiftId === null),
      true,
    );
    assert.equal(
      finalView.entries.filter((entry) => entry.cashShiftId === shiftA.cashShiftId).length,
      movementResult.status === "fulfilled" ? 4 : 3,
    );

    const terminalId = randomUUID();
    const kdsTerminalId = randomUUID();
    await database.db.insert(posTerminalProfiles).values([
      {
        organizationId: organization.id,
        unitId: unit.id,
        installationId: terminalId,
        label: "Balcão",
        mode: "cashier",
        defaultRoute: "cash",
        createdByIdentityId: owner.id,
        updatedByIdentityId: owner.id,
      },
      {
        organizationId: organization.id,
        unitId: unit.id,
        installationId: kdsTerminalId,
        label: "Cozinha",
        mode: "kds",
        defaultRoute: "kds",
        createdByIdentityId: owner.id,
        updatedByIdentityId: owner.id,
      },
    ]);
    const boundTerminal = await management.updateCashTerminal(
      owner.id,
      organization.id,
      unit.id,
      terminalId,
      `bind-terminal-${suffix}`,
      { cashRegisterId: registerA.id as string },
    );
    assert.equal(boundTerminal.cashRegisterId, registerA.id);

    const settings = await management.updateCashSettings(
      owner.id,
      organization.id,
      unit.id,
      `cash-settings-${suffix}`,
      {
        movementApprovalThresholdCents: 100,
        discrepancyCriticalThresholdCents: 100,
        maxShiftMinutes: 720,
      },
    );
    assert.equal(settings.movementApprovalThresholdCents, 100);
    const controlledShift = await management.openCashShift(
      cashier.id,
      organization.id,
      unit.id,
      `open-controlled-${suffix}`,
      { openingCents: 1_000, cashRegisterId: registerA.id as string },
    );
    await management.handoverCashShift(
      cashier.id,
      organization.id,
      unit.id,
      controlledShift.cashShiftId as string,
      `handover-${suffix}`,
      { toIdentityId: owner.id, reason: "Troca de responsável" },
    );
    const requested = await management.addCashMovement(
      cashier.id,
      organization.id,
      unit.id,
      controlledShift.cashShiftId as string,
      `approval-request-${suffix}`,
      { type: "supply", amountCents: 101, reason: "Reforço sujeito a alçada" },
    );
    assert.ok("approvalId" in requested);
    assert.equal(requested.status, "pending");
    const beforeDecision = await management.cashShiftDetail(
      owner.id,
      organization.id,
      unit.id,
      controlledShift.cashShiftId as string,
    );
    assert.equal(beforeDecision.entries.length, 0);
    const decision = await management.decideCashApproval(
      reviewer.id,
      organization.id,
      unit.id,
      requested.approvalId as string,
      `approval-decision-${suffix}`,
      { decision: "approve", note: "Alçada confirmada" },
    );
    assert.equal(decision.status, "approved");
    assert.ok(decision.executedMovementId);
    const controlledClose = await management.closeCashShift(
      owner.id,
      organization.id,
      unit.id,
      controlledShift.cashShiftId as string,
      `close-controlled-${suffix}`,
      {
        tenderCounts: [{ method: "cash", observedCents: 1_000, source: "manual" }],
      },
    );
    assert.equal(controlledClose.expectedCents, 1_101);
    assert.equal(controlledClose.reviewRequired, true);
    assert.equal(controlledClose.differenceSeverity, "critical");

    const localDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const history = await management.cashShiftHistory(owner.id, organization.id, unit.id, {
      limit: 1,
      from: localDate,
      to: localDate,
      cashRegisterId: registerA.id as string,
    });
    assert.equal(history.items.length, 1);
    assert.ok(history.nextCursor);
    const detail = await management.cashShiftDetail(
      owner.id,
      organization.id,
      unit.id,
      controlledShift.cashShiftId as string,
    );
    assert.equal(detail.responsibilities.length, 1);
    assert.equal(detail.tenderCounts[0]?.differenceCents, -101);
    const exported = await management.exportCashShifts(owner.id, organization.id, unit.id, {
      format: "csv",
      from: localDate,
      to: localDate,
      cashRegisterId: registerA.id as string,
    });
    assert.equal(exported.contentEncoding, "utf8");
    assert.match(exported.filename, /\.csv$/);

    const advancedView = await management.listCashShifts(owner.id, organization.id, unit.id);
    assert.equal(advancedView.capabilities.canManageCashSettings, true);
    assert.equal(advancedView.capabilities.canManageTerminals, true);
    assert.equal(advancedView.capabilities.canApproveCashRequests, true);
    assert.equal(advancedView.availableTerminals.length, 1);
    assert.equal(advancedView.availableTerminals[0]?.installationId, terminalId);
    assert.equal(
      advancedView.alerts.some(
        (alert) => "installationId" in alert && alert.installationId === kdsTerminalId,
      ),
      false,
    );
  } finally {
    await database.onModuleDestroy();
  }
});
