import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import type { PrintDocumentPayloadV2 } from "@giromesa/contracts";
import {
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
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { PilotSmartPosService } from "./pilot-smartpos.service.js";

it("settles a 50-real tab with 20 cash and 30 Pix without duplicate or excess payments", async (context) => {
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
        legalName: "Mixed payment QA",
        tradeName: "Mixed payment QA",
        document: run.replaceAll("-", "").slice(0, 14),
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Mixed payments" })
      .returning();
    const [owner] = await database.db
      .insert(identities)
      .values({ email: `mixed-${run}@example.test`, displayName: "Owner" })
      .returning();
    assert.ok(unit && owner);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: owner.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    const [register] = await database.db
      .insert(managementCashRegisters)
      .values({ organizationId: organization.id, unitId: unit.id, name: "Mixed payments" })
      .returning();
    assert.ok(register);
    const [shift] = await database.db
      .insert(managementCashShifts)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        cashRegisterId: register.id,
        operatorIdentityId: owner.id,
        currentResponsibleIdentityId: owner.id,
        openingCents: 0,
        openIdempotencyKey: `shift-${run}`,
      })
      .returning();
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: owner.id,
        subtotalCents: 5000,
        totalCents: 5000,
      })
      .returning();
    assert.ok(shift && tab);
    const scope = new ScopeService(database);
    const service = new PilotPosService(database, scope, new PilotSmartPosService(database, scope));
    const print = async (
      tabId: string,
      documentType: "partial_statement" | "payment_statement" | "final_receipt",
    ) => {
      const result = await service.createPrintJob(
        owner.id,
        organization.id,
        unit.id,
        tabId,
        randomUUID(),
        { documentType, copies: 1 },
      );
      return result.printJob.payload as unknown as PrintDocumentPayloadV2;
    };
    const pay = (method: "cash" | "pix", amountCents: number, key: string) =>
      service.recordPayment(owner.id, organization.id, unit.id, tab.id, key, {
        method,
        amountCents,
        ...(method === "cash" ? { receivedCents: amountCents } : {}),
        cashRegisterId: register.id,
      });
    const cash = await pay("cash", 2000, `cash-${run}`);
    assert.equal(cash.paidCents, 2000);
    assert.equal(cash.remainingCents, 3000);
    const partial = await service.getTab(owner.id, organization.id, unit.id, tab.id);
    assert.equal(partial.paymentSummary.paidCents, 2000);
    assert.equal(partial.tab.totalCents - partial.paymentSummary.paidCents, 3000);
    const partialPrint = await print(tab.id, "partial_statement");
    assert.equal(partialPrint.context.status, "open");
    assert.equal(partialPrint.totals.remainingCents, 3000);
    assert.equal(partialPrint.payments[0]?.receivedCents, 2000);
    assert.equal(partialPrint.payments[0]?.changeCents, 0);
    await assert.rejects(pay("pix", 3001, `excess-${run}`), (error: unknown) => {
      assert.deepEqual(
        (error as { response?: { code?: string; remainingCents?: number } }).response,
        {
          code: "TAB_OVERPAYMENT",
          message: "O pagamento excede o saldo livre da comanda.",
          remainingCents: 3000,
        },
      );
      return true;
    });
    const pix = await pay("pix", 3000, `pix-${run}`);
    assert.equal(pix.paidCents, 5000);
    assert.equal(pix.remainingCents, 0);
    const replay = await pay("cash", 2000, `cash-${run}`);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.payment.id, cash.payment.id);
    const settled = await service.getTab(owner.id, organization.id, unit.id, tab.id);
    assert.equal(settled.paymentSummary.paidCents, 5000);
    assert.equal(settled.tab.totalCents - settled.paymentSummary.paidCents, 0);
    const mixedPrint = await print(tab.id, "payment_statement");
    assert.equal(mixedPrint.totals.paidCents, 5000);
    assert.equal(
      mixedPrint.payments.find((payment) => payment.method === "pix")?.receivedCents,
      null,
    );
    await service.closeTab(owner.id, organization.id, unit.id, tab.id, randomUUID(), {
      printRequested: false,
    });
    const finalPrint = await print(tab.id, "final_receipt");
    assert.equal(finalPrint.context.status, "closed");
    assert.equal(finalPrint.totals.remainingCents, 0);
    const payments = await database.db
      .select()
      .from(posTabPayments)
      .where(eq(posTabPayments.tabId, tab.id));
    assert.deepEqual(
      payments
        .map(({ method, amountCents }) => ({ method, amountCents }))
        .sort((a, b) => a.method.localeCompare(b.method)),
      [
        { method: "cash", amountCents: 2000 },
        { method: "pix", amountCents: 3000 },
      ],
    );
    const entries = await database.db
      .select()
      .from(managementCashEntries)
      .where(eq(managementCashEntries.cashShiftId, shift.id));
    assert.equal(entries.length, 2);
    assert.equal(
      entries.reduce((total, entry) => total + entry.amountCents, 0),
      5000,
    );
    assert.equal(
      entries
        .filter((entry) => entry.affectsDrawer)
        .reduce((total, entry) => total + entry.amountCents, 0),
      2000,
    );

    const [changeTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: owner.id,
        subtotalCents: 5000,
        totalCents: 5000,
      })
      .returning();
    assert.ok(changeTab);
    const recordCashWithChange = () =>
      service.recordPayment(owner.id, organization.id, unit.id, changeTab.id, `change-${run}`, {
        method: "cash",
        amountCents: 5000,
        receivedCents: 7000,
        reference: "Recebido R$ 70,00; troco R$ 20,00",
        cashRegisterId: register.id,
      });
    const change = await recordCashWithChange();
    assert.equal(change.paidCents, 5000);
    assert.equal(change.remainingCents, 0);
    const changeReplay = await recordCashWithChange();
    assert.equal(changeReplay.idempotentReplay, true);
    assert.equal(changeReplay.payment.id, change.payment.id);
    const changePayments = await database.db
      .select()
      .from(posTabPayments)
      .where(eq(posTabPayments.tabId, changeTab.id));
    assert.equal(changePayments.length, 1);
    assert.equal(changePayments[0]?.amountCents, 5000);
    assert.equal(changePayments[0]?.receivedCents, 7000);
    assert.equal(changePayments[0]?.changeCents, 2000);
    assert.equal(changePayments[0]?.reference, "Recebido R$ 70,00; troco R$ 20,00");
    const changeEntries = await database.db
      .select()
      .from(managementCashEntries)
      .where(eq(managementCashEntries.sourceId, change.payment.id));
    assert.equal(changeEntries.length, 1);
    assert.equal(changeEntries[0]?.amountCents, 5000);
    assert.equal(changeEntries[0]?.direction, "in");
    assert.equal(changeEntries[0]?.affectsDrawer, true);
    await assert.rejects(
      service.recordPayment(owner.id, organization.id, unit.id, changeTab.id, `change-${run}`, {
        method: "cash",
        amountCents: 5000,
        receivedCents: 8000,
        reference: "Recebido R$ 70,00; troco R$ 20,00",
        cashRegisterId: register.id,
      }),
    );
    const cashPrint = await print(changeTab.id, "partial_statement");
    assert.equal(cashPrint.context.status, "open");
    assert.equal(cashPrint.payments[0]?.receivedCents, 7000);
    assert.equal(cashPrint.payments[0]?.changeCents, 2000);

    // A stored partial reversal must preserve the original exchange, not recalculate change.
    const [partialReversal] = await database.db
      .insert(posPaymentReversals)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        paymentId: change.payment.id,
        requestedByIdentityId: owner.id,
        amountCents: 1000,
        reason: "Partial reversal fixture",
        status: "approved",
      })
      .returning();
    assert.ok(partialReversal);
    const reversedPrint = await print(changeTab.id, "payment_statement");
    assert.deepEqual(
      [
        reversedPrint.payments[0]?.amountCents,
        reversedPrint.payments[0]?.netAmountCents,
        reversedPrint.payments[0]?.reversedCents,
        reversedPrint.payments[0]?.receivedCents,
        reversedPrint.payments[0]?.changeCents,
      ],
      [4000, 4000, 1000, 7000, 2000],
    );
    await database.db
      .update(posPaymentReversals)
      .set({ status: "canceled" })
      .where(eq(posPaymentReversals.id, partialReversal.id));
    await service.requestPaymentReversal(
      owner.id,
      organization.id,
      unit.id,
      change.payment.id,
      randomUUID(),
      { reason: "Full correction" },
    );
    const fullReversalPrint = await print(changeTab.id, "payment_statement");
    assert.deepEqual(
      [
        fullReversalPrint.payments[0]?.amountCents,
        fullReversalPrint.payments[0]?.reversedCents,
        fullReversalPrint.payments[0]?.receivedCents,
        fullReversalPrint.payments[0]?.changeCents,
      ],
      [0, 5000, 7000, 2000],
    );
    assert.equal(fullReversalPrint.totals.remainingCents, 5000);
    const legacy = await service.recordPayment(
      owner.id,
      organization.id,
      unit.id,
      changeTab.id,
      randomUUID(),
      {
        method: "cash",
        amountCents: 5000,
        reference: "Recebido R$ 70,00; troco R$ 20,00",
        cashRegisterId: register.id,
      },
    );
    const legacyPrint = await print(changeTab.id, "payment_statement");
    assert.equal(
      legacyPrint.payments.find((payment) => payment.id === legacy.payment.id)?.receivedCents,
      null,
    );
    assert.equal(
      legacyPrint.payments.find((payment) => payment.id === legacy.payment.id)?.changeCents,
      null,
    );
    for (const invalid of [
      { method: "cash" as const, receivedCents: 4999, changeCents: 0 },
      { method: "pix" as const, receivedCents: 7000, changeCents: 2000 },
      { method: "cash" as const, receivedCents: 7000, changeCents: 1 },
      { method: "cash" as const, receivedCents: 7000, changeCents: null },
    ]) {
      await assert.rejects(
        database.db.insert(posTabPayments).values({
          organizationId: organization.id,
          unitId: unit.id,
          tabId: changeTab.id,
          createdByIdentityId: owner.id,
          amountCents: 5000,
          ...invalid,
        }),
      );
    }
  } finally {
    await database.onModuleDestroy();
  }
});
