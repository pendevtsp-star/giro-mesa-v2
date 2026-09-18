import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it, type TestContext } from "node:test";
import {
  auditEvents,
  identities,
  managementInventoryItems,
  managementInventoryMovements,
  managementInventoryReservations,
  managementRecipeComponents,
  managementRecipeVersions,
  managementStockBalances,
  managementStockLocations,
  memberships,
  organizations,
  outboxEvents,
  posCatalogCategories,
  posOrders,
  posProductAvailability,
  posProductPrices,
  posProducts,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, asc, eq, gt, isNull, lte, or } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { reserveOrderInventory } from "../pilot-operations/order-inventory.js";
import { ManagementService } from "./management.service.js";

async function fixture(context: TestContext) {
  if (!process.env.MANAGEMENT_DATABASE_URL) {
    context.skip("MANAGEMENT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = process.env.MANAGEMENT_DATABASE_URL;
  const database = new DatabaseService();
  context.after(() => database.onModuleDestroy());
  const management = new ManagementService(database, new ScopeService(database));
  const [organization] = await database.db
    .insert(organizations)
    .values({
      legalName: "Inventory recovery",
      tradeName: "Inventory recovery",
      document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      billingState: "active",
    })
    .returning();
  assert.ok(organization);
  const [unit, otherUnit] = await database.db
    .insert(units)
    .values([
      { organizationId: organization.id, name: "Bar" },
      { organizationId: organization.id, name: "Other unit" },
    ])
    .returning();
  const [identity] = await database.db
    .insert(identities)
    .values({
      email: `inventory-recovery-${randomUUID()}@example.test`,
      displayName: "Owner",
    })
    .returning();
  assert.ok(unit && otherUnit && identity);
  const [membership] = await database.db
    .insert(memberships)
    .values({
      organizationId: organization.id,
      identityId: identity.id,
      status: "active",
    })
    .returning();
  assert.ok(membership);
  await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
  const [source, destination] = await database.db
    .insert(managementStockLocations)
    .values([
      {
        organizationId: organization.id,
        unitId: unit.id,
        name: "Depósito",
        code: "DEP",
        kind: "warehouse" as const,
      },
      {
        organizationId: organization.id,
        unitId: unit.id,
        name: "Freezer",
        code: "FRZ",
        kind: "freezer" as const,
        requireDistinctTransferReceiver: false,
      },
    ])
    .returning();
  const [item] = await database.db
    .insert(managementInventoryItems)
    .values({
      organizationId: organization.id,
      unitId: unit.id,
      name: "Insumo",
      unit: "kg",
      kind: "ingredient",
      allowNegative: false,
    })
    .returning();
  assert.ok(source && destination && item);
  return {
    database,
    management,
    organization,
    unit,
    otherUnit,
    identity,
    source,
    destination,
    item,
  };
}

it("receives partial replenishment into a deficit and safely costs lots that clear or cross zero", async (context) => {
  const f = await fixture(context);
  if (!f) return;
  const { database, management, organization, unit, identity, source, destination, item } = f;
  await database.db.insert(managementStockBalances).values([
    {
      organizationId: organization.id,
      unitId: unit.id,
      inventoryItemId: item.id,
      locationId: source.id,
      quantity: "10",
      averageCostCents: 200,
    },
    {
      organizationId: organization.id,
      unitId: unit.id,
      inventoryItemId: item.id,
      locationId: destination.id,
      quantity: "-10",
      averageCostCents: 500,
    },
  ]);
  const batch = await management.transferInventoryBatch(
    identity.id,
    organization.id,
    unit.id,
    randomUUID(),
    {
      sourceLocationId: source.id,
      destinationLocationId: destination.id,
      reason: "Reposição conferida",
      lines: [{ inventoryItemId: item.id, quantity: "3" }],
    },
  );
  const transfer = batch.transfers[0];
  assert.ok(transfer);
  const receiveKey = randomUUID();
  const receipt = {
    decision: "received" as const,
    quantityReceived: "3",
    note: "Reposição parcial do déficit",
  };
  await management.resolveInventoryTransfer(
    identity.id,
    organization.id,
    unit.id,
    transfer.id,
    receiveKey,
    receipt,
  );
  await management.resolveInventoryTransfer(
    identity.id,
    organization.id,
    unit.id,
    transfer.id,
    receiveKey,
    receipt,
  );
  const balance = async () =>
    (
      await database.db
        .select()
        .from(managementStockBalances)
        .where(
          and(
            eq(managementStockBalances.inventoryItemId, item.id),
            eq(managementStockBalances.locationId, destination.id),
          ),
        )
    )[0];
  assert.equal((await balance())?.quantity, "-7.000");
  assert.equal((await balance())?.averageCostCents, 200);
  await assert.rejects(
    management.transferInventoryBatch(identity.id, organization.id, unit.id, randomUUID(), {
      sourceLocationId: destination.id,
      destinationLocationId: source.id,
      reason: "Saída sem saldo",
      lines: [{ inventoryItemId: item.id, quantity: "1" }],
    }),
  );
  await management.createInventoryLot(identity.id, organization.id, unit.id, randomUUID(), {
    inventoryItemId: item.id,
    locationId: destination.id,
    batchCode: "ZERO",
    quantity: "7",
    unitCostCents: 300,
  });
  assert.equal((await balance())?.quantity, "0.000");
  assert.equal((await balance())?.averageCostCents, 300);
  await database.db
    .update(managementStockBalances)
    .set({ quantity: "-3", averageCostCents: 500 })
    .where(
      and(
        eq(managementStockBalances.inventoryItemId, item.id),
        eq(managementStockBalances.locationId, destination.id),
      ),
    );
  await management.createInventoryLot(identity.id, organization.id, unit.id, randomUUID(), {
    inventoryItemId: item.id,
    locationId: destination.id,
    batchCode: "POSITIVE",
    quantity: "6",
    unitCostCents: 200,
  });
  assert.equal((await balance())?.quantity, "3.000");
  assert.equal((await balance())?.averageCostCents, 200);
  const movements = await database.db
    .select()
    .from(managementInventoryMovements)
    .where(
      and(
        eq(managementInventoryMovements.inventoryItemId, item.id),
        eq(managementInventoryMovements.locationId, destination.id),
      ),
    );
  assert.equal(movements.filter((movement) => movement.type === "transfer_in").length, 1);
});

it("counts order outbox work by payload order and excludes other units and malformed IDs", async (context) => {
  const f = await fixture(context);
  if (!f) return;
  const { database, management, organization, unit, otherUnit, identity } = f;
  const [tab, otherTab] = await database.db
    .insert(posTabs)
    .values([
      { organizationId: organization.id, unitId: unit.id, openedByIdentityId: identity.id },
      { organizationId: organization.id, unitId: otherUnit.id, openedByIdentityId: identity.id },
    ])
    .returning();
  assert.ok(tab && otherTab);
  const [order, otherOrder] = await database.db
    .insert(posOrders)
    .values([
      {
        organizationId: organization.id,
        unitId: unit.id,
        tabId: tab.id,
        createdByIdentityId: identity.id,
      },
      {
        organizationId: organization.id,
        unitId: otherUnit.id,
        tabId: otherTab.id,
        createdByIdentityId: identity.id,
      },
    ])
    .returning();
  assert.ok(order && otherOrder);
  const event = {
    topic: "pos.order.sent",
    aggregateType: "tab",
    aggregateId: tab.id,
    payload: { organizationId: organization.id, unitId: unit.id, tabId: tab.id, orderId: order.id },
  };
  const processedAt = new Date("2026-09-18T10:00:00.000Z");
  await database.db.insert(outboxEvents).values([
    event,
    { ...event, lastError: "Inventory processing failed", attempts: 1 },
    { ...event, processedAt },
    { ...event, topic: "another.topic" },
    { ...event, payload: { ...event.payload, orderId: "not-a-uuid" } },
    { ...event, payload: { ...event.payload, organizationId: randomUUID() } },
    { ...event, payload: { ...event.payload, unitId: otherUnit.id } },
    {
      ...event,
      aggregateId: otherTab.id,
      payload: {
        organizationId: organization.id,
        unitId: otherUnit.id,
        tabId: otherTab.id,
        orderId: otherOrder.id,
      },
    },
  ]);
  const dashboard = await management.inventoryDashboard(identity.id, organization.id, unit.id);
  assert.equal(dashboard.automation.pending, 2);
  assert.equal(dashboard.automation.failed, 1);
  assert.equal(
    new Date(dashboard.automation.lastProcessedAt ?? "").toISOString(),
    processedAt.toISOString(),
  );
});

it("deactivates optional recipes idempotently while preserving history and availability", async (context) => {
  const f = await fixture(context);
  if (!f) return;
  const { database, management, organization, unit, otherUnit, identity, source, item } = f;
  const [category] = await database.db
    .insert(posCatalogCategories)
    .values({ organizationId: organization.id, name: "Pratos", slug: "pratos" })
    .returning();
  assert.ok(category);
  const [product] = await database.db
    .insert(posProducts)
    .values({ organizationId: organization.id, categoryId: category.id, name: "Prato" })
    .returning();
  assert.ok(product);
  await database.db.insert(posProductAvailability).values({
    organizationId: organization.id,
    unitId: unit.id,
    productId: product.id,
    available: true,
  });
  await database.db.insert(posProductPrices).values({
    organizationId: organization.id,
    unitId: unit.id,
    productId: product.id,
    priceCents: 2500,
  });
  const configuration = {
    productId: product.id,
    components: [
      { inventoryItemId: item.id, locationId: source.id, quantityMilli: 250, lossBasisPoints: 0 },
    ],
  };
  const configured = await management.configureRecipe(
    identity.id,
    organization.id,
    unit.id,
    randomUUID(),
    configuration,
  );
  const [waiter] = await database.db
    .insert(identities)
    .values({ email: `recipe-waiter-${randomUUID()}@example.test`, displayName: "Garçom" })
    .returning();
  assert.ok(waiter);
  const [waiterMembership] = await database.db
    .insert(memberships)
    .values({ organizationId: organization.id, identityId: waiter.id, status: "active" })
    .returning();
  assert.ok(waiterMembership);
  await database.db.insert(roleBindings).values({
    membershipId: waiterMembership.id,
    unitId: unit.id,
    role: "waiter",
  });
  await assert.rejects(
    management.deactivateRecipe(waiter.id, organization.id, unit.id, product.id, randomUUID()),
    (error) => (error as { getStatus(): number }).getStatus() === 403,
  );
  await management.deactivateRecipe(
    identity.id,
    organization.id,
    otherUnit.id,
    product.id,
    randomUUID(),
  );
  assert.equal(
    (await management.listRecipeConfigurations(identity.id, organization.id, unit.id)).length,
    1,
  );
  const key = randomUUID();
  const disabled = await management.deactivateRecipe(
    identity.id,
    organization.id,
    unit.id,
    product.id,
    key,
  );
  assert.equal(disabled.active, false);
  assert.equal(disabled.recipeVersionId, configured.recipeVersionId);
  assert.ok(disabled.validUntil);
  assert.deepEqual(
    await management.deactivateRecipe(identity.id, organization.id, unit.id, product.id, key),
    { ...disabled, idempotentReplay: true },
  );
  assert.deepEqual(
    await management.listRecipeConfigurations(identity.id, organization.id, unit.id),
    [],
  );
  const historical = await database.db
    .select()
    .from(managementRecipeVersions)
    .where(
      and(
        eq(managementRecipeVersions.productId, product.id),
        lte(managementRecipeVersions.validFrom, new Date(configured.validFrom)),
        or(
          isNull(managementRecipeVersions.validUntil),
          gt(managementRecipeVersions.validUntil, new Date(configured.validFrom)),
        ),
      ),
    );
  assert.equal(historical[0]?.id, configured.recipeVersionId);
  assert.equal(
    (
      await database.db
        .select()
        .from(managementRecipeComponents)
        .where(eq(managementRecipeComponents.recipeVersionId, configured.recipeVersionId))
    ).length,
    1,
  );
  assert.equal(
    (
      await database.db
        .select()
        .from(posProductAvailability)
        .where(eq(posProductAvailability.productId, product.id))
    )[0]?.available,
    true,
  );
  assert.equal(
    (
      await database.db
        .select()
        .from(posProductPrices)
        .where(eq(posProductPrices.productId, product.id))
    )[0]?.priceCents,
    2500,
  );
  const nextOrderId = randomUUID();
  await database.db.transaction((tx) =>
    reserveOrderInventory(tx, {
      organizationId: organization.id,
      unitId: unit.id,
      identityId: identity.id,
      orderId: nextOrderId,
      sentAt: new Date(disabled.validUntil as string),
      source: "operator",
      items: [
        {
          id: randomUUID(),
          productId: product.id,
          productName: product.name,
          quantity: 1,
          stationId: null,
        },
      ],
    }),
  );
  assert.equal(
    (
      await database.db
        .select()
        .from(managementInventoryReservations)
        .where(eq(managementInventoryReservations.sourceId, nextOrderId))
    ).length,
    0,
  );
  const audit = await database.db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.entityId, configured.recipeVersionId),
        eq(auditEvents.action, "management.recipe.deactivated"),
      ),
    );
  assert.equal(audit.length, 1);
  assert.equal(audit[0]?.actorIdentityId, identity.id);
  await Promise.all([
    management.configureRecipe(identity.id, organization.id, unit.id, randomUUID(), configuration),
    management.deactivateRecipe(identity.id, organization.id, unit.id, product.id, randomUUID()),
  ]);
  const versions = await database.db
    .select()
    .from(managementRecipeVersions)
    .where(eq(managementRecipeVersions.productId, product.id))
    .orderBy(asc(managementRecipeVersions.version));
  assert.equal(versions.length, 2);
  assert.ok(versions.filter((version) => version.validUntil === null).length <= 1);
  assert.ok(
    versions[0]?.validUntil && versions[1] && versions[0].validUntil <= versions[1].validFrom,
  );
});
