import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  createDatabase,
  identities,
  managementInventoryItems,
  managementInventoryMovements,
  managementRecipeComponents,
  managementRecipeVersions,
  managementStockBalances,
  managementStockLocations,
  organizations,
  outboxEvents,
  posCatalogCategories,
  posOrderItems,
  posOrders,
  posProducts,
  posTabs,
  units,
} from "@giromesa/db";
import { and, eq, inArray } from "drizzle-orm";
import { OutboxWorker } from "./outbox.js";

function document() {
  return String(randomInt(10_000_000_000_000, 99_999_999_999_999));
}

test("consumes a sent order once and preserves tenant isolation in PostgreSQL", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("WORKER_DATABASE_URL not configured");
    return;
  }

  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const database = createDatabase(databaseUrl);
  let worker: OutboxWorker | undefined;
  try {
    const [organizationA, organizationB] = await database.db
      .insert(organizations)
      .values([
        {
          document: document(),
          legalName: "Worker Inventory A Ltda",
          tradeName: "Worker Inventory A",
        },
        {
          document: document(),
          legalName: "Worker Inventory B Ltda",
          tradeName: "Worker Inventory B",
        },
      ])
      .returning();
    assert.ok(organizationA && organizationB);
    const [unitA, unitB] = await database.db
      .insert(units)
      .values([
        { name: "Worker Unit A", organizationId: organizationA.id },
        { name: "Worker Unit B", organizationId: organizationB.id },
      ])
      .returning();
    assert.ok(unitA && unitB);
    const [identityA, identityB] = await database.db
      .insert(identities)
      .values([
        {
          displayName: "Worker Owner A",
          email: `worker-a-${randomUUID()}@example.test`,
        },
        {
          displayName: "Worker Owner B",
          email: `worker-b-${randomUUID()}@example.test`,
        },
      ])
      .returning();
    assert.ok(identityA && identityB);

    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({
        name: "Worker recipes",
        organizationId: organizationA.id,
        slug: `worker-${randomUUID()}`,
      })
      .returning();
    assert.ok(category);
    const [product] = await database.db
      .insert(posProducts)
      .values({
        categoryId: category.id,
        name: "Worker lunch",
        organizationId: organizationA.id,
      })
      .returning();
    assert.ok(product);
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        label: "Worker integration",
        openedByIdentityId: identityA.id,
        organizationId: organizationA.id,
        unitId: unitA.id,
      })
      .returning();
    assert.ok(tab);
    const [order] = await database.db
      .insert(posOrders)
      .values({
        createdByIdentityId: identityA.id,
        organizationId: organizationA.id,
        sentAt: new Date(),
        status: "sent",
        tabId: tab.id,
        unitId: unitA.id,
      })
      .returning();
    assert.ok(order);
    const orderSentAt = order.sentAt;
    assert.ok(orderSentAt);
    const [orderItem] = await database.db
      .insert(posOrderItems)
      .values({
        grossCents: 2_000,
        netCents: 2_000,
        orderId: order.id,
        organizationId: organizationA.id,
        productId: product.id,
        productName: product.name,
        quantity: 2,
        status: "queued",
        unitId: unitA.id,
        unitPriceCents: 1_000,
      })
      .returning();
    assert.ok(orderItem);

    const [locationA, locationB] = await database.db
      .insert(managementStockLocations)
      .values([
        {
          code: `WORKA-${randomUUID().slice(0, 8)}`,
          name: "Worker stock A",
          organizationId: organizationA.id,
          unitId: unitA.id,
        },
        {
          code: `WORKB-${randomUUID().slice(0, 8)}`,
          name: "Worker stock B",
          organizationId: organizationB.id,
          unitId: unitB.id,
        },
      ])
      .returning();
    assert.ok(locationA && locationB);
    const [inventoryA, inventoryB] = await database.db
      .insert(managementInventoryItems)
      .values([
        {
          minimumQuantity: "1.000",
          name: "Rice",
          organizationId: organizationA.id,
          unit: "kg",
          unitId: unitA.id,
        },
        {
          minimumQuantity: "1.000",
          name: "Rice",
          organizationId: organizationB.id,
          unit: "kg",
          unitId: unitB.id,
        },
      ])
      .returning();
    assert.ok(inventoryA && inventoryB);
    const recipeSwitchAt = new Date(orderSentAt.getTime() + 1);
    const [recipeV1, recipeV2] = await database.db
      .insert(managementRecipeVersions)
      .values([
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          productId: product.id,
          version: 1,
          validFrom: new Date(orderSentAt.getTime() - 60_000),
          validUntil: recipeSwitchAt,
          createdByIdentityId: identityA.id,
        },
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          productId: product.id,
          version: 2,
          validFrom: recipeSwitchAt,
          createdByIdentityId: identityA.id,
        },
      ])
      .returning();
    assert.ok(recipeV1 && recipeV2);
    await database.db.insert(managementRecipeComponents).values([
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        recipeVersionId: recipeV1.id,
        inventoryItemId: inventoryA.id,
        locationId: locationA.id,
        quantityMilli: 250,
        quantityMicros: 250_000n,
        unit: "kg",
        lossBasisPoints: 1_000,
      },
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        recipeVersionId: recipeV2.id,
        inventoryItemId: inventoryA.id,
        locationId: locationA.id,
        quantityMilli: 400,
        quantityMicros: 400_000n,
        unit: "kg",
        lossBasisPoints: 0,
      },
    ]);
    const [balanceA, balanceB] = await database.db
      .insert(managementStockBalances)
      .values([
        {
          inventoryItemId: inventoryA.id,
          locationId: locationA.id,
          organizationId: organizationA.id,
          quantity: "10.000",
          unitId: unitA.id,
        },
        {
          inventoryItemId: inventoryB.id,
          locationId: locationB.id,
          organizationId: organizationB.id,
          quantity: "20.000",
          unitId: unitB.id,
        },
      ])
      .returning();
    assert.ok(balanceA && balanceB);

    const ticketId = randomUUID();
    const [outbox] = await database.db
      .insert(outboxEvents)
      .values({
        aggregateId: tab.id,
        aggregateType: "tab",
        organizationId: organizationA.id,
        unitId: unitA.id,
        availableAt: new Date("1970-01-01T00:00:00.000Z"),
        createdAt: new Date("1970-01-01T00:00:00.000Z"),
        payload: {
          orderId: order.id,
          organizationId: organizationA.id,
          tabId: tab.id,
          ticketIds: [ticketId],
          unitId: unitA.id,
        },
        topic: "pos.order.sent",
      })
      .returning();
    assert.ok(outbox);

    worker = new OutboxWorker();
    assert.equal(await worker.runOnce(1), 1);
    const [processed] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, outbox.id))
      .limit(1);
    assert.ok(processed?.processedAt);
    assert.equal(processed.lastError, null);

    const [updatedA, untouchedB] = await Promise.all([
      database.db
        .select({ quantity: managementStockBalances.quantity })
        .from(managementStockBalances)
        .where(eq(managementStockBalances.id, balanceA.id))
        .limit(1),
      database.db
        .select({ quantity: managementStockBalances.quantity })
        .from(managementStockBalances)
        .where(eq(managementStockBalances.id, balanceB.id))
        .limit(1),
    ]);
    assert.equal(updatedA[0]?.quantity, "9.444444");
    assert.equal(untouchedB[0]?.quantity, "20.000000");

    const movementsAfterSend = await database.db
      .select()
      .from(managementInventoryMovements)
      .where(
        and(
          eq(managementInventoryMovements.organizationId, organizationA.id),
          eq(managementInventoryMovements.unitId, unitA.id),
          eq(managementInventoryMovements.type, "order_consumption"),
        ),
      );
    assert.equal(movementsAfterSend.length, 1);
    assert.equal(movementsAfterSend[0]?.quantityDelta, "-0.555556");

    await database.db
      .update(outboxEvents)
      .set({
        attempts: 0,
        availableAt: new Date("1970-01-01T00:00:00.000Z"),
        lastError: null,
        lockedAt: null,
        processedAt: null,
      })
      .where(eq(outboxEvents.id, outbox.id));
    assert.equal(await worker.runOnce(1), 1);

    const [balanceAfterReplay, tenantBMovements] = await Promise.all([
      database.db
        .select({ quantity: managementStockBalances.quantity })
        .from(managementStockBalances)
        .where(eq(managementStockBalances.id, balanceA.id))
        .limit(1),
      database.db
        .select({ id: managementInventoryMovements.id })
        .from(managementInventoryMovements)
        .where(
          and(
            eq(managementInventoryMovements.organizationId, organizationB.id),
            eq(managementInventoryMovements.unitId, unitB.id),
          ),
        ),
    ]);
    const movementsAfterReplay = await database.db
      .select({ id: managementInventoryMovements.id })
      .from(managementInventoryMovements)
      .where(
        and(
          eq(managementInventoryMovements.organizationId, organizationA.id),
          eq(managementInventoryMovements.unitId, unitA.id),
          eq(managementInventoryMovements.type, "order_consumption"),
        ),
      );
    assert.equal(balanceAfterReplay[0]?.quantity, "9.444444");
    assert.equal(movementsAfterReplay.length, 1);
    assert.equal(tenantBMovements.length, 0);

    await database.db
      .update(managementStockBalances)
      .set({ quantity: "0.100" })
      .where(eq(managementStockBalances.id, balanceA.id));
    const [insufficientOrder] = await database.db
      .insert(posOrders)
      .values({
        createdByIdentityId: identityA.id,
        organizationId: organizationA.id,
        sentAt: new Date(),
        status: "sent",
        tabId: tab.id,
        unitId: unitA.id,
      })
      .returning();
    assert.ok(insufficientOrder);
    await database.db.insert(posOrderItems).values({
      grossCents: 2_000,
      netCents: 2_000,
      orderId: insufficientOrder.id,
      organizationId: organizationA.id,
      productId: product.id,
      productName: product.name,
      quantity: 2,
      status: "queued",
      unitId: unitA.id,
      unitPriceCents: 1_000,
    });
    const [insufficientOutbox] = await database.db
      .insert(outboxEvents)
      .values({
        aggregateId: tab.id,
        aggregateType: "tab",
        organizationId: organizationA.id,
        unitId: unitA.id,
        availableAt: new Date("1970-01-02T00:00:00.000Z"),
        createdAt: new Date("1970-01-02T00:00:00.000Z"),
        payload: {
          orderId: insufficientOrder.id,
          organizationId: organizationA.id,
          tabId: tab.id,
          ticketIds: [randomUUID()],
          unitId: unitA.id,
        },
        topic: "pos.order.sent",
      })
      .returning();
    assert.ok(insufficientOutbox);
    assert.equal(await worker.runOnce(1), 1);

    const [blockedEvent, blockedBalance] = await Promise.all([
      database.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, insufficientOutbox.id))
        .limit(1),
      database.db
        .select({ quantity: managementStockBalances.quantity })
        .from(managementStockBalances)
        .where(eq(managementStockBalances.id, balanceA.id))
        .limit(1),
    ]);
    assert.equal(blockedEvent[0]?.processedAt, null);
    assert.equal(
      blockedEvent[0]?.lastError,
      "INVENTORY_ATTENTION_RETRY:INVENTORY_STOCK_INSUFFICIENT",
    );
    assert.equal(blockedBalance[0]?.quantity, "0.100000");

    const alerts = (
      await database.db
        .select({ id: outboxEvents.id, payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(eq(outboxEvents.topic, "management.inventory_attention_required"))
    ).filter((event) => event.payload.orderId === insufficientOrder.id);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.payload.policy, "block_and_retry");
    assert.equal(alerts[0]?.payload.requiredQuantity, "0.800000");

    await database.db
      .update(outboxEvents)
      .set({ availableAt: new Date("1970-01-02T00:00:00.000Z"), lockedAt: null })
      .where(eq(outboxEvents.id, insufficientOutbox.id));
    assert.equal(await worker.runOnce(1), 1);
    const replayedAlerts = (
      await database.db
        .select({ id: outboxEvents.id, payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(eq(outboxEvents.topic, "management.inventory_attention_required"))
    ).filter((event) => event.payload.orderId === insufficientOrder.id);
    assert.equal(replayedAlerts.length, 1);
    await database.db
      .update(outboxEvents)
      .set({ lockedAt: null, processedAt: new Date() })
      .where(
        inArray(outboxEvents.id, [
          insufficientOutbox.id,
          ...replayedAlerts.map((event) => event.id),
        ]),
      );
  } finally {
    if (worker) await worker.close();
    await database.client.end();
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
