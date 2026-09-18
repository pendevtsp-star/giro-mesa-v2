import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  auditEvents,
  createDatabase,
  identities,
  managementInventoryIssueRoutes,
  managementInventoryItems,
  managementInventoryLotHolds,
  managementInventoryLots,
  managementInventoryMovements,
  managementInventoryReservations,
  managementProductReturnables,
  managementRecipeComponents,
  managementRecipeVersions,
  managementReturnableCustodyMovements,
  managementReturnablePolicies,
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
import {
  consumeOrderSentInventory,
  type OrderSentOutboxEvent,
  reverseCanceledOrderItemInventory,
} from "./inventory.js";
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
    const [inventoryA, inventoryB, containerA] = await database.db
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
        {
          kind: "returnable_container",
          name: "Reusable bottle",
          organizationId: organizationA.id,
          unit: "un",
          unitId: unitA.id,
        },
      ])
      .returning();
    assert.ok(inventoryA && inventoryB && containerA);
    await database.db.insert(managementProductReturnables).values({
      containerInventoryItemId: containerA.id,
      organizationId: organizationA.id,
      productId: product.id,
      quantityPerUnit: "1.000",
      unitId: unitA.id,
    });
    await database.db.insert(managementReturnablePolicies).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      defaultDueDays: 12,
      updatedByIdentityId: identityA.id,
    });
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
        lossBasisPoints: 1_000,
      },
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        recipeVersionId: recipeV2.id,
        inventoryItemId: inventoryA.id,
        locationId: locationA.id,
        quantityMilli: 400,
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
          averageCostCents: 100,
          unitId: unitA.id,
        },
        {
          inventoryItemId: inventoryB.id,
          locationId: locationB.id,
          organizationId: organizationB.id,
          quantity: "20.000",
          averageCostCents: 100,
          unitId: unitB.id,
        },
      ])
      .returning();
    assert.ok(balanceA && balanceB);
    const [reservation] = await database.db
      .insert(managementInventoryReservations)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        inventoryItemId: inventoryA.id,
        locationId: locationA.id,
        quantity: "1.000",
        sourceType: "order",
        sourceId: order.id,
        reason: "Order integration reservation",
        idempotencyKey: randomUUID(),
        actorIdentityId: identityA.id,
      })
      .returning();
    assert.ok(reservation);

    const ticketId = randomUUID();
    const [outbox] = await database.db
      .insert(outboxEvents)
      .values({
        aggregateId: tab.id,
        aggregateType: "tab",
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
    assert.equal(updatedA[0]?.quantity, "9.444");
    assert.equal(untouchedB[0]?.quantity, "20.000");
    const [resolvedReservation] = await database.db
      .select()
      .from(managementInventoryReservations)
      .where(eq(managementInventoryReservations.id, reservation.id));
    assert.equal(resolvedReservation?.status, "consumed");
    assert.equal(resolvedReservation?.resolvedByIdentityId, identityA.id);

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
    assert.equal(movementsAfterSend[0]?.quantityDelta, "-0.556");
    const [costedItem] = await database.db
      .select({ costCents: posOrderItems.costCents })
      .from(posOrderItems)
      .where(eq(posOrderItems.id, orderItem.id))
      .limit(1);
    assert.equal(costedItem?.costCents, 56);
    const custodyAfterSend = await database.db
      .select()
      .from(managementReturnableCustodyMovements)
      .where(eq(managementReturnableCustodyMovements.orderItemId, orderItem.id));
    assert.equal(custodyAfterSend.length, 1);
    assert.equal(custodyAfterSend[0]?.quantityDelta, "2.000");
    const issuedCustody = custodyAfterSend[0];
    assert.ok(issuedCustody);
    assert.equal(
      issuedCustody.dueAt?.toISOString(),
      new Date(orderSentAt.getTime() + 12 * 24 * 60 * 60_000).toISOString(),
    );
    await database.db.insert(managementReturnableCustodyMovements).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      containerInventoryItemId: issuedCustody.containerInventoryItemId,
      locationId: issuedCustody.locationId,
      type: "return",
      quantityDelta: "-0.750",
      orderId: issuedCustody.orderId,
      orderItemId: issuedCustody.orderItemId,
      parentMovementId: issuedCustody.id,
      responsibleIdentityId: issuedCustody.responsibleIdentityId,
      counterpartyName: issuedCustody.counterpartyName,
      dueAt: issuedCustody.dueAt,
      sourceType: "worker_integration_return",
      sourceId: randomUUID(),
      idempotencyKey: `worker-return:${randomUUID()}`,
      actorIdentityId: identityA.id,
    });

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
    assert.equal(balanceAfterReplay[0]?.quantity, "9.444");
    assert.equal(movementsAfterReplay.length, 1);
    assert.equal(tenantBMovements.length, 0);

    await database.db
      .update(posOrderItems)
      .set({ status: "canceled", canceledAt: new Date(), canceledReason: "Integration test" })
      .where(eq(posOrderItems.id, orderItem.id));
    const approvalId = randomUUID();
    await database.db.insert(outboxEvents).values({
      aggregateId: tab.id,
      aggregateType: "tab",
      availableAt: new Date("1970-01-01T00:00:01.000Z"),
      createdAt: new Date("1970-01-01T00:00:01.000Z"),
      payload: {
        approvalId,
        itemId: orderItem.id,
        organizationId: organizationA.id,
        reason: "Integration test",
        tabId: tab.id,
        unitId: unitA.id,
      },
      topic: "pos.item.canceled",
    });
    assert.equal(await worker.runOnce(1), 1);
    const [balanceAfterCancellation, reversalMovements, custodyAfterCancellation] =
      await Promise.all([
        database.db
          .select({ quantity: managementStockBalances.quantity })
          .from(managementStockBalances)
          .where(eq(managementStockBalances.id, balanceA.id))
          .limit(1),
        database.db
          .select()
          .from(managementInventoryMovements)
          .where(
            and(
              eq(managementInventoryMovements.organizationId, organizationA.id),
              eq(managementInventoryMovements.unitId, unitA.id),
              eq(managementInventoryMovements.type, "order_cancellation"),
            ),
          ),
        database.db
          .select()
          .from(managementReturnableCustodyMovements)
          .where(eq(managementReturnableCustodyMovements.orderItemId, orderItem.id)),
      ]);
    assert.equal(balanceAfterCancellation[0]?.quantity, "10.000");
    assert.equal(reversalMovements.length, 1);
    assert.deepEqual(custodyAfterCancellation.map(({ quantityDelta }) => quantityDelta).sort(), [
      "-0.750",
      "-1.250",
      "2.000",
    ]);
    const cancellationCustody = custodyAfterCancellation.find(
      (movement) => movement.sourceType === "pos_order_item_returnable_cancellation",
    );
    assert.equal(cancellationCustody?.parentMovementId, issuedCustody.id);
    assert.equal(cancellationCustody?.responsibleIdentityId, issuedCustody.responsibleIdentityId);
    assert.equal(cancellationCustody?.counterpartyName, issuedCustody.counterpartyName);
    assert.deepEqual(cancellationCustody?.dueAt, issuedCustody.dueAt);

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
    assert.equal(blockedBalance[0]?.quantity, "0.100");

    const alerts = (
      await database.db
        .select({ id: outboxEvents.id, payload: outboxEvents.payload })
        .from(outboxEvents)
        .where(eq(outboxEvents.topic, "management.inventory_attention_required"))
    ).filter((event) => event.payload.orderId === insufficientOrder.id);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0]?.payload.policy, "block_and_retry");
    assert.equal(alerts[0]?.payload.requiredQuantity, "0.800");

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
    const consumptionEvent = {
      id: insufficientOutbox.id,
      aggregate_id: insufficientOutbox.aggregateId,
      aggregate_type: insufficientOutbox.aggregateType,
      payload: insufficientOutbox.payload,
    };
    await database.db.insert(auditEvents).values({
      organizationId: organizationB.id,
      unitId: unitB.id,
      actorIdentityId: identityB.id,
      action: "management.inventory.order-reviewed",
      entityType: "order",
      entityId: insufficientOrder.id,
      metadata: { source: "operator", shortageAcknowledged: true },
    });
    assert.equal(
      (await consumeOrderSentInventory(database.db, consumptionEvent)).retryRequired,
      true,
    );
    await database.db.insert(auditEvents).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      actorIdentityId: identityA.id,
      action: "management.inventory.order-reviewed",
      entityType: "order",
      entityId: insufficientOrder.id,
      metadata: { source: "operator", shortageAcknowledged: true },
    });
    const confirmedConsumption = await consumeOrderSentInventory(database.db, consumptionEvent);
    assert.equal(confirmedConsumption.retryRequired, false);
    assert.equal(confirmedConsumption.movementCount, 1);
    assert.ok(confirmedConsumption.issueCodes.includes("INVENTORY_STOCK_SHORTAGE_CONFIRMED"));
    assert.equal(
      (
        await database.db
          .select()
          .from(managementStockBalances)
          .where(eq(managementStockBalances.id, balanceA.id))
      )[0]?.quantity,
      "-0.700",
    );
    assert.equal((await consumeOrderSentInventory(database.db, consumptionEvent)).movementCount, 0);
    const [canceledShortageItem] = await database.db
      .update(posOrderItems)
      .set({ status: "canceled" })
      .where(eq(posOrderItems.orderId, insufficientOrder.id))
      .returning();
    assert.ok(canceledShortageItem);
    const negativeCancellation = {
      id: randomUUID(),
      aggregate_id: tab.id,
      aggregate_type: "tab",
      payload: {
        approvalId: randomUUID(),
        itemId: canceledShortageItem.id,
        organizationId: organizationA.id,
        unitId: unitA.id,
        tabId: tab.id,
        reason: "Cliente desistiu",
      },
    };
    assert.equal(
      (await reverseCanceledOrderItemInventory(database.db, negativeCancellation)).movementCount,
      1,
    );
    assert.equal(
      (await reverseCanceledOrderItemInventory(database.db, negativeCancellation)).movementCount,
      0,
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(managementStockBalances)
          .where(eq(managementStockBalances.id, balanceA.id))
      )[0]?.quantity,
      "0.100",
    );
    for (const [source, expectedCode] of [
      ["public_menu", "INVENTORY_STOCK_SHORTAGE_PUBLIC_ORDER"],
      ["offline", "INVENTORY_STOCK_SHORTAGE_OFFLINE_ORDER"],
      ["operator", "INVENTORY_STOCK_SHORTAGE_AFTER_REVIEW"],
    ] as const) {
      const [acceptedOrder]: Array<typeof posOrders.$inferSelect> = await database.db
        .insert(posOrders)
        .values({
          organizationId: organizationA.id,
          unitId: unitA.id,
          tabId: tab.id,
          createdByIdentityId: identityA.id,
          status: "sent",
          sentAt: new Date(),
        })
        .returning();
      assert.ok(acceptedOrder);
      await database.db.insert(posOrderItems).values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        orderId: acceptedOrder.id,
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPriceCents: 1000,
        grossCents: 1000,
        netCents: 1000,
        status: "queued",
      });
      await database.db.insert(auditEvents).values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        actorIdentityId: identityA.id,
        action: "management.inventory.order-reviewed",
        entityType: "order",
        entityId: acceptedOrder.id,
        metadata: { source, shortageAcknowledged: false },
      });
      const acceptedEvent: OrderSentOutboxEvent = {
        ...consumptionEvent,
        id: randomUUID(),
        payload: { ...consumptionEvent.payload, orderId: acceptedOrder.id },
      };
      const consumed = await consumeOrderSentInventory(database.db, acceptedEvent);
      assert.equal(consumed.retryRequired, false);
      assert.ok(consumed.issueCodes.includes(expectedCode));
      assert.equal((await consumeOrderSentInventory(database.db, acceptedEvent)).movementCount, 0);
    }
    assert.equal(
      (
        await database.db
          .select()
          .from(managementStockBalances)
          .where(eq(managementStockBalances.id, balanceA.id))
      )[0]?.quantity,
      "-1.100",
    );
    const [beer] = await database.db
      .insert(posProducts)
      .values({ organizationId: organizationA.id, categoryId: category.id, name: "Cerveja" })
      .returning();
    const [secondFreezer] = await database.db
      .insert(managementStockLocations)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        name: "Freezer 2",
        code: "freezer2",
      })
      .returning();
    assert.ok(beer && secondFreezer);
    const [beerStock] = await database.db
      .insert(managementInventoryItems)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: beer.id,
        kind: "resale",
        unit: "un",
        name: beer.name,
      })
      .returning();
    assert.ok(beerStock);
    await database.db.insert(managementStockBalances).values(
      [locationA.id, secondFreezer.id].map((locationId) => ({
        organizationId: organizationA.id,
        unitId: unitA.id,
        inventoryItemId: beerStock.id,
        locationId,
        quantity: "10.000",
      })),
    );
    // The current route changed after dispatch. Consumption must retain the reviewed freezer.
    await database.db.insert(managementInventoryIssueRoutes).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      productId: beer.id,
      locationId: secondFreezer.id,
    });
    for (const held of [false, true]) {
      const [beerOrder]: Array<typeof posOrders.$inferSelect> = await database.db
        .insert(posOrders)
        .values({
          organizationId: organizationA.id,
          unitId: unitA.id,
          tabId: tab.id,
          createdByIdentityId: identityA.id,
          status: "sent",
          sentAt: new Date(),
        })
        .returning();
      assert.ok(beerOrder);
      const [beerOrderItem]: Array<typeof posOrderItems.$inferSelect> = await database.db
        .insert(posOrderItems)
        .values({
          organizationId: organizationA.id,
          unitId: unitA.id,
          orderId: beerOrder.id,
          productId: beer.id,
          productName: beer.name,
          quantity: 2,
          unitPriceCents: 1000,
          grossCents: 2000,
          netCents: 2000,
          status: "queued",
        })
        .returning();
      assert.ok(beerOrderItem);
      await database.db.insert(auditEvents).values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        actorIdentityId: identityA.id,
        action: "management.inventory.order-reviewed",
        entityType: "order",
        entityId: beerOrder.id,
        metadata: {
          source: "operator",
          shortageAcknowledged: held,
          sources: [
            {
              orderItemId: beerOrderItem.id,
              inventoryItemId: beerStock.id,
              locationId: locationA.id,
            },
          ],
        },
      });
      if (held) {
        const [heldLot] = await database.db
          .insert(managementInventoryLots)
          .values({
            organizationId: organizationA.id,
            unitId: unitA.id,
            inventoryItemId: beerStock.id,
            locationId: locationA.id,
            batchCode: "hold",
            quantity: "8.000",
          })
          .returning();
        assert.ok(heldLot);
        await database.db.insert(managementInventoryLotHolds).values({
          organizationId: organizationA.id,
          unitId: unitA.id,
          lotId: heldLot.id,
          reason: "Temperatura",
          idempotencyKey: randomUUID(),
          createdByIdentityId: identityA.id,
        });
      }
      const beerEvent: OrderSentOutboxEvent = {
        ...consumptionEvent,
        id: randomUUID(),
        payload: { ...consumptionEvent.payload, orderId: beerOrder.id },
      };
      const consumedBeer = await consumeOrderSentInventory(database.db, beerEvent);
      assert.equal(consumedBeer.retryRequired, held);
      assert.equal(consumedBeer.movementCount, held ? 0 : 1);
      if (held) assert.ok(consumedBeer.issueCodes.includes("INVENTORY_STOCK_HELD"));
    }
    const freezerBalances = await database.db
      .select()
      .from(managementStockBalances)
      .where(eq(managementStockBalances.inventoryItemId, beerStock.id));
    assert.equal(
      freezerBalances.find((balance) => balance.locationId === locationA.id)?.quantity,
      "8.000",
    );
    assert.equal(
      freezerBalances.find((balance) => balance.locationId === secondFreezer.id)?.quantity,
      "10.000",
    );
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
