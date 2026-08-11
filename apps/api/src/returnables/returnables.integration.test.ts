import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  identities,
  managementReturnableMovements,
  managementReturnableSerials,
  memberships,
  organizations,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { ReturnablesService } from "./returnables.service.js";

function hasCode(expectedCode: string) {
  return (error: unknown) => {
    if (!error || typeof error !== "object" || !("getResponse" in error)) return false;
    const response = (error as { getResponse(): unknown }).getResponse();
    return (
      typeof response === "object" &&
      response !== null &&
      "code" in response &&
      response.code === expectedCode
    );
  };
}

it("tracks serialized and aggregate custody with idempotent physical reconciliation", async (context) => {
  const databaseUrl = process.env.RETURNABLES_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("RETURNABLES_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Returnables Test Ltda",
        tradeName: "Returnables Test",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Returnables Unit" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `returnables-${randomUUID()}@example.test`, displayName: "Inventory Owner" })
      .returning();
    assert.ok(unit && identity);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: identity.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });

    const service = new ReturnablesService(database, new ScopeService(database));
    const keg = await service.createAsset(
      identity.id,
      organization.id,
      unit.id,
      "returnable-asset-keg-0001",
      {
        sku: `KEG-${randomUUID().slice(0, 8)}`,
        name: "Barril inox 30L",
        trackingMode: "serialized",
        depositCents: 40_000,
        serialNumbers: ["KEG-001"],
      },
    );
    const received = await service.move(
      identity.id,
      organization.id,
      unit.id,
      "returnable-movement-0001",
      {
        assetId: keg.assetId,
        serialId: keg.serials[0]?.serialId,
        movementType: "receive",
        quantity: 1,
        fromCustody: { type: "supplier", id: "supplier-a" },
        toCustody: { type: "location", id: "stock-main" },
        occurredAt: "2026-08-11T12:00:00.000Z",
      },
    );
    const replay = await service.move(
      identity.id,
      organization.id,
      unit.id,
      "returnable-movement-0001",
      {
        assetId: keg.assetId,
        serialId: keg.serials[0]?.serialId,
        movementType: "receive",
        quantity: 1,
        fromCustody: { type: "supplier", id: "supplier-a" },
        toCustody: { type: "location", id: "stock-main" },
        occurredAt: "2026-08-11T12:00:00.000Z",
      },
    );
    assert.equal(replay.movementId, received.movementId);
    assert.equal(replay.idempotentReplay, true);

    const concurrentMoves = await Promise.allSettled([
      service.move(identity.id, organization.id, unit.id, "returnable-race-table-a", {
        assetId: keg.assetId,
        serialId: keg.serials[0]?.serialId,
        movementType: "circulate",
        quantity: 1,
        fromCustody: { type: "location", id: "stock-main" },
        toCustody: { type: "table", id: "table-a" },
        occurredAt: "2026-08-11T12:01:00.000Z",
      }),
      service.move(identity.id, organization.id, unit.id, "returnable-race-table-b", {
        assetId: keg.assetId,
        serialId: keg.serials[0]?.serialId,
        movementType: "circulate",
        quantity: 1,
        fromCustody: { type: "location", id: "stock-main" },
        toCustody: { type: "table", id: "table-b" },
        occurredAt: "2026-08-11T12:01:00.000Z",
      }),
    ]);
    assert.equal(concurrentMoves.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrentMoves.filter((result) => result.status === "rejected").length, 1);
    const winningMovement = concurrentMoves.find((result) => result.status === "fulfilled");
    assert.ok(winningMovement?.status === "fulfilled");
    const serializedReconciliation = await service.reconcile(
      identity.id,
      organization.id,
      unit.id,
      "returnable-serialized-reconcile-0001",
      {
        assetId: keg.assetId,
        custody: {
          type: winningMovement.value.toCustodyType as "table",
          id: winningMovement.value.toCustodyId as string,
        },
        physicalSerialIds: [],
        occurredAt: "2026-08-11T12:02:00.000Z",
        reason: "Contagem serial individual aprovada no fechamento.",
      },
    );
    assert.equal(serializedReconciliation.expectedQuantity, 1);
    assert.equal(serializedReconciliation.adjustmentQuantity, -1);
    assert.equal(serializedReconciliation.movementIds.length, 1);

    const crate = await service.createAsset(
      identity.id,
      organization.id,
      unit.id,
      "returnable-asset-crate-0001",
      {
        sku: `CRATE-${randomUUID().slice(0, 8)}`,
        name: "Engradado retornável",
        trackingMode: "aggregate",
        depositCents: 2_500,
        serialNumbers: [],
      },
    );
    await service.move(identity.id, organization.id, unit.id, "returnable-movement-0002", {
      assetId: crate.assetId,
      movementType: "receive",
      quantity: 10,
      fromCustody: { type: "supplier", id: "supplier-a" },
      toCustody: { type: "location", id: "stock-main" },
      occurredAt: "2026-08-11T12:05:00.000Z",
    });
    const reconciliation = await service.reconcile(
      identity.id,
      organization.id,
      unit.id,
      "returnable-reconcile-0001",
      {
        assetId: crate.assetId,
        custody: { type: "location", id: "stock-main" },
        physicalQuantity: 8,
        occurredAt: "2026-08-11T13:00:00.000Z",
        reason: "Contagem física aprovada no fechamento do estoque.",
      },
    );
    assert.deepEqual(
      { expected: reconciliation.expectedQuantity, adjustment: reconciliation.adjustmentQuantity },
      { expected: 10, adjustment: -2 },
    );
    assert.equal(
      (await service.ledger(identity.id, organization.id, unit.id, crate.assetId)).length,
      2,
    );

    const aggregateRaceAsset = await service.createAsset(
      identity.id,
      organization.id,
      unit.id,
      "returnable-asset-aggregate-race-0001",
      {
        sku: `AGG-${randomUUID().slice(0, 8)}`,
        name: "Caixa agregada concorrente",
        trackingMode: "aggregate",
        serialNumbers: [],
      },
    );
    await service.move(identity.id, organization.id, unit.id, "aggregate-race-receive-0001", {
      assetId: aggregateRaceAsset.assetId,
      movementType: "receive",
      quantity: 10,
      fromCustody: { type: "supplier", id: "supplier-a" },
      toCustody: { type: "location", id: "aggregate-stock" },
      occurredAt: "2026-08-11T14:00:00.000Z",
    });
    await assert.rejects(
      () =>
        service.move(identity.id, organization.id, unit.id, "aggregate-overspend-0001", {
          assetId: aggregateRaceAsset.assetId,
          movementType: "circulate",
          quantity: 11,
          fromCustody: { type: "location", id: "aggregate-stock" },
          toCustody: { type: "table", id: "aggregate-table" },
          occurredAt: "2026-08-11T14:01:00.000Z",
        }),
      hasCode("RETURNABLE_INSUFFICIENT_BALANCE"),
    );
    const aggregateRace = await Promise.allSettled([
      service.move(identity.id, organization.id, unit.id, "aggregate-race-out-a-0001", {
        assetId: aggregateRaceAsset.assetId,
        movementType: "circulate",
        quantity: 7,
        fromCustody: { type: "location", id: "aggregate-stock" },
        toCustody: { type: "table", id: "aggregate-table-a" },
        occurredAt: "2026-08-11T14:02:00.000Z",
      }),
      service.move(identity.id, organization.id, unit.id, "aggregate-race-out-b-0001", {
        assetId: aggregateRaceAsset.assetId,
        movementType: "circulate",
        quantity: 7,
        fromCustody: { type: "location", id: "aggregate-stock" },
        toCustody: { type: "table", id: "aggregate-table-b" },
        occurredAt: "2026-08-11T14:02:00.000Z",
      }),
    ]);
    assert.equal(aggregateRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(aggregateRace.filter((result) => result.status === "rejected").length, 1);
    const rejectedAggregateMove = aggregateRace.find((result) => result.status === "rejected");
    assert.ok(rejectedAggregateMove?.status === "rejected");
    assert.equal(hasCode("RETURNABLE_INSUFFICIENT_BALANCE")(rejectedAggregateMove.reason), true);
    await assert.rejects(
      () =>
        service.move(identity.id, organization.id, unit.id, "aggregate-backdated-0001", {
          assetId: aggregateRaceAsset.assetId,
          movementType: "circulate",
          quantity: 1,
          fromCustody: { type: "location", id: "aggregate-stock" },
          toCustody: { type: "table", id: "aggregate-table-c" },
          occurredAt: "2026-08-11T13:59:00.000Z",
        }),
      hasCode("RETURNABLE_MOVEMENT_BACKDATED"),
    );

    const atomicSerialAsset = await service.createAsset(
      identity.id,
      organization.id,
      unit.id,
      "returnable-asset-atomic-reconcile-0001",
      {
        sku: `SER-${randomUUID().slice(0, 8)}`,
        name: "Seriais para reconciliação atômica",
        trackingMode: "serialized",
        serialNumbers: ["ATOMIC-001", "ATOMIC-002"],
      },
    );
    const serialRows = await database.db
      .select()
      .from(managementReturnableSerials)
      .where(eq(managementReturnableSerials.assetId, atomicSerialAsset.assetId));
    assert.equal(serialRows.length, 2);
    await service.move(identity.id, organization.id, unit.id, "atomic-serial-receive-0001", {
      assetId: atomicSerialAsset.assetId,
      serialId: serialRows[0]?.id,
      movementType: "receive",
      quantity: 1,
      fromCustody: { type: "supplier", id: "supplier-a" },
      toCustody: { type: "location", id: "atomic-stock" },
      occurredAt: "2026-08-11T15:00:00.000Z",
    });
    await service.move(identity.id, organization.id, unit.id, "atomic-serial-receive-0002", {
      assetId: atomicSerialAsset.assetId,
      serialId: serialRows[1]?.id,
      movementType: "receive",
      quantity: 1,
      fromCustody: { type: "supplier", id: "supplier-a" },
      toCustody: { type: "location", id: "atomic-stock" },
      occurredAt: "2026-08-11T15:02:00.000Z",
    });
    await assert.rejects(
      () =>
        service.reconcile(
          identity.id,
          organization.id,
          unit.id,
          "returnable-atomic-reconcile-0001",
          {
            assetId: atomicSerialAsset.assetId,
            custody: { type: "location", id: "atomic-stock" },
            physicalSerialIds: [],
            occurredAt: "2026-08-11T15:01:00.000Z",
            reason: "Reconciliação deve reverter todos os ajustes se um deles falhar.",
          },
        ),
      hasCode("RETURNABLE_MOVEMENT_BACKDATED"),
    );
    assert.equal(
      (await service.ledger(identity.id, organization.id, unit.id, atomicSerialAsset.assetId))
        .length,
      2,
    );
    await assert.rejects(() =>
      database.db
        .update(managementReturnableMovements)
        .set({ reason: "Tentativa de mutação" })
        .where(eq(managementReturnableMovements.id, received.movementId)),
    );
    const [otherOrganization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Other Returnables Ltda",
        tradeName: "Other Returnables",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      })
      .returning();
    assert.ok(otherOrganization);
    const [otherUnit] = await database.db
      .insert(units)
      .values({ organizationId: otherOrganization.id, name: "Other Unit" })
      .returning();
    assert.ok(otherUnit);
    const crossTenantRows = await database.withTenantContext(
      { source: "job", organizationId: otherOrganization.id, unitId: otherUnit.id },
      (tx) => tx.select().from(managementReturnableMovements),
    );
    assert.deepEqual(crossTenantRows, []);
  } finally {
    await database.onModuleDestroy();
  }
});
