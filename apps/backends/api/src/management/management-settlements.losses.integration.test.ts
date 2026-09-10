import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  deviceEnrollments,
  identities,
  managementAccountsPayable,
  managementPeople,
  memberships,
  organizations,
  posCatalogCategories,
  posOperationalShifts,
  posOrderItems,
  posOrders,
  posPaymentAttempts,
  posPaymentReversals,
  posProducts,
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

const period = { from: "2033-04-10", to: "2033-04-10" };

it("venda cancelada já excluída não reduz novamente a base nem a comissão", async (context) => {
  if (!process.env.MANAGEMENT_DATABASE_URL)
    return context.skip("MANAGEMENT_DATABASE_URL not configured");
  process.env.DATABASE_URL = process.env.MANAGEMENT_DATABASE_URL;
  const database = new DatabaseService();
  try {
    const f = await fixture(database);
    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({
        organizationId: f.organization.id,
        name: "Teste",
        slug: "teste",
      })
      .returning();
    assert.ok(category);
    const [product] = await database.db
      .insert(posProducts)
      .values({
        organizationId: f.organization.id,
        categoryId: category.id,
        name: "Item de teste",
      })
      .returning();
    assert.ok(product);
    const [order] = await database.db
      .insert(posOrders)
      .values({
        organizationId: f.organization.id,
        unitId: f.unit.id,
        tabId: f.tab.id,
        createdByIdentityId: f.owner.id,
      })
      .returning();
    assert.ok(order);
    await database.db.insert(posOrderItems).values([
      {
        organizationId: f.organization.id,
        unitId: f.unit.id,
        orderId: order.id,
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPriceCents: 10_000,
        grossCents: 10_000,
        netCents: 10_000,
      },
      {
        organizationId: f.organization.id,
        unitId: f.unit.id,
        orderId: order.id,
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPriceCents: 5_000,
        grossCents: 5_000,
        netCents: 5_000,
        status: "canceled",
      },
    ]);
    for (const cancellationTreatment of ["deduct", "exclude"] as const) {
      await f.service.updateSettings(f.owner.id, f.organization.id, f.unit.id, randomUUID(), {
        ...defaultSettlementConfig,
        eligibleTabs: "closed",
        partnershipBase: "net_excluding_service",
        cancellationTreatment,
      });
      const line = (await f.preview()).lines[0];
      assert.equal(line?.grossSalesCents, 10_000);
      assert.equal(line?.canceledCents, 5_000);
      assert.equal(line?.partnershipBaseCents, 10_000, cancellationTreatment);
      assert.equal(line?.payableCents, 1_000, cancellationTreatment);
    }
  } finally {
    await database.onModuleDestroy();
  }
});

async function fixture(database: DatabaseService) {
  const scope = new ScopeService(database);
  const service = new ManagementSettlementsService(
    database,
    scope,
    new ManagementService(database, scope),
  );
  const [organization] = await database.db
    .insert(organizations)
    .values({
      legalName: "Settlement loss regression",
      tradeName: "Settlement loss regression",
      document: String(Date.now()).padStart(14, "0").slice(-14),
    })
    .returning();
  assert.ok(organization);
  const [unit] = await database.db
    .insert(units)
    .values({
      organizationId: organization.id,
      name: "Loss regression unit",
      timezone: "America/Sao_Paulo",
    })
    .returning();
  assert.ok(unit);
  const [owner] = await database.db
    .insert(identities)
    .values({
      email: `settlement-loss-${randomUUID()}@example.test`,
      displayName: "Settlement operator",
    })
    .returning();
  assert.ok(owner);
  const [membership] = await database.db
    .insert(memberships)
    .values({
      organizationId: organization.id,
      identityId: owner.id,
      status: "active",
    })
    .returning();
  assert.ok(membership);
  await database.db
    .insert(roleBindings)
    .values({ membershipId: membership.id, unitId: unit.id, role: "owner" });
  await database.db.insert(managementPeople).values({
    organizationId: organization.id,
    unitId: unit.id,
    identityId: owner.id,
    name: "Settlement operator",
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
      status: "closed",
      closedAt: new Date("2033-04-10T22:00:00.000Z"),
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
      responsibleIdentityId: owner.id,
      status: "closed",
      closedAt: new Date("2033-04-10T20:00:00.000Z"),
      subtotalCents: 10_000,
      totalCents: 10_000,
    })
    .returning();
  assert.ok(tab);
  const [device] = await database.db
    .insert(deviceEnrollments)
    .values({
      organizationId: organization.id,
      unitId: unit.id,
      label: "Settlement test terminal",
    })
    .returning();
  assert.ok(device);
  const [attempt] = await database.db
    .insert(posPaymentAttempts)
    .values({
      organizationId: organization.id,
      unitId: unit.id,
      tabId: tab.id,
      installationId: device.id,
      requestedByIdentityId: owner.id,
      provider: "rede",
      method: "pix",
      amountCents: 10_000,
      status: "approved",
      expiresAt: new Date("2033-04-10T20:00:00.000Z"),
    })
    .returning();
  assert.ok(attempt);
  const [payment] = await database.db
    .insert(posTabPayments)
    .values({
      organizationId: organization.id,
      unitId: unit.id,
      tabId: tab.id,
      method: "pix",
      amountCents: 10_000,
      paymentAttemptId: attempt.id,
      source: "terminal",
      verified: true,
      createdByIdentityId: owner.id,
    })
    .returning();
  assert.ok(payment);
  await service.updateSettings(owner.id, organization.id, unit.id, randomUUID(), {
    ...defaultSettlementConfig,
    eligibleTabs: "closed",
    partnershipBase: "received",
    // Legacy setting must not turn an informational incident into a deduction.
    refundTreatment: "deduct",
  });
  await service.updatePartnershipPlan(owner.id, organization.id, unit.id, randomUUID(), {
    name: "Test-only commission fixture",
    effectiveFrom: period.from,
    tiers: [{ minimumCents: 0, maximumCents: null, rewardType: "percentage", rewardValue: 1_000 }],
  });
  const preview = () => service.preview(owner.id, organization.id, unit.id, period);
  const recordLoss = async (type: "refund" | "chargeback" | "other", amountCents: number) => {
    const loss = await service.createOperationalLoss(
      owner.id,
      organization.id,
      unit.id,
      randomUUID(),
      {
        tabId: tab.id,
        type,
        amountCents,
        reason: "Ocorrência somente informativa",
      },
    );
    await service.decideOperationalLoss(owner.id, organization.id, unit.id, loss.id, randomUUID(), {
      action: "approve",
      note: "Registro informativo conferido",
    });
  };
  return {
    service,
    organization,
    unit,
    owner,
    shift,
    tab,
    device,
    attempt,
    payment,
    preview,
    recordLoss,
  };
}

it("perdas informativas não alteram base, comissão, exportação ou contas a pagar", async (context) => {
  if (!process.env.MANAGEMENT_DATABASE_URL)
    return context.skip("MANAGEMENT_DATABASE_URL not configured");
  process.env.DATABASE_URL = process.env.MANAGEMENT_DATABASE_URL;
  const database = new DatabaseService();
  try {
    const f = await fixture(database);
    const before = (await f.preview()).lines[0];
    assert.equal(before?.payableCents, 1_000);
    for (const type of ["refund", "chargeback", "other"] as const) {
      await f.recordLoss(type, 500);
      const line = (await f.preview()).lines[0];
      assert.equal(line?.partnershipBaseCents, before.partnershipBaseCents, type);
      assert.equal(line?.partnershipCents, before.partnershipCents, type);
      assert.equal(line?.payableCents, before.payableCents, type);
    }
    const [payment] = await database.db
      .select()
      .from(posTabPayments)
      .where(eq(posTabPayments.id, f.payment.id));
    const [tab] = await database.db.select().from(posTabs).where(eq(posTabs.id, f.tab.id));
    assert.equal(payment?.amountCents, 10_000);
    assert.equal(tab?.totalCents, 10_000);
    assert.deepEqual(
      await database.db
        .select()
        .from(posPaymentReversals)
        .where(eq(posPaymentReversals.paymentId, f.payment.id)),
      [],
    );
    const settlement = await f.service.createSettlement(
      f.owner.id,
      f.organization.id,
      f.unit.id,
      randomUUID(),
      period,
    );
    assert.equal(settlement.lines[0]?.operationalLossCents, 1_500);
    assert.equal(settlement.lines[0]?.payableCents, 1_000);
    const exported = await f.service.exportCsv(
      f.owner.id,
      f.organization.id,
      f.unit.id,
      settlement.id,
    );
    const columns = exported.content.split("\r\n")[1]?.split(";");
    assert.equal(columns?.[13], '"1500"');
    assert.equal(columns?.[14], '"1000"');
    const approved = await f.service.transition(
      f.owner.id,
      f.organization.id,
      f.unit.id,
      settlement.id,
      randomUUID(),
      {
        action: "approve",
        note: "Conferência dos valores reais",
      },
    );
    const [payable] = await database.db
      .select()
      .from(managementAccountsPayable)
      .where(eq(managementAccountsPayable.id, approved.financePayableId as string));
    assert.equal(payable?.amountCents, 1_000);
  } finally {
    await database.onModuleDestroy();
  }
});

it("fechamentos concorrentes de turno e mês não reutilizam vendas; cancelado pode ser substituído", async (context) => {
  if (!process.env.MANAGEMENT_DATABASE_URL)
    return context.skip("MANAGEMENT_DATABASE_URL not configured");
  process.env.DATABASE_URL = process.env.MANAGEMENT_DATABASE_URL;
  const database = new DatabaseService();
  try {
    const f = await fixture(database);
    const requests = [
      { ...period, operationalShiftId: f.shift.id },
      { from: "2033-04-01", to: "2033-04-30" },
    ];
    const keys = requests.map(() => randomUUID());
    const results = await Promise.allSettled(
      requests.map((request, index) =>
        f.service.createSettlement(
          f.owner.id,
          f.organization.id,
          f.unit.id,
          keys[index] as string,
          request,
        ),
      ),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const winnerIndex = results.findIndex((result) => result.status === "fulfilled");
    const winner = results[winnerIndex];
    assert.ok(winner?.status === "fulfilled");
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected");
    assert.equal(rejected.reason.getResponse().code, "WAITER_SETTLEMENT_SOURCES_ALREADY_CLOSED");
    const replay = await f.service.createSettlement(
      f.owner.id,
      f.organization.id,
      f.unit.id,
      keys[winnerIndex] as string,
      requests[winnerIndex] as typeof period,
    );
    assert.equal(replay.id, winner.value.id);
    await f.service.transition(
      f.owner.id,
      f.organization.id,
      f.unit.id,
      winner.value.id,
      randomUUID(),
      {
        action: "cancel",
        note: "Substituir pelo período conferido",
      },
    );
    const replacement = await f.service.createSettlement(
      f.owner.id,
      f.organization.id,
      f.unit.id,
      randomUUID(),
      requests[1 - winnerIndex] as typeof period,
    );
    assert.notEqual(replacement.id, winner.value.id);
    assert.equal(replacement.lines[0]?.payableCents, 1_000);
  } finally {
    await database.onModuleDestroy();
  }
});

it("base recebida considera somente estorno aprovado e não desconta a ocorrência novamente", async (context) => {
  if (!process.env.MANAGEMENT_DATABASE_URL)
    return context.skip("MANAGEMENT_DATABASE_URL not configured");
  process.env.DATABASE_URL = process.env.MANAGEMENT_DATABASE_URL;
  const database = new DatabaseService();
  try {
    const f = await fixture(database);
    const [reversal] = await database.db
      .insert(posPaymentReversals)
      .values({
        organizationId: f.organization.id,
        unitId: f.unit.id,
        paymentId: f.payment.id,
        paymentAttemptId: f.attempt.id,
        installationId: f.device.id,
        requestedByIdentityId: f.owner.id,
        amountCents: 2_000,
        reason: "Estorno financeiro de teste",
        status: "pending",
      })
      .returning();
    assert.ok(reversal);
    assert.equal((await f.preview()).lines[0]?.receivedCents, 10_000);
    await database.db
      .update(posPaymentReversals)
      .set({
        status: "approved",
        resolvedAt: new Date("2033-04-10T21:00:00.000Z"),
      })
      .where(eq(posPaymentReversals.id, reversal.id));
    const beforeIncident = (await f.preview()).lines[0];
    assert.equal(beforeIncident?.receivedCents, 8_000);
    assert.equal(beforeIncident?.partnershipBaseCents, 8_000);
    assert.equal(beforeIncident?.payableCents, 800);
    await f.recordLoss("refund", 2_000);
    const afterIncident = (await f.preview()).lines[0];
    assert.equal(afterIncident?.receivedCents, 8_000);
    assert.equal(afterIncident?.partnershipBaseCents, 8_000);
    assert.equal(afterIncident?.payableCents, 800);
    assert.equal(afterIncident?.operationalLossCents, 2_000);
  } finally {
    await database.onModuleDestroy();
  }
});
