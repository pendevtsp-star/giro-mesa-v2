import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  auditEvents,
  identities,
  managementInventoryItems,
  managementInventoryLotHolds,
  managementInventoryLots,
  managementInventoryReservations,
  managementProductReturnables,
  managementRecipeComponents,
  managementRecipeVersions,
  managementReturnablePolicies,
  managementStockBalances,
  managementStockLocations,
  memberships,
  organizations,
  posCatalogCategories,
  posOrderItems,
  posOrders,
  posProductAvailability,
  posProductionStations,
  posProductPrices,
  posProductStations,
  posProducts,
  posTabs,
  roleBindings,
  units,
} from "@giromesa/db";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { reserveOrderInventory } from "./order-inventory.js";
import { PilotPosService } from "./pilot-pos.service.js";
import { sendOrderSchema } from "./pilot-schemas.js";
import { PilotSmartPosService } from "./pilot-smartpos.service.js";

it("validates an explicit shortage acknowledgement without accepting stock data from clients", () => {
  assert.deepEqual(sendOrderSchema.parse(undefined), {});
  assert.deepEqual(sendOrderSchema.parse({ acknowledgeInventoryShortage: true }), {
    acknowledgeInventoryShortage: true,
  });
  assert.equal(sendOrderSchema.safeParse({ acknowledgeInventoryShortage: "true" }).success, false);
  assert.equal(sendOrderSchema.safeParse({ source: "offline" }).success, false);
});

it("keeps recipes optional and confirms shortages atomically without leaking balances to waiters", async (context) => {
  if (!process.env.PILOT_DATABASE_URL) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = process.env.PILOT_DATABASE_URL;
  const database = new DatabaseService();
  try {
    const scope = new ScopeService(database);
    const service = new PilotPosService(database, scope, new PilotSmartPosService(database, scope));
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Inventory confirmation",
        tradeName: "Inventory confirmation",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Bar" })
      .returning();
    const [waiter] = await database.db
      .insert(identities)
      .values({ email: `stock-waiter-${randomUUID()}@example.test`, displayName: "Garçom" })
      .returning();
    assert.ok(unit && waiter);
    const [membership] = await database.db
      .insert(memberships)
      .values({ organizationId: organization.id, identityId: waiter.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db
      .insert(roleBindings)
      .values({ membershipId: membership.id, unitId: unit.id, role: "waiter" });
    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({ organizationId: organization.id, name: "Pratos", slug: "pratos" })
      .returning();
    const [station] = await database.db
      .insert(posProductionStations)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        name: "Cozinha",
        code: "cozinha",
      })
      .returning();
    assert.ok(category && station);
    const [product] = await database.db
      .insert(posProducts)
      .values({ organizationId: organization.id, categoryId: category.id, name: "Prato do dia" })
      .returning();
    assert.ok(product);
    await database.db.insert(posProductPrices).values({
      organizationId: organization.id,
      unitId: unit.id,
      productId: product.id,
      priceCents: 2500,
    });
    await database.db.insert(posProductAvailability).values({
      organizationId: organization.id,
      unitId: unit.id,
      productId: product.id,
      available: true,
    });
    await database.db.insert(posProductStations).values({
      organizationId: organization.id,
      unitId: unit.id,
      productId: product.id,
      stationId: station.id,
    });
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: waiter.id,
        responsibleIdentityId: waiter.id,
        label: "Mesa",
      })
      .returning();
    assert.ok(tab);
    const createOrder = async () => {
      const created = await service.createOrder(
        waiter.id,
        organization.id,
        unit.id,
        tab.id,
        randomUUID(),
        {
          items: [{ productId: product.id, quantity: 1, modifierOptionIds: [] }],
        },
      );
      return (created.order as { id: string }).id;
    };
    const withoutRecipe = await createOrder();
    assert.equal(
      (await service.sendOrder(waiter.id, organization.id, unit.id, withoutRecipe, randomUUID()))
        .status,
      "sent",
    );
    const [uncontrolledReview] = await database.db
      .select({ metadata: auditEvents.metadata })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organization.id),
          eq(auditEvents.unitId, unit.id),
          eq(auditEvents.entityId, withoutRecipe),
          eq(auditEvents.action, "management.inventory.order-reviewed"),
        ),
      );
    assert.deepEqual(uncontrolledReview?.metadata.sources, []);
    assert.deepEqual(uncontrolledReview?.metadata.returnables, { mappings: [], defaultDueDays: 7 });

    const [container, inactiveContainer] = await database.db
      .insert(managementInventoryItems)
      .values(
        ["Embalagem", "Embalagem inativa"].map((name) => ({
          organizationId: organization.id,
          unitId: unit.id,
          name,
          kind: "returnable_container" as const,
          unit: "un",
        })),
      )
      .returning();
    assert.ok(container && inactiveContainer);
    const [returnable] = await database.db
      .insert(managementProductReturnables)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          productId: product.id,
          containerInventoryItemId: container.id,
          quantityPerUnit: "2.000",
          depositCents: 500,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          productId: product.id,
          containerInventoryItemId: inactiveContainer.id,
          active: false,
        },
      ])
      .returning();
    assert.ok(returnable);
    await database.db.insert(managementReturnablePolicies).values({
      organizationId: organization.id,
      unitId: unit.id,
      updatedByIdentityId: waiter.id,
      defaultDueDays: 3,
    });

    const [location] = await database.db
      .insert(managementStockLocations)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        name: "Cozinha",
        code: "cozinha",
      })
      .returning();
    const [ingredient] = await database.db
      .insert(managementInventoryItems)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        name: "Arroz",
        kind: "ingredient",
        unit: "kg",
      })
      .returning();
    assert.ok(location && ingredient);
    const [recipe] = await database.db
      .insert(managementRecipeVersions)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        productId: product.id,
        version: 1,
        createdByIdentityId: waiter.id,
        validFrom: new Date("2020-01-01"),
      })
      .returning();
    assert.ok(recipe);
    await database.db.insert(managementRecipeComponents).values({
      organizationId: organization.id,
      unitId: unit.id,
      recipeVersionId: recipe.id,
      inventoryItemId: ingredient.id,
      locationId: location.id,
      quantityMilli: 250,
    });
    const orderId = await createOrder();
    const key = randomUUID();
    await assert.rejects(
      () => service.sendOrder(waiter.id, organization.id, unit.id, orderId, key),
      (error) => {
        const response = (error as { getResponse(): Record<string, unknown> }).getResponse();
        assert.equal(response.code, "INVENTORY_SHORTAGE_CONFIRMATION_REQUIRED");
        assert.deepEqual(response.products, [{ id: product.id, name: product.name }]);
        assert.equal("availableQuantity" in response, false);
        assert.equal("inventoryItemId" in response, false);
        return true;
      },
    );
    assert.equal(
      (await database.db.select().from(posOrders).where(eq(posOrders.id, orderId)))[0]?.status,
      "draft",
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityId, orderId),
              eq(auditEvents.action, "management.inventory.order-reviewed"),
            ),
          )
      ).length,
      0,
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(managementInventoryReservations)
          .where(eq(managementInventoryReservations.sourceId, orderId))
      ).length,
      0,
    );
    const sent = await service.sendOrder(
      waiter.id,
      organization.id,
      unit.id,
      orderId,
      key,
      undefined,
      { acknowledgeInventoryShortage: true },
    );
    assert.equal(sent.status, "sent");
    assert.deepEqual(await service.sendOrder(waiter.id, organization.id, unit.id, orderId, key), {
      ...sent,
      idempotentReplay: true,
    });
    const [review] = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, orderId),
          eq(auditEvents.action, "management.inventory.order-reviewed"),
        ),
      );
    assert.ok(review);
    assert.equal(review.actorIdentityId, waiter.id);
    assert.equal(review.metadata.shortageAcknowledged, true);
    assert.equal(review.metadata.source, "operator");
    const expectedReturnables = {
      mappings: [
        {
          id: returnable.id,
          productId: product.id,
          containerInventoryItemId: container.id,
          quantityPerUnit: "2.000",
          depositCents: 500,
        },
      ],
      defaultDueDays: 3,
    };
    assert.deepEqual(review.metadata.returnables, expectedReturnables);
    await database.db
      .update(managementProductReturnables)
      .set({
        active: false,
        quantityPerUnit: "9.000",
        depositCents: 900,
      })
      .where(eq(managementProductReturnables.id, returnable.id));
    await database.db
      .update(managementReturnablePolicies)
      .set({ defaultDueDays: 14 })
      .where(
        and(
          eq(managementReturnablePolicies.organizationId, organization.id),
          eq(managementReturnablePolicies.unitId, unit.id),
        ),
      );
    await service.sendOrder(waiter.id, organization.id, unit.id, orderId, key);
    const persistedReviews = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, orderId),
          eq(auditEvents.action, "management.inventory.order-reviewed"),
        ),
      );
    assert.equal(persistedReviews.length, 1);
    assert.deepEqual(persistedReviews[0]?.metadata.returnables, expectedReturnables);
    assert.deepEqual(review.metadata.shortages, [
      {
        inventoryItemId: ingredient.id,
        locationId: location.id,
        productIds: [product.id],
        availableQuantity: "0.000",
        requiredQuantity: "0.250",
      },
    ]);
    const reservations = await database.db
      .select()
      .from(managementInventoryReservations)
      .where(eq(managementInventoryReservations.sourceId, orderId));
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0]?.quantity, "0.250");
    const [balance] = await database.db
      .select()
      .from(managementStockBalances)
      .where(eq(managementStockBalances.inventoryItemId, ingredient.id));
    assert.equal(balance?.quantity, "0.000");

    const offlineOrderId = await createOrder();
    assert.equal(
      (
        await service.sendOrder(waiter.id, organization.id, unit.id, offlineOrderId, randomUUID(), {
          ticketIdForStation: () => randomUUID(),
        })
      ).status,
      "sent",
    );
    const [offlineReview] = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityId, offlineOrderId),
          eq(auditEvents.action, "management.inventory.order-reviewed"),
        ),
      );
    assert.equal(offlineReview?.metadata.source, "offline");
    assert.equal(offlineReview?.metadata.shortageAcknowledged, false);
    assert.deepEqual(offlineReview?.metadata.returnables, { mappings: [], defaultDueDays: 14 });
    await database.db
      .update(managementStockBalances)
      .set({ quantity: "0.750" })
      .where(eq(managementStockBalances.inventoryItemId, ingredient.id));
    const competingOrderIds = [await createOrder(), await createOrder()];
    const competing = await Promise.allSettled(
      competingOrderIds.map(async (competingOrderId) => {
        const items = await database.db
          .select()
          .from(posOrderItems)
          .where(eq(posOrderItems.orderId, competingOrderId));
        return database.db.transaction(async (tx) => {
          await reserveOrderInventory(tx, {
            identityId: waiter.id,
            organizationId: organization.id,
            unitId: unit.id,
            orderId: competingOrderId,
            sentAt: new Date(),
            source: "operator",
            items,
          });
          await tx.execute(sql`select pg_sleep(0.15)`);
        });
      }),
    );
    assert.equal(competing.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = competing.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected");
    assert.equal(
      (rejected.reason as { getResponse(): { code: string } }).getResponse().code,
      "INVENTORY_SHORTAGE_CONFIRMATION_REQUIRED",
    );
    const [lot] = await database.db
      .insert(managementInventoryLots)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        locationId: location.id,
        inventoryItemId: ingredient.id,
        batchCode: "BLOQUEADO",
        quantity: "1.000",
      })
      .returning();
    assert.ok(lot);
    await database.db.insert(managementInventoryLotHolds).values({
      organizationId: organization.id,
      unitId: unit.id,
      lotId: lot.id,
      reason: "Verificar temperatura",
      idempotencyKey: randomUUID(),
      createdByIdentityId: waiter.id,
    });
    await database.db
      .update(managementStockBalances)
      .set({ quantity: "1.000" })
      .where(eq(managementStockBalances.inventoryItemId, ingredient.id));
    const heldOrderId = await createOrder();
    await assert.rejects(
      () =>
        service.sendOrder(
          waiter.id,
          organization.id,
          unit.id,
          heldOrderId,
          randomUUID(),
          undefined,
          { acknowledgeInventoryShortage: true },
        ),
      (error) =>
        (error as { getResponse(): { code: string } }).getResponse().code ===
        "INVENTORY_STOCK_HELD",
    );
    await database.db
      .update(managementInventoryItems)
      .set({ active: false })
      .where(eq(managementInventoryItems.id, ingredient.id));
    await assert.rejects(
      () =>
        service.sendOrder(
          waiter.id,
          organization.id,
          unit.id,
          heldOrderId,
          randomUUID(),
          undefined,
          { acknowledgeInventoryShortage: true },
        ),
      (error) =>
        (error as { getResponse(): { code: string } }).getResponse().code ===
        "INVENTORY_ITEM_INACTIVE",
    );
  } finally {
    await database.onModuleDestroy();
  }
});
