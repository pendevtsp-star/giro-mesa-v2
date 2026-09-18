import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  auditEvents,
  createDatabase,
  identities,
  managementInventoryItems,
  managementInventoryLots,
  managementInventoryMovements,
  managementProductReturnables,
  managementReturnableCustodyMovements,
  managementReturnablePolicies,
  managementStockBalances,
  managementStockLocations,
  organizations,
  posCatalogCategories,
  posOrderItems,
  posOrders,
  posProducts,
  posTabs,
  units,
} from "@giromesa/db";
import { and, eq } from "drizzle-orm";
import {
  consumeOrderSentInventory,
  type OrderSentOutboxEvent,
  reverseCanceledOrderItemInventory,
} from "./inventory.js";

test("keeps the sold inventory item and reverses original movements after relinking, including legacy orders", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("WORKER_DATABASE_URL not configured");
    return;
  }
  const database = createDatabase(databaseUrl);
  try {
    const [organization, foreignOrganization] = await database.db
      .insert(organizations)
      .values(
        ["Binding", "Foreign binding"].map((name) => ({
          legalName: name,
          tradeName: name,
          document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
        })),
      )
      .returning();
    assert.ok(organization && foreignOrganization);
    const [unit, foreignUnit] = await database.db
      .insert(units)
      .values([
        { organizationId: organization.id, name: "Bar" },
        { organizationId: foreignOrganization.id, name: "Foreign bar" },
      ])
      .returning();
    const [actor] = await database.db
      .insert(identities)
      .values({ displayName: "Owner", email: `binding-${randomUUID()}@example.test` })
      .returning();
    assert.ok(unit && foreignUnit && actor);
    const scope = { organizationId: organization.id, unitId: unit.id };
    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({ organizationId: organization.id, name: "Bebidas", slug: "bebidas" })
      .returning();
    assert.ok(category);
    const [product, otherProduct] = await database.db
      .insert(posProducts)
      .values([
        { organizationId: organization.id, categoryId: category.id, name: "Cerveja" },
        { organizationId: organization.id, categoryId: category.id, name: "Outro produto" },
      ])
      .returning();
    const [location] = await database.db
      .insert(managementStockLocations)
      .values({ ...scope, name: "Freezer", code: "freezer" })
      .returning();
    const [tab] = await database.db
      .insert(posTabs)
      .values({ ...scope, openedByIdentityId: actor.id, label: "Mesa" })
      .returning();
    assert.ok(product && otherProduct && location && tab);
    const [original, replacement] = await database.db
      .insert(managementInventoryItems)
      .values([
        {
          ...scope,
          name: "Cerveja original",
          kind: "resale" as const,
          productId: product.id,
          unit: "un",
        },
        { ...scope, name: "Cerveja substituta", kind: "resale" as const, unit: "un" },
      ])
      .returning();
    const [foreignItem] = await database.db
      .insert(managementInventoryItems)
      .values({
        organizationId: foreignOrganization.id,
        unitId: foreignUnit.id,
        name: "Outro tenant",
        kind: "resale",
        unit: "un",
      })
      .returning();
    assert.ok(original && replacement && foreignItem);
    await database.db.insert(managementStockBalances).values([
      {
        ...scope,
        inventoryItemId: original.id,
        locationId: location.id,
        quantity: "10.000",
        averageCostCents: 100,
      },
      {
        ...scope,
        inventoryItemId: replacement.id,
        locationId: location.id,
        quantity: "10.000",
        averageCostCents: 900,
      },
    ]);
    const balances = async () => {
      const rows = await database.db
        .select()
        .from(managementStockBalances)
        .where(
          and(
            eq(managementStockBalances.organizationId, scope.organizationId),
            eq(managementStockBalances.unitId, scope.unitId),
          ),
        );
      return [original.id, replacement.id].map(
        (id) => rows.find((row) => row.inventoryItemId === id)?.quantity,
      );
    };
    const sentOrder = async (
      snapshotItemId?: string | null,
      quantity = 2,
      returnables?: unknown,
    ) => {
      const [order] = await database.db
        .insert(posOrders)
        .values({
          ...scope,
          tabId: tab.id,
          createdByIdentityId: actor.id,
          status: "sent",
          sentAt: new Date(),
        })
        .returning();
      assert.ok(order);
      const [item] = await database.db
        .insert(posOrderItems)
        .values({
          ...scope,
          orderId: order.id,
          productId: product.id,
          productName: product.name,
          quantity,
          status: "queued",
          unitPriceCents: 1000,
          grossCents: quantity * 1000,
          netCents: quantity * 1000,
        })
        .returning();
      assert.ok(item);
      if (snapshotItemId !== undefined)
        await database.db.insert(auditEvents).values({
          ...scope,
          actorIdentityId: actor.id,
          action: "management.inventory.order-reviewed",
          entityType: "order",
          entityId: order.id,
          metadata: {
            source: "operator",
            shortageAcknowledged: false,
            ...(returnables !== undefined ? { returnables } : {}),
            sources:
              snapshotItemId === null
                ? []
                : [
                    {
                      orderItemId: item.id,
                      inventoryItemId: snapshotItemId,
                      locationId: location.id,
                    },
                  ],
          },
        });
      const event: OrderSentOutboxEvent = {
        id: randomUUID(),
        aggregate_type: "tab",
        aggregate_id: tab.id,
        payload: { ...scope, orderId: order.id, tabId: tab.id, ticketIds: [randomUUID()] },
      };
      return { event, itemId: item.id, orderId: order.id, sentAt: order.sentAt };
    };
    const cancel = async (itemId: string) => {
      await database.db
        .update(posOrderItems)
        .set({ status: "canceled" })
        .where(eq(posOrderItems.id, itemId));
      const event: OrderSentOutboxEvent = {
        id: randomUUID(),
        aggregate_type: "tab",
        aggregate_id: tab.id,
        payload: {
          ...scope,
          tabId: tab.id,
          itemId,
          approvalId: randomUUID(),
          reason: "Cancelamento",
        },
      };
      const result = await reverseCanceledOrderItemInventory(database.db, event);
      assert.equal((await reverseCanceledOrderItemInventory(database.db, event)).movementCount, 0);
      return result;
    };

    // Unlink the original and replace the live mapping before consumption.
    const changed = await sentOrder(original.id);
    await database.db
      .update(managementInventoryItems)
      .set({ productId: null })
      .where(eq(managementInventoryItems.id, original.id));
    await database.db
      .update(managementInventoryItems)
      .set({ productId: product.id })
      .where(eq(managementInventoryItems.id, replacement.id));
    assert.equal((await consumeOrderSentInventory(database.db, changed.event)).movementCount, 1);
    assert.equal((await consumeOrderSentInventory(database.db, changed.event)).movementCount, 0);
    assert.deepEqual(await balances(), ["8.000", "10.000"]);
    await database.db
      .update(managementInventoryItems)
      .set({ productId: otherProduct.id })
      .where(eq(managementInventoryItems.id, original.id));
    assert.equal((await cancel(changed.itemId)).movementCount, 1);
    assert.deepEqual(await balances(), ["10.000", "10.000"]);
    const [originalReversal] = await database.db
      .select()
      .from(managementInventoryMovements)
      .where(
        and(
          eq(managementInventoryMovements.organizationId, scope.organizationId),
          eq(managementInventoryMovements.unitId, scope.unitId),
          eq(managementInventoryMovements.type, "order_cancellation"),
        ),
      );
    assert.equal(originalReversal?.inventoryItemId, original.id);
    assert.equal(originalReversal?.unitCostCents, 100);
    assert.equal(originalReversal?.quantityDelta, "2.000");

    // No current product mapping remains; historical cancellation may restore an archived item.
    const unlinked = await sentOrder(replacement.id);
    await database.db
      .update(managementInventoryItems)
      .set({ productId: null })
      .where(eq(managementInventoryItems.id, replacement.id));
    assert.equal((await consumeOrderSentInventory(database.db, unlinked.event)).movementCount, 1);
    assert.deepEqual(await balances(), ["10.000", "8.000"]);
    await database.db
      .update(managementInventoryItems)
      .set({ active: false })
      .where(eq(managementInventoryItems.id, replacement.id));
    assert.equal((await cancel(unlinked.itemId)).movementCount, 1);
    assert.deepEqual(await balances(), ["10.000", "10.000"]);

    // A snapshot never falls back to another item when its original item is inactive or foreign.
    const inactive = await sentOrder(original.id);
    await database.db
      .update(managementInventoryItems)
      .set({ active: false })
      .where(eq(managementInventoryItems.id, original.id));
    await database.db
      .update(managementInventoryItems)
      .set({ active: true, productId: product.id })
      .where(eq(managementInventoryItems.id, replacement.id));
    const blocked = await consumeOrderSentInventory(database.db, inactive.event);
    assert.equal(blocked.retryRequired, true);
    assert.ok(blocked.issueCodes.includes("INVENTORY_ITEM_INACTIVE"));
    const foreign = await sentOrder(foreignItem.id);
    const rejected = await consumeOrderSentInventory(database.db, foreign.event);
    assert.equal(rejected.retryRequired, true);
    assert.ok(rejected.issueCodes.includes("INVENTORY_MAPPING_MISSING"));
    assert.deepEqual(await balances(), ["10.000", "10.000"]);

    // Legacy movement hashes are found even if the current mapping no longer names their item.
    await database.db
      .update(managementInventoryItems)
      .set({ productId: null })
      .where(eq(managementInventoryItems.id, replacement.id));
    await database.db
      .update(managementInventoryItems)
      .set({ active: true, productId: product.id })
      .where(eq(managementInventoryItems.id, original.id));
    const legacy = await sentOrder();
    assert.equal((await consumeOrderSentInventory(database.db, legacy.event)).movementCount, 1);
    await database.db
      .update(managementInventoryItems)
      .set({ productId: null })
      .where(eq(managementInventoryItems.id, original.id));
    await database.db
      .update(managementInventoryItems)
      .set({ productId: product.id })
      .where(eq(managementInventoryItems.id, replacement.id));
    assert.equal((await cancel(legacy.itemId)).movementCount, 1);
    assert.deepEqual(await balances(), ["10.000", "10.000"]);

    // An explicitly empty snapshot freezes the choice to sell without stock control.
    const untracked = await sentOrder(null);
    assert.equal((await consumeOrderSentInventory(database.db, untracked.event)).movementCount, 0);
    assert.equal((await cancel(untracked.itemId)).movementCount, 0);
    assert.deepEqual(await balances(), ["10.000", "10.000"]);

    const lots = await database.db
      .insert(managementInventoryLots)
      .values([
        {
          ...scope,
          inventoryItemId: replacement.id,
          locationId: location.id,
          batchCode: "first",
          quantity: "2.000",
          expiresAt: new Date("2100-01-01T00:00:00Z"),
        },
        {
          ...scope,
          inventoryItemId: replacement.id,
          locationId: location.id,
          batchCode: "second",
          quantity: "3.000",
          expiresAt: new Date("2100-02-01T00:00:00Z"),
        },
      ])
      .returning();
    const lotQuantities = async () => {
      const rows = await database.db
        .select()
        .from(managementInventoryLots)
        .where(
          and(
            eq(managementInventoryLots.organizationId, scope.organizationId),
            eq(managementInventoryLots.unitId, scope.unitId),
            eq(managementInventoryLots.inventoryItemId, replacement.id),
          ),
        );
      return lots.map((lot) => rows.find((row) => row.id === lot.id)?.quantity);
    };
    // Both physical stock and the exact FEFO lots must survive cancellation after relinking.
    const multiLot = await sentOrder(replacement.id, 5);
    assert.equal((await consumeOrderSentInventory(database.db, multiLot.event)).movementCount, 1);
    assert.equal((await consumeOrderSentInventory(database.db, multiLot.event)).movementCount, 0);
    assert.deepEqual(await balances(), ["10.000", "5.000"]);
    assert.deepEqual(await lotQuantities(), ["0.000", "0.000"]);
    await database.db
      .update(managementInventoryItems)
      .set({ productId: null })
      .where(eq(managementInventoryItems.id, replacement.id));
    await database.db
      .update(managementInventoryItems)
      .set({ productId: product.id })
      .where(eq(managementInventoryItems.id, original.id));
    assert.equal((await cancel(multiLot.itemId)).movementCount, 1);
    assert.deepEqual(await balances(), ["10.000", "10.000"]);
    assert.deepEqual(await lotQuantities(), ["2.000", "3.000"]);

    const [container, replacementContainer, foreignContainer] = await database.db
      .insert(managementInventoryItems)
      .values([
        { ...scope, name: "Garrafa original", kind: "returnable_container" as const, unit: "un" },
        { ...scope, name: "Garrafa nova", kind: "returnable_container" as const, unit: "un" },
        {
          organizationId: foreignOrganization.id,
          unitId: foreignUnit.id,
          name: "Garrafa externa",
          kind: "returnable_container" as const,
          unit: "un",
        },
      ])
      .returning();
    assert.ok(container && replacementContainer && foreignContainer);
    const [mapping] = await database.db
      .insert(managementProductReturnables)
      .values({
        ...scope,
        productId: product.id,
        containerInventoryItemId: container.id,
        quantityPerUnit: "1.000",
        depositCents: 300,
      })
      .returning();
    assert.ok(mapping);
    await database.db.insert(managementReturnablePolicies).values({
      ...scope,
      defaultDueDays: 12,
      updatedByIdentityId: actor.id,
    });
    const savedMapping = {
      id: mapping.id,
      productId: mapping.productId,
      containerInventoryItemId: mapping.containerInventoryItemId,
      quantityPerUnit: mapping.quantityPerUnit,
      depositCents: mapping.depositCents,
    };
    const custodyFor = (itemId: string) =>
      database.db
        .select()
        .from(managementReturnableCustodyMovements)
        .where(
          and(
            eq(managementReturnableCustodyMovements.organizationId, scope.organizationId),
            eq(managementReturnableCustodyMovements.unitId, scope.unitId),
            eq(managementReturnableCustodyMovements.orderItemId, itemId),
          ),
        );

    // The reviewed container, deposit, quantity and deadline survive later catalog changes.
    const returnableOrder = await sentOrder(original.id, 2, {
      mappings: [savedMapping],
      defaultDueDays: 12,
    });
    await database.db
      .update(managementProductReturnables)
      .set({ active: false, quantityPerUnit: "3.000", depositCents: 900 })
      .where(eq(managementProductReturnables.id, mapping.id));
    const [newMapping] = await database.db
      .insert(managementProductReturnables)
      .values({
        ...scope,
        productId: product.id,
        containerInventoryItemId: replacementContainer.id,
        quantityPerUnit: "2.000",
        depositCents: 1000,
      })
      .returning();
    assert.ok(newMapping);
    await database.db
      .update(managementReturnablePolicies)
      .set({ defaultDueDays: 30 })
      .where(
        and(
          eq(managementReturnablePolicies.organizationId, scope.organizationId),
          eq(managementReturnablePolicies.unitId, scope.unitId),
        ),
      );
    await database.db
      .update(managementInventoryItems)
      .set({ active: false, kind: "ingredient" })
      .where(eq(managementInventoryItems.id, container.id));
    assert.equal(
      (await consumeOrderSentInventory(database.db, returnableOrder.event)).movementCount,
      1,
    );
    await consumeOrderSentInventory(database.db, returnableOrder.event);
    const [issued] = await custodyFor(returnableOrder.itemId);
    assert.ok(issued && returnableOrder.sentAt);
    assert.equal((await custodyFor(returnableOrder.itemId)).length, 1);
    assert.equal(issued.containerInventoryItemId, container.id);
    assert.equal(issued.quantityDelta, "2.000");
    assert.equal(issued.context.depositCents, 300);
    assert.equal(issued.dueAt?.getTime(), returnableOrder.sentAt.getTime() + 12 * 86_400_000);
    await database.db.insert(managementReturnableCustodyMovements).values({
      ...scope,
      containerInventoryItemId: container.id,
      locationId: issued.locationId,
      type: "return",
      quantityDelta: "-0.750",
      orderId: issued.orderId,
      orderItemId: issued.orderItemId,
      parentMovementId: issued.id,
      dueAt: issued.dueAt,
      sourceType: "binding_test_return",
      sourceId: randomUUID(),
      idempotencyKey: randomUUID(),
      actorIdentityId: actor.id,
    });
    assert.equal((await cancel(returnableOrder.itemId)).movementCount, 1);
    const returnedCustody = await custodyFor(returnableOrder.itemId);
    assert.equal(returnedCustody.length, 3);
    const correction = returnedCustody.find((row) => row.type === "correction");
    assert.equal(correction?.quantityDelta, "-1.250");
    assert.equal(correction?.containerInventoryItemId, container.id);
    assert.equal(correction?.parentMovementId, issued.id);
    assert.equal(correction?.dueAt?.getTime(), issued.dueAt?.getTime());
    assert.deepEqual(await balances(), ["10.000", "10.000"]);

    // Enabling returnables after send must not create a debt for an untracked sale.
    await database.db
      .update(managementProductReturnables)
      .set({ active: false })
      .where(eq(managementProductReturnables.id, newMapping.id));
    const lateActivation = await sentOrder(null, 2, { mappings: [], defaultDueDays: 7 });
    await database.db
      .update(managementProductReturnables)
      .set({ active: true })
      .where(eq(managementProductReturnables.id, newMapping.id));
    await consumeOrderSentInventory(database.db, lateActivation.event);
    await consumeOrderSentInventory(database.db, lateActivation.event);
    assert.deepEqual(await custodyFor(lateActivation.itemId), []);
    await cancel(lateActivation.itemId);
    assert.deepEqual(await custodyFor(lateActivation.itemId), []);

    // A canceled line remains part of review scope, but must never create custody afterward.
    const canceledBeforeConsumption = await sentOrder(original.id, 2, {
      mappings: [savedMapping],
      defaultDueDays: 12,
    });
    await cancel(canceledBeforeConsumption.itemId);
    const canceledResult = await consumeOrderSentInventory(
      database.db,
      canceledBeforeConsumption.event,
    );
    assert.equal(canceledResult.retryRequired, false);
    assert.equal(canceledResult.movementCount, 0);
    assert.deepEqual(await custodyFor(canceledBeforeConsumption.itemId), []);
    assert.deepEqual(await balances(), ["10.000", "10.000"]);

    // Older reviews without the new key continue using their established live configuration.
    const legacyReturnable = await sentOrder(null);
    await consumeOrderSentInventory(database.db, legacyReturnable.event);
    const [legacyIssue] = await custodyFor(legacyReturnable.itemId);
    assert.ok(legacyIssue && legacyReturnable.sentAt);
    assert.equal(legacyIssue.containerInventoryItemId, replacementContainer.id);
    assert.equal(legacyIssue.quantityDelta, "4.000");
    assert.equal(legacyIssue.context.depositCents, 1000);
    assert.equal(legacyIssue.dueAt?.getTime(), legacyReturnable.sentAt.getTime() + 30 * 86_400_000);
    await cancel(legacyReturnable.itemId);

    const invalidReviews = [
      null,
      { mappings: [savedMapping, { ...savedMapping, id: "invalid" }], defaultDueDays: 12 },
      { mappings: [{ ...savedMapping, quantityPerUnit: "0.000" }], defaultDueDays: 12 },
      { mappings: [{ ...savedMapping, quantityPerUnit: "0.0001" }], defaultDueDays: 12 },
      { mappings: [{ ...savedMapping, quantityPerUnit: "10000000000000" }], defaultDueDays: 12 },
      { mappings: [{ ...savedMapping, depositCents: -1 }], defaultDueDays: 12 },
      { mappings: [{ ...savedMapping, depositCents: 0.5 }], defaultDueDays: 12 },
      { mappings: [savedMapping], defaultDueDays: 366 },
      { mappings: [savedMapping, savedMapping], defaultDueDays: 12 },
    ];
    for (const review of invalidReviews) {
      const invalid = await sentOrder(original.id, 2, review);
      await assert.rejects(
        consumeOrderSentInventory(database.db, invalid.event),
        /INVENTORY_RETURNABLE_REVIEW_INVALID/,
      );
      assert.deepEqual(await custodyFor(invalid.itemId), []);
    }
    for (const invalidMapping of [
      { ...savedMapping, containerInventoryItemId: foreignContainer.id },
      { ...savedMapping, productId: otherProduct.id },
    ]) {
      const foreign = await sentOrder(original.id, 2, {
        mappings: [invalidMapping],
        defaultDueDays: 12,
      });
      await assert.rejects(
        consumeOrderSentInventory(database.db, foreign.event),
        /INVENTORY_RETURNABLE_REVIEW_SCOPE_INVALID/,
      );
      assert.deepEqual(await custodyFor(foreign.itemId), []);
    }
    const overflow = await sentOrder(original.id, 2, {
      mappings: [{ ...savedMapping, quantityPerUnit: "9999999999999.999" }],
      defaultDueDays: 12,
    });
    await assert.rejects(
      consumeOrderSentInventory(database.db, overflow.event),
      /INVENTORY_RETURNABLE_QUANTITY_INVALID/,
    );
    assert.deepEqual(await custodyFor(overflow.itemId), []);
    assert.deepEqual(await balances(), ["10.000", "10.000"]);

    // Untracked stock in the same sale is restored to the balance, never invented in a lot.
    const mixed = await sentOrder(replacement.id, 7);
    assert.equal((await consumeOrderSentInventory(database.db, mixed.event)).movementCount, 1);
    assert.deepEqual(await balances(), ["10.000", "3.000"]);
    assert.deepEqual(await lotQuantities(), ["0.000", "0.000"]);
    assert.equal((await cancel(mixed.itemId)).movementCount, 1);
    assert.deepEqual(await balances(), ["10.000", "10.000"]);
    assert.deepEqual(await lotQuantities(), ["2.000", "3.000"]);

    // An older single-lot movement remains reversible without the new allocation snapshot.
    const legacyLot = await sentOrder(replacement.id);
    assert.equal((await consumeOrderSentInventory(database.db, legacyLot.event)).movementCount, 1);
    const [legacyAudit] = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, scope.organizationId),
          eq(auditEvents.unitId, scope.unitId),
          eq(auditEvents.entityId, legacyLot.orderId),
          eq(auditEvents.action, "management.inventory.order-consumed"),
        ),
      );
    assert.ok(legacyAudit);
    const legacyMetadata = { ...legacyAudit.metadata };
    delete legacyMetadata.lotAllocations;
    await database.db
      .update(auditEvents)
      .set({ metadata: legacyMetadata })
      .where(eq(auditEvents.id, legacyAudit.id));
    assert.equal((await cancel(legacyLot.itemId)).movementCount, 1);
    assert.deepEqual(await balances(), ["10.000", "10.000"]);
    assert.deepEqual(await lotQuantities(), ["2.000", "3.000"]);
  } finally {
    await database.client.end();
  }
});
