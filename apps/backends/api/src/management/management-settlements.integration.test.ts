import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  managementAccountsPayable,
  managementCashEntries,
  managementPayablePayments,
  managementPeople,
  managementWaiterSettlements,
  memberships,
  organizations,
  posOperationalShifts,
  posTabPayments,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { ManagementService } from "./management.service.js";
import { defaultSettlementConfig } from "./management-settlements.rules.js";
import { ManagementSettlementsService } from "./management-settlements.service.js";

function errorCode(error: unknown) {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  return typeof response === "object" && response !== null
    ? (response as { code?: string }).code
    : undefined;
}

it("apura perda sem descontá-la do pagamento e permite refazer fechamento cancelado", async (context) => {
  const databaseUrl = process.env.MANAGEMENT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("MANAGEMENT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const scope = new ScopeService(database);
    const management = new ManagementService(database, scope);
    const service = new ManagementSettlementsService(database, scope, management);
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Settlement integration test",
        tradeName: "Settlement integration test",
        document: String(Date.now()).padStart(14, "0").slice(-14),
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Settlement unit" })
      .returning();
    assert.ok(unit);
    const [owner, waiter] = await database.db
      .insert(identities)
      .values([
        { email: `settlement-owner-${randomUUID()}@example.test`, displayName: "Owner" },
        { email: `settlement-waiter-${randomUUID()}@example.test`, displayName: "Ana" },
      ])
      .returning();
    assert.ok(owner && waiter);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: owner.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db
      .insert(roleBindings)
      .values({ membershipId: membership.id, role: "owner", unitId: unit.id });
    await database.db.insert(managementPeople).values({
      organizationId: organization.id,
      unitId: unit.id,
      identityId: waiter.id,
      name: "Ana",
      roleLabel: "Garçom",
      updatedByIdentityId: owner.id,
    });
    const [shift] = await database.db
      .insert(posOperationalShifts)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        label: "Jantar",
        openedByIdentityId: owner.id,
      })
      .returning();
    assert.ok(shift);
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        operationalShiftId: shift.id,
        openedByIdentityId: owner.id,
        responsibleIdentityId: waiter.id,
        status: "open",
        subtotalCents: 10_000,
        serviceChargeCents: 1_000,
        totalCents: 11_000,
      })
      .returning();
    assert.ok(tab);
    await database.db.insert(posTabPayments).values({
      organizationId: organization.id,
      unitId: unit.id,
      tabId: tab.id,
      method: "cash",
      amountCents: 5_000,
      createdByIdentityId: owner.id,
    });
    await service.updateSettings(owner.id, organization.id, unit.id, `settings-${randomUUID()}`, {
      ...defaultSettlementConfig,
      eligibleTabs: "closed",
    });
    const losses = await Promise.all(
      [1, 2].map(() =>
        service.createOperationalLoss(owner.id, organization.id, unit.id, `loss-${randomUUID()}`, {
          tabId: tab.id,
          type: "unpaid_tab",
          reason: "Cliente saiu sem pagar",
          amountCents: 6_000,
        }),
      ),
    );
    const decisions = await Promise.allSettled(
      losses.map((loss) =>
        service.decideOperationalLoss(
          owner.id,
          organization.id,
          unit.id,
          loss.id,
          `decision-${randomUUID()}`,
          { action: "approve", note: "Ocorrência conferida" },
        ),
      ),
    );
    assert.equal(decisions.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(
      decisions.some(
        (result) =>
          result.status === "rejected" &&
          errorCode(result.reason) === "OPERATIONAL_LOSS_EXCEEDS_REMAINING",
      ),
      true,
    );
    await database.db
      .update(posTabs)
      .set({ status: "closed", closedAt: new Date("2032-04-10T23:00:00.000Z") })
      .where(eq(posTabs.id, tab.id));
    const blocked = await service.preview(owner.id, organization.id, unit.id, {
      from: "2032-04-10",
      to: "2032-04-10",
      operationalShiftId: shift.id,
    });
    assert.equal(blocked.blockers[0]?.code, "OPERATIONAL_SHIFT_STILL_ACTIVE");
    await database.db
      .update(posOperationalShifts)
      .set({ status: "closed", closedAt: new Date("2032-04-10T23:30:00.000Z") })
      .where(eq(posOperationalShifts.id, shift.id));
    const period = { from: "2032-04-10", to: "2032-04-10", operationalShiftId: shift.id };
    const preview = await service.preview(owner.id, organization.id, unit.id, period);
    assert.equal(preview.operationalLossCents, 6_000);
    assert.equal(preview.lines[0]?.serviceShareCents, 1_000);
    assert.equal(preview.lines[0]?.payableCents, 1_000);

    const first = await service.createSettlement(
      owner.id,
      organization.id,
      unit.id,
      `settlement-${randomUUID()}`,
      period,
    );
    await service.transition(
      owner.id,
      organization.id,
      unit.id,
      first.id,
      `cancel-${randomUUID()}`,
      { action: "cancel", note: "Reprocessar período" },
    );
    const replacement = await service.createSettlement(
      owner.id,
      organization.id,
      unit.id,
      `settlement-${randomUUID()}`,
      period,
    );
    assert.notEqual(replacement.id, first.id);
    const approved = await service.transition(
      owner.id,
      organization.id,
      unit.id,
      replacement.id,
      `approve-${randomUUID()}`,
      { action: "approve", note: "Valores conferidos" },
    );
    assert.ok(approved.financePayableId);
    await assert.rejects(
      management.payPayable(
        owner.id,
        organization.id,
        unit.id,
        approved.financePayableId,
        `generic-pay-${randomUUID()}`,
        { amountCents: 1_000, method: "pix" },
      ),
      (error) => errorCode(error) === "WAITER_SETTLEMENT_PAYABLE_MANAGED",
    );
    await assert.rejects(
      management.cancelPayable(
        owner.id,
        organization.id,
        unit.id,
        approved.financePayableId,
        `generic-cancel-${randomUUID()}`,
        { reason: "Tentativa fora da apuração", version: 1 },
      ),
      (error) => errorCode(error) === "WAITER_SETTLEMENT_PAYABLE_MANAGED",
    );
    await database.db.transaction((tx) =>
      management.payPayableInTransaction(
        tx,
        owner.id,
        organization.id,
        unit.id,
        approved.financePayableId as string,
        `partial-pay-${randomUUID()}`,
        { amountCents: 400, method: "pix", reference: "PARCIAL-INTERNO" },
      ),
    );
    await assert.rejects(
      service.transition(
        owner.id,
        organization.id,
        unit.id,
        replacement.id,
        `cancel-partial-${randomUUID()}`,
        { action: "cancel", note: "Não deve cancelar após pagamento" },
      ),
      (error) => errorCode(error) === "WAITER_SETTLEMENT_PAYABLE_ALREADY_USED",
    );
    const cashRegister = await management.createCashRegister(
      owner.id,
      organization.id,
      unit.id,
      `settlement-register-${randomUUID()}`,
      { name: "Caixa da apuração" },
    );
    const cashShift = await management.openCashShift(
      owner.id,
      organization.id,
      unit.id,
      `settlement-cash-shift-${randomUUID()}`,
      { openingCents: 2_000, cashRegisterId: cashRegister.id as string },
    );
    const paid = await service.transition(
      owner.id,
      organization.id,
      unit.id,
      replacement.id,
      `pay-${randomUUID()}`,
      {
        action: "pay",
        note: "Dinheiro confirmado",
        paymentMethod: "cash",
        paymentReference: "CAIXA-2032-04-10",
        cashRegisterId: cashRegister.id as string,
      },
    );
    assert.equal(paid.paymentMethod, "cash");
    const [persistedSettlement] = await database.db
      .select()
      .from(managementWaiterSettlements)
      .where(eq(managementWaiterSettlements.id, replacement.id));
    assert.ok(persistedSettlement?.financePayableId);
    const [payable] = await database.db
      .select()
      .from(managementAccountsPayable)
      .where(eq(managementAccountsPayable.id, persistedSettlement.financePayableId));
    assert.equal(payable?.status, "paid");
    assert.equal(payable?.amountCents, 1_000);
    const [payment] = await database.db
      .select()
      .from(managementPayablePayments)
      .where(eq(managementPayablePayments.id, persistedSettlement.financePaymentId as string));
    assert.equal(payment?.reference, "CAIXA-2032-04-10");
    const cashEntriesBeforeReversal = await database.db
      .select()
      .from(managementCashEntries)
      .where(eq(managementCashEntries.cashShiftId, cashShift.cashShiftId));
    assert.equal(cashEntriesBeforeReversal.length, 1);
    await assert.rejects(
      management.reversePayablePayment(
        owner.id,
        organization.id,
        unit.id,
        payment?.id as string,
        `generic-reversal-${randomUUID()}`,
        { reason: "Tentativa fora da apuração", cashRegisterId: cashRegister.id as string },
      ),
      (error) => errorCode(error) === "WAITER_SETTLEMENT_PAYABLE_MANAGED",
    );
    const [settlementAfterReversalAttempt] = await database.db
      .select()
      .from(managementWaiterSettlements)
      .where(eq(managementWaiterSettlements.id, replacement.id));
    const [payableAfterReversalAttempt] = await database.db
      .select()
      .from(managementAccountsPayable)
      .where(eq(managementAccountsPayable.id, persistedSettlement.financePayableId));
    const [paymentAfterReversalAttempt] = await database.db
      .select()
      .from(managementPayablePayments)
      .where(eq(managementPayablePayments.id, payment?.id as string));
    const cashEntriesAfterReversal = await database.db
      .select()
      .from(managementCashEntries)
      .where(eq(managementCashEntries.cashShiftId, cashShift.cashShiftId));
    assert.equal(settlementAfterReversalAttempt?.status, "paid");
    assert.equal(payableAfterReversalAttempt?.status, "paid");
    assert.equal(paymentAfterReversalAttempt?.status, "posted");
    assert.equal(cashEntriesAfterReversal.length, cashEntriesBeforeReversal.length);

    await database.db
      .update(managementWaiterSettlements)
      .set({
        status: "approved",
        approvedAt: new Date("2032-04-11T00:00:00.000Z"),
        approvedByIdentityId: owner.id,
        approvalNote: "Apuração aprovada antes do vínculo financeiro",
        canceledAt: null,
        canceledByIdentityId: null,
        cancellationNote: null,
      })
      .where(eq(managementWaiterSettlements.id, first.id));
    const legacyPaid = await service.transition(
      owner.id,
      organization.id,
      unit.id,
      first.id,
      `legacy-pay-${randomUUID()}`,
      {
        action: "pay",
        note: "Liquidação de apuração legada",
        paymentMethod: "bank_transfer",
        paymentReference: "LEGADO-2032-04-10",
      },
    );
    assert.ok(legacyPaid.financePayableId);
    assert.ok(legacyPaid.financePaymentId);
  } finally {
    await database.onModuleDestroy();
  }
});
