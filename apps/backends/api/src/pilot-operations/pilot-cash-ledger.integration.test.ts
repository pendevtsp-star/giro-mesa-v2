import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  managementCashEntries,
  managementCashRegisters,
  managementCashShifts,
  memberships,
  organizations,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";

it("routes POS payments across one or multiple cash registers", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const runId = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "POS Cash Ledger Ltda",
        tradeName: "POS Cash Ledger",
        document: `${runId.replaceAll("-", "").slice(0, 12)}31`,
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Caixa" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `cash-ledger-${runId}@example.test`, displayName: "Cashier" })
      .returning();
    assert.ok(unit && identity);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: identity.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    const [cashierIdentity] = await database.db
      .insert(identities)
      .values({ email: `cashier-${runId}@example.test`, displayName: "Cashier operator" })
      .returning();
    assert.ok(cashierIdentity);
    const [cashierMembership] = await database.db
      .insert(memberships)
      .values({
        identityId: cashierIdentity.id,
        organizationId: organization.id,
        status: "active",
      })
      .returning();
    assert.ok(cashierMembership);
    await database.db.insert(roleBindings).values({
      membershipId: cashierMembership.id,
      unitId: unit.id,
      role: "cashier",
    });
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: identity.id,
        totalCents: 100,
      })
      .returning();
    assert.ok(tab);

    const service = new PilotPosService(database, new ScopeService(database));
    await assert.rejects(
      () =>
        service.recordPayment(
          identity.id,
          organization.id,
          unit.id,
          tab.id,
          `cash-without-shift-${runId}`,
          { method: "cash", amountCents: 100 },
        ),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "CASH_SHIFT_REQUIRED",
        );
        return true;
      },
    );
    const [cashRegisterA] = await database.db
      .insert(managementCashRegisters)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        name: "Caixa A",
        createdByIdentityId: identity.id,
      })
      .returning();
    assert.ok(cashRegisterA);
    const [cashShiftA] = await database.db
      .insert(managementCashShifts)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        cashRegisterId: cashRegisterA.id,
        operatorIdentityId: identity.id,
        currentResponsibleIdentityId: identity.id,
        openingCents: 0,
        openIdempotencyKey: `cash-shift-${runId}`,
      })
      .returning();
    assert.ok(cashShiftA);

    const legacyResult = await service.recordPayment(
      identity.id,
      organization.id,
      unit.id,
      tab.id,
      `cash-with-shift-${runId}`,
      { method: "cash", amountCents: 100 },
    );
    const [legacyEntry] = await database.db
      .select()
      .from(managementCashEntries)
      .where(eq(managementCashEntries.sourceId, legacyResult.payment.id));
    assert.deepEqual(
      legacyEntry && {
        cashShiftId: legacyEntry.cashShiftId,
        direction: legacyEntry.direction,
        entryType: legacyEntry.entryType,
        paymentMethod: legacyEntry.paymentMethod,
        affectsDrawer: legacyEntry.affectsDrawer,
        amountCents: legacyEntry.amountCents,
        sourceType: legacyEntry.sourceType,
        actorIdentityId: legacyEntry.actorIdentityId,
      },
      {
        cashShiftId: cashShiftA.id,
        direction: "in",
        entryType: "pos_payment",
        paymentMethod: "cash",
        affectsDrawer: true,
        amountCents: 100,
        sourceType: "pos_tab_payment",
        actorIdentityId: identity.id,
      },
    );

    const [cashRegisterB] = await database.db
      .insert(managementCashRegisters)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        name: "Caixa B",
        createdByIdentityId: identity.id,
      })
      .returning();
    assert.ok(cashRegisterB);
    const [cashShiftB] = await database.db
      .insert(managementCashShifts)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        cashRegisterId: cashRegisterB.id,
        operatorIdentityId: identity.id,
        currentResponsibleIdentityId: identity.id,
        openingCents: 0,
        openIdempotencyKey: `cash-shift-b-${runId}`,
      })
      .returning();
    const [multiRegisterTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: identity.id,
        totalCents: 200,
      })
      .returning();
    assert.ok(cashShiftB && multiRegisterTab);
    await assert.rejects(
      () =>
        service.recordPayment(
          identity.id,
          organization.id,
          unit.id,
          multiRegisterTab.id,
          `cash-ambiguous-${runId}`,
          { method: "cash", amountCents: 200 },
        ),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "CASH_REGISTER_REQUIRED",
        );
        return true;
      },
    );
    const routedResult = await service.recordPayment(
      identity.id,
      organization.id,
      unit.id,
      multiRegisterTab.id,
      `cash-register-b-${runId}`,
      { method: "cash", amountCents: 200, cashRegisterId: cashRegisterB.id },
    );
    const [routedEntry] = await database.db
      .select()
      .from(managementCashEntries)
      .where(eq(managementCashEntries.sourceId, routedResult.payment.id));
    assert.equal(routedEntry?.cashShiftId, cashShiftB.id);

    const installationId = randomUUID();
    const [unboundTerminalTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: cashierIdentity.id,
        totalCents: 100,
      })
      .returning();
    assert.ok(unboundTerminalTab);
    await assert.rejects(
      () =>
        service.recordPayment(
          cashierIdentity.id,
          organization.id,
          unit.id,
          unboundTerminalTab.id,
          `cashier-unbound-terminal-${runId}`,
          { method: "cash", amountCents: 100, installationId },
        ),
      (error: unknown) => {
        assert.equal(
          (error as { response?: { code?: string } }).response?.code,
          "CASH_REGISTER_BINDING_REQUIRED",
        );
        return true;
      },
    );
    await service.putTerminalProfile(
      identity.id,
      organization.id,
      unit.id,
      installationId,
      `cashier-terminal-${runId}`,
      {
        label: "Terminal do caixa B",
        mode: "cashier",
        defaultRoute: "cash",
        printerId: null,
        stationId: null,
        cashRegisterId: cashRegisterB.id,
        compact: true,
        quickActions: ["receive"],
      },
    );
    const [cashierTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: cashierIdentity.id,
        totalCents: 300,
      })
      .returning();
    assert.ok(cashierTab);
    await assert.rejects(
      () =>
        service.recordPayment(
          cashierIdentity.id,
          organization.id,
          unit.id,
          cashierTab.id,
          `cashier-register-override-${runId}`,
          { method: "cash", amountCents: 300, cashRegisterId: cashRegisterA.id },
        ),
      (error: unknown) => {
        assert.equal((error as { response?: { code?: string } }).response?.code, "POS_ROLE_DENIED");
        return true;
      },
    );
    const boundResult = await service.recordPayment(
      cashierIdentity.id,
      organization.id,
      unit.id,
      cashierTab.id,
      `cashier-terminal-binding-${runId}`,
      {
        method: "cash",
        amountCents: 300,
        cashRegisterId: cashRegisterA.id,
        installationId,
      },
    );
    const [boundEntry] = await database.db
      .select()
      .from(managementCashEntries)
      .where(eq(managementCashEntries.sourceId, boundResult.payment.id));
    assert.equal(boundEntry?.cashShiftId, cashShiftB.id);
  } finally {
    await database.onModuleDestroy();
  }
});
