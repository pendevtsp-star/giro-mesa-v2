import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  auditEvents,
  fiscalDocuments,
  identities,
  managementCashEntries,
  managementCashRegisters,
  managementCashShifts,
  memberships,
  organizations,
  posPaymentReversals,
  posTabPayments,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { PilotSmartPosService } from "./pilot-smartpos.service.js";

it("corrects a manual payment once, preserving ledger, scope and terminal restrictions", async (context) => {
  if (!process.env.PILOT_DATABASE_URL) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = process.env.PILOT_DATABASE_URL;
  const database = new DatabaseService();
  try {
    const run = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Manual reversal QA",
        tradeName: "Manual reversal QA",
        document: run.replaceAll("-", "").slice(0, 14),
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit, otherUnit] = await database.db
      .insert(units)
      .values([
        { organizationId: organization.id, name: "Corrections" },
        { organizationId: organization.id, name: "Other" },
      ])
      .returning();
    const [manager, cashier] = await database.db
      .insert(identities)
      .values([
        { email: `manager-${run}@example.test`, displayName: "Manager" },
        { email: `cashier-${run}@example.test`, displayName: "Cashier" },
      ])
      .returning();
    assert.ok(unit && otherUnit && manager && cashier);
    const [managerMembership, cashierMembership] = await database.db
      .insert(memberships)
      .values([
        { identityId: manager.id, organizationId: organization.id, status: "active" },
        { identityId: cashier.id, organizationId: organization.id, status: "active" },
      ])
      .returning();
    assert.ok(managerMembership && cashierMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: managerMembership.id, role: "owner" },
      { membershipId: cashierMembership.id, role: "cashier" },
    ]);
    const scope = new ScopeService(database);
    const service = new PilotPosService(database, scope, new PilotSmartPosService(database, scope));
    const [register] = await database.db
      .insert(managementCashRegisters)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        name: "Correction register",
      })
      .returning();
    assert.ok(register);
    const [shift] = await database.db
      .insert(managementCashShifts)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        cashRegisterId: register.id,
        operatorIdentityId: manager.id,
        currentResponsibleIdentityId: manager.id,
        openingCents: 0,
        openIdempotencyKey: `shift-${run}`,
      })
      .returning();
    assert.ok(shift);
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: manager.id,
        totalCents: 1500,
      })
      .returning();
    assert.ok(tab);
    const recorded = await service.recordPayment(
      manager.id,
      organization.id,
      unit.id,
      tab.id,
      `payment-${run}`,
      { method: "cash", amountCents: 1500, cashRegisterId: register.id },
    );
    const paymentId = recorded.payment.id;
    const reverse = (actor: string, targetUnit: string, key: string) =>
      service.requestPaymentReversal(actor, organization.id, targetUnit, paymentId, key, {
        reason: "Pagamento confirmado por engano",
      });
    await assert.rejects(reverse(cashier.id, unit.id, `cashier-${run}`));
    await assert.rejects(reverse(manager.id, otherUnit.id, `scope-${run}`));
    const results = await Promise.allSettled([
      reverse(manager.id, unit.id, `reverse-${run}`),
      reverse(manager.id, unit.id, `race-${run}`),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const successful = results.findIndex((result) => result.status === "fulfilled");
    const result = results[successful];
    assert.ok(result?.status === "fulfilled");
    assert.equal(result.value.action, null);
    assert.equal(result.value.reversal.status, "approved");
    assert.equal(result.value.reversal.installationId, null);
    const replay = await reverse(
      manager.id,
      unit.id,
      successful === 0 ? `reverse-${run}` : `race-${run}`,
    );
    assert.equal(replay.idempotentReplay, true);
    const snapshot = await service.getTab(manager.id, organization.id, unit.id, tab.id);
    assert.equal(snapshot.paymentSummary.paidCents, 0);
    assert.equal(snapshot.payments[0]?.amountCents, 1500);
    assert.equal(snapshot.payments[0]?.netAmountCents, 0);
    assert.equal(snapshot.payments[0]?.financialStatus, "reversed");
    const reversals = await database.db
      .select()
      .from(posPaymentReversals)
      .where(eq(posPaymentReversals.paymentId, paymentId));
    assert.equal(reversals.length, 1);
    const entries = await database.db
      .select()
      .from(managementCashEntries)
      .where(
        and(
          eq(managementCashEntries.sourceType, "payment_reversal"),
          eq(managementCashEntries.sourceId, result.value.reversal.id),
        ),
      );
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.amountCents, 1500);
    assert.equal(entries[0]?.direction, "out");
    assert.equal(entries[0]?.affectsDrawer, true);
    const audit = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, result.value.reversal.id),
          eq(auditEvents.organizationId, organization.id),
        ),
      );
    assert.equal(audit.length, 1);

    const paidAgain = await service.recordPayment(
      manager.id,
      organization.id,
      unit.id,
      tab.id,
      `again-${run}`,
      { method: "cash", amountCents: 1500, cashRegisterId: register.id },
    );
    const [fiscal] = await database.db
      .insert(fiscalDocuments)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        tabId: tab.id,
        model: "nfce",
        environment: "homologation",
        status: "authorized",
        idempotencyKey: `fiscal-${run}`,
        totalCents: 1500,
        snapshot: {},
      })
      .returning();
    assert.ok(fiscal);
    await assert.rejects(
      service.requestPaymentReversal(
        manager.id,
        organization.id,
        unit.id,
        paidAgain.payment.id,
        `fiscal-reversal-${run}`,
        { reason: "Não estornar com NFC-e ativa" },
      ),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "PAYMENT_REVERSAL_REQUIRES_FISCAL_CANCELLATION",
        );
        return true;
      },
    );
    await database.db
      .update(fiscalDocuments)
      .set({ status: "canceled" })
      .where(eq(fiscalDocuments.id, fiscal.id));
    const closingRace = await Promise.allSettled([
      service.closeTab(manager.id, organization.id, unit.id, tab.id, `close-race-${run}`, {
        printRequested: false,
      }),
      service.requestPaymentReversal(
        manager.id,
        organization.id,
        unit.id,
        paidAgain.payment.id,
        `close-reversal-${run}`,
        { reason: "Correção concorrente ao fechamento" },
      ),
    ]);
    assert.equal(closingRace.filter((entry) => entry.status === "fulfilled").length, 1);
    const afterRace = await service.getTab(manager.id, organization.id, unit.id, tab.id);
    assert.deepEqual(
      [afterRace.tab.status, afterRace.paymentSummary.paidCents],
      closingRace[0]?.status === "fulfilled" ? ["closed", 1500] : ["open", 0],
    );
    await database.db.update(posTabs).set({ status: "closed" }).where(eq(posTabs.id, tab.id));
    await assert.rejects(
      service.requestPaymentReversal(
        manager.id,
        organization.id,
        unit.id,
        paidAgain.payment.id,
        `closed-${run}`,
        { reason: "Conta já encerrada" },
      ),
    );
    await database.db.update(posTabs).set({ status: "open" }).where(eq(posTabs.id, tab.id));
    await database.db
      .update(posTabPayments)
      .set({ source: "terminal", verified: true })
      .where(eq(posTabPayments.id, paidAgain.payment.id));
    await assert.rejects(
      service.requestPaymentReversal(
        manager.id,
        organization.id,
        unit.id,
        paidAgain.payment.id,
        `terminal-${run}`,
        { reason: "Não corrigir como manual" },
      ),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "PAYMENT_REVERSAL_REQUIRES_VERIFIED_TERMINAL",
        );
        return true;
      },
    );
  } finally {
    await database.onModuleDestroy();
  }
});
