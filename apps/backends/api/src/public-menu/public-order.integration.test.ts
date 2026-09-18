import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import type { PublicOrderInput } from "@giromesa/contracts";
import {
  auditEvents,
  deliveryOrders,
  deliveryZones,
  identities,
  managementInventoryItems,
  managementInventoryReservations,
  managementProductReturnables,
  managementStockBalances,
  managementStockLocations,
  organizations,
  outboxEvents,
  posCatalogCategories,
  posCatalogPromotions,
  posKdsTickets,
  posModifierGroups,
  posModifierOptions,
  posOrders,
  posProductAvailability,
  posProductionStations,
  posProductModifierGroups,
  posProductPrices,
  posProductStations,
  posProducts,
  posTabs,
  publicMenus,
  units,
} from "@giromesa/db";
import { and, count, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { PublicMenuService } from "./public-menu.service.js";
import { PublicOrderService } from "./public-order.service.js";
import { localDate } from "./public-order-rules.js";

function document() {
  return String(randomInt(10_000_000_000_000, 99_999_999_999_999));
}

function hasCode(expected: string) {
  return (error: unknown) => {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (
      typeof response === "object" &&
      response !== null &&
      (response as { code?: string }).code === expected
    );
  };
}

async function scopedCount(
  database: DatabaseService,
  table: typeof posTabs | typeof posOrders,
  organizationId: string,
) {
  const [row] = await database.db
    .select({ value: count() })
    .from(table)
    .where(eq(table.organizationId, organizationId));
  return row?.value ?? 0;
}

it("creates real public pickup/delivery orders with tenant isolation, replay and rollback", async (context) => {
  const databaseUrl = process.env.PUBLIC_ORDER_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PUBLIC_ORDER_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const service = new PublicOrderService(database);
    const suffix = randomUUID();
    const shortSuffix = suffix.slice(0, 8);
    const [organizationA, organizationB] = await database.db
      .insert(organizations)
      .values([
        { legalName: `Public Order A ${suffix}`, tradeName: "Public A", document: document() },
        { legalName: `Public Order B ${suffix}`, tradeName: "Public B", document: document() },
      ])
      .returning();
    assert.ok(organizationA && organizationB);
    const [unitA, unitB] = await database.db
      .insert(units)
      .values([
        {
          organizationId: organizationA.id,
          name: `Public A ${suffix}`,
          timezone: "America/Sao_Paulo",
        },
        {
          organizationId: organizationB.id,
          name: `Public B ${suffix}`,
          timezone: "America/Sao_Paulo",
        },
      ])
      .returning();
    assert.ok(unitA && unitB);
    const [categoryA, categoryB] = await database.db
      .insert(posCatalogCategories)
      .values([
        {
          organizationId: organizationA.id,
          name: "Pratos A",
          slug: `pratos-a-${suffix}`,
        },
        {
          organizationId: organizationB.id,
          name: "Pratos B",
          slug: `pratos-b-${suffix}`,
        },
      ])
      .returning();
    assert.ok(categoryA && categoryB);
    const [stationA, stationB] = await database.db
      .insert(posProductionStations)
      .values([
        {
          organizationId: organizationA.id,
          unitId: unitA.id,
          name: "Cozinha A",
          code: `cozinha-a-${shortSuffix}`,
        },
        {
          organizationId: organizationB.id,
          unitId: unitB.id,
          name: "Cozinha B",
          code: `cozinha-b-${shortSuffix}`,
        },
      ])
      .returning();
    assert.ok(stationA && stationB);
    const [productA, productB] = await database.db
      .insert(posProducts)
      .values([
        { organizationId: organizationA.id, categoryId: categoryA.id, name: "Prato Público A" },
        { organizationId: organizationB.id, categoryId: categoryB.id, name: "Prato Privado B" },
      ])
      .returning();
    assert.ok(productA && productB);
    const [container] = await database.db
      .insert(managementInventoryItems)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        name: "Embalagem retornável",
        kind: "returnable_container",
        unit: "un",
      })
      .returning();
    assert.ok(container);
    const [returnable] = await database.db
      .insert(managementProductReturnables)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: productA.id,
        containerInventoryItemId: container.id,
        quantityPerUnit: "1.000",
        depositCents: 500,
      })
      .returning();
    assert.ok(returnable);
    await database.db.insert(posProducts).values({
      organizationId: organizationA.id,
      categoryId: categoryA.id,
      name: "Produto ainda não publicado",
    });
    const [modifierGroup] = await database.db
      .insert(posModifierGroups)
      .values({
        organizationId: organizationA.id,
        name: "Adicionais",
        minimumSelections: 0,
        maximumSelections: 1,
      })
      .returning();
    assert.ok(modifierGroup);
    const [modifier] = await database.db
      .insert(posModifierOptions)
      .values({
        organizationId: organizationA.id,
        groupId: modifierGroup.id,
        name: "Queijo",
        priceDeltaCents: 300,
      })
      .returning();
    assert.ok(modifier);
    await database.db.insert(posProductModifierGroups).values({
      organizationId: organizationA.id,
      productId: productA.id,
      groupId: modifierGroup.id,
    });
    await database.db.insert(posProductPrices).values([
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: productA.id,
        priceCents: 2_500,
        deliveryPriceCents: 3_000,
      },
      {
        organizationId: organizationB.id,
        unitId: unitB.id,
        productId: productB.id,
        priceCents: 99_900,
      },
    ]);
    await database.db.insert(posProductAvailability).values([
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: productA.id,
        available: true,
        dailyStock: 6,
        soldToday: 6,
        autoDeductStock: true,
        stockDate: "2000-01-01",
      },
      {
        organizationId: organizationB.id,
        unitId: unitB.id,
        productId: productB.id,
        available: true,
      },
    ]);
    await database.db.insert(posProductStations).values([
      {
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: productA.id,
        stationId: stationA.id,
      },
      {
        organizationId: organizationB.id,
        unitId: unitB.id,
        productId: productB.id,
        stationId: stationB.id,
      },
    ]);
    const slug = `pedido-publico-${suffix}`;
    await database.db.insert(publicMenus).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      slug,
      items: [
        {
          id: productA.id,
          name: productA.name,
          category: "Pratos",
          description: "",
          visual: "🍽️",
          available: true,
          priceCents: 1,
          costCents: 999,
        },
      ],
      active: true,
      publishedAt: new Date(),
    });
    await database.db.insert(deliveryZones).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      name: "Centro",
      feeCents: 700,
      minimumOrderCents: 4_000,
      estimatedDeliveryMinutes: 30,
      geometry: { type: "Polygon", coordinates: [] },
      active: true,
    });
    await database.db.insert(posCatalogPromotions).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      name: "Retirada 20%",
      discountType: "percentage",
      discountValue: 2_000,
      productIds: [productA.id],
      channels: ["pickup"],
      active: true,
    });

    const [stockLocation] = await database.db
      .insert(managementStockLocations)
      .values({ organizationId: organizationA.id, unitId: unitA.id, name: "Bar", code: "bar" })
      .returning();
    const [stockItem] = await database.db
      .insert(managementInventoryItems)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        productId: productA.id,
        kind: "resale",
        name: productA.name,
        unit: "un",
      })
      .returning();
    assert.ok(stockLocation && stockItem);
    await database.db.insert(managementStockBalances).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      inventoryItemId: stockItem.id,
      locationId: stockLocation.id,
      quantity: "0.000",
    });
    const options = await service.options(slug);
    assert.deepEqual(options.fulfillment, { pickup: true, delivery: true });
    assert.deepEqual(options.deliveryZones, [
      {
        name: "Centro",
        feeCents: 700,
        minimumOrderCents: 4_000,
        estimatedDeliveryMinutes: 30,
      },
    ]);
    const [publicZone] = options.deliveryZones;
    assert.ok(publicZone);
    assert.equal("id" in publicZone, false);

    const pickupInput: PublicOrderInput = {
      expectedTotalCents: 4_000,
      fulfillment: "pickup",
      customer: { name: "Ana Cliente", phone: "+5511999999999" },
      items: [{ productId: productA.id, quantity: 2, modifierOptionIds: [] }],
      paymentMethod: "pay_on_fulfillment",
      privacyAccepted: true,
      policyVersion: "2026-08-public-orders",
    };
    const pickupKey = `pickup-${suffix}`;
    const menuService = new PublicMenuService(database);
    const liveMenu = await menuService.menu(slug);
    assert.equal(liveMenu.items.length, 1);
    assert.equal(liveMenu.items[0]?.priceCents, 2_500);
    assert.equal(liveMenu.items[0]?.deliveryPriceCents, 3_000);
    assert.equal(liveMenu.items[0]?.available, true, "yesterday's daily sales do not pause today");
    assert.equal("costCents" in (liveMenu.items[0] ?? {}), false);
    assert.equal("dailyStock" in (liveMenu.items[0] ?? {}), false);
    assert.deepEqual(liveMenu.items[0]?.modifierGroups, [
      {
        id: modifierGroup.id,
        name: "Adicionais",
        required: false,
        maxSelections: 1,
        options: [{ id: modifier.id, name: "Queijo", priceCents: 300 }],
      },
    ]);
    await database.db
      .update(posProductAvailability)
      .set({ available: false })
      .where(eq(posProductAvailability.productId, productA.id));
    assert.equal((await menuService.menu(slug)).items[0]?.available, false);
    await database.db
      .update(posProductAvailability)
      .set({ operationalResetAt: new Date(Date.now() - 60_000) })
      .where(eq(posProductAvailability.productId, productA.id));
    assert.equal(
      (await menuService.menu(slug)).items[0]?.available,
      true,
      "an expired operational pause is lifted consistently in menu and checkout",
    );
    for (const expectedTotalCents of [undefined, 5_000]) {
      await assert.rejects(
        service.place(slug, `stale-${suffix}-${expectedTotalCents}`, {
          ...pickupInput,
          expectedTotalCents,
        }),
        (error: unknown) => {
          assert.equal(hasCode("PUBLIC_ORDER_PRICE_CHANGED")(error), true);
          assert.equal(
            (error as { getResponse(): { totalCents: number } }).getResponse().totalCents,
            4_000,
          );
          return true;
        },
      );
    }
    assert.equal(await scopedCount(database, posTabs, organizationA.id), 0);
    assert.equal(await scopedCount(database, posOrders, organizationA.id), 0);
    await assert.rejects(
      service.place(slug, `modifier-stale-${suffix}`, {
        ...pickupInput,
        items: [{ productId: productA.id, quantity: 2, modifierOptionIds: [modifier.id] }],
      }),
      (error: unknown) => {
        assert.equal(hasCode("PUBLIC_ORDER_PRICE_CHANGED")(error), true);
        assert.equal(
          (error as { getResponse(): { totalCents: number } }).getResponse().totalCents,
          4_600,
        );
        return true;
      },
    );
    const pickup = await service.place(slug, pickupKey, pickupInput);
    assert.match(pickup.protocol, /^GM-\d{8}-[A-F0-9]{10}$/);
    assert.deepEqual(
      {
        status: pickup.status,
        fulfillment: pickup.fulfillment,
        payment: pickup.payment,
        subtotalCents: pickup.subtotalCents,
        deliveryFeeCents: pickup.deliveryFeeCents,
        totalCents: pickup.totalCents,
      },
      {
        status: "placed",
        fulfillment: "pickup",
        payment: { method: "pay_on_fulfillment", status: "awaiting_payment" },
        subtotalCents: 4_000,
        deliveryFeeCents: 0,
        totalCents: 4_000,
      },
    );
    assert.equal("orderId" in pickup, false);
    assert.equal("tabId" in pickup, false);

    await database.db
      .update(posProductPrices)
      .set({ priceCents: 4_000 })
      .where(eq(posProductPrices.productId, productA.id));
    const replay = await service.place(slug, pickupKey, pickupInput);
    assert.equal(replay.protocol, pickup.protocol);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.totalCents, 4_000, "an accepted attempt replays its original total");
    await database.db
      .update(posProductPrices)
      .set({ priceCents: 2_500 })
      .where(eq(posProductPrices.productId, productA.id));
    const stock = async () =>
      database.db
        .select({
          soldToday: posProductAvailability.soldToday,
          stockDate: posProductAvailability.stockDate,
        })
        .from(posProductAvailability)
        .where(
          and(
            eq(posProductAvailability.unitId, unitA.id),
            eq(posProductAvailability.productId, productA.id),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);
    assert.deepEqual(await stock(), {
      soldToday: 2,
      stockDate: localDate(new Date(), unitA.timezone),
    });
    await assert.rejects(
      () =>
        service.place(slug, pickupKey, {
          ...pickupInput,
          items: [{ productId: productA.id, quantity: 3, modifierOptionIds: [] }],
        }),
      hasCode("IDEMPOTENCY_KEY_REUSED"),
    );

    const deliveryPlacedAt = Date.now();
    await database.db
      .update(deliveryZones)
      .set({ feeCents: 900 })
      .where(eq(deliveryZones.unitId, unitA.id));
    const deliveryInput: PublicOrderInput = {
      ...pickupInput,
      expectedTotalCents: 6_900,
      fulfillment: "delivery",
      deliveryZone: "Centro",
      address: {
        street: "Rua das Flores",
        number: "10",
        complement: "Apto 2",
        neighborhood: "Centro",
        city: "São Paulo",
        state: "SP",
        postalCode: "01001-000",
      },
    };
    await assert.rejects(
      service.place(slug, `delivery-stale-${suffix}`, {
        ...deliveryInput,
        expectedTotalCents: 6_700,
      }),
      hasCode("PUBLIC_ORDER_PRICE_CHANGED"),
    );
    assert.equal(
      (await stock())?.soldToday,
      2,
      "a changed fee or total rolls daily reservation back",
    );
    const delivery = await service.place(slug, `delivery-${suffix}`, deliveryInput);
    assert.equal(delivery.deliveryFeeCents, 900);
    assert.equal(delivery.subtotalCents, 6_000);
    assert.equal(delivery.totalCents, 6_900);
    assert.equal((await stock())?.soldToday, 4);
    await assert.rejects(
      () =>
        service.place(slug, `stock-${suffix}`, {
          ...pickupInput,
          items: [{ productId: productA.id, quantity: 3, modifierOptionIds: [] }],
        }),
      hasCode("PUBLIC_PRODUCT_STOCK_EXHAUSTED"),
    );
    assert.equal((await stock())?.soldToday, 4);
    const persisted = await database.db
      .select()
      .from(deliveryOrders)
      .where(
        and(
          eq(deliveryOrders.organizationId, organizationA.id),
          eq(deliveryOrders.publicProtocol, delivery.protocol),
        ),
      );
    assert.equal(persisted.length, 1);
    const [persistedOrder] = persisted;
    assert.ok(persistedOrder);
    assert.equal(persistedOrder.customerName, "Ana Cliente");
    assert.equal(persistedOrder.paymentStatus, "awaiting_payment");
    assert.ok(persistedOrder.promisedAt);
    assert.ok(persistedOrder.promisedAt.getTime() >= deliveryPlacedAt + 29 * 60_000);
    assert.ok(persistedOrder.promisedAt.getTime() <= Date.now() + 31 * 60_000);
    assert.deepEqual(persistedOrder.address, {
      street: "Rua das Flores",
      number: "10",
      complement: "Apto 2",
      neighborhood: "Centro",
      city: "São Paulo",
      state: "SP",
      postalCode: "01001000",
    });
    const [deliveryPosOrder] = await database.db
      .select({ id: posOrders.id, status: posOrders.status })
      .from(posOrders)
      .where(eq(posOrders.tabId, persistedOrder.orderRef))
      .limit(1);
    assert.ok(deliveryPosOrder);
    assert.equal(deliveryPosOrder.status, "sent");
    const [inventoryReview] = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, organizationA.id),
          eq(auditEvents.unitId, unitA.id),
          eq(auditEvents.entityId, deliveryPosOrder.id),
          eq(auditEvents.action, "management.inventory.order-reviewed"),
        ),
      );
    assert.equal(inventoryReview?.metadata.source, "public_menu");
    assert.equal(inventoryReview?.metadata.shortageAcknowledged, false);
    assert.deepEqual(inventoryReview?.metadata.returnables, {
      mappings: [
        {
          id: returnable.id,
          productId: productA.id,
          containerInventoryItemId: container.id,
          quantityPerUnit: "1.000",
          depositCents: 500,
        },
      ],
      defaultDueDays: 7,
    });
    assert.deepEqual(inventoryReview?.metadata.shortages, [
      {
        inventoryItemId: stockItem.id,
        locationId: stockLocation.id,
        productIds: [productA.id],
        availableQuantity: "0.000",
        requiredQuantity: "2.000",
      },
    ]);
    const publicReservations = await database.db
      .select()
      .from(managementInventoryReservations)
      .where(eq(managementInventoryReservations.sourceId, deliveryPosOrder.id));
    assert.equal(publicReservations.length, 1);
    assert.equal(publicReservations[0]?.quantity, "2.000");
    assert.equal("inventoryReview" in delivery, false);
    assert.equal("returnables" in delivery, false);
    assert.equal("stock" in delivery, false);
    const ticketRows = await database.db
      .select({ id: posKdsTickets.id })
      .from(posKdsTickets)
      .where(
        and(
          eq(posKdsTickets.organizationId, organizationA.id),
          eq(posKdsTickets.orderId, deliveryPosOrder.id),
        ),
      );
    assert.equal(ticketRows.length, 1);
    const [stockTrigger] = await database.db
      .select({ payload: outboxEvents.payload })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.topic, "pos.order.sent"),
          eq(outboxEvents.aggregateId, persistedOrder.orderRef),
        ),
      )
      .limit(1);
    assert.ok(stockTrigger);
    assert.equal(stockTrigger.payload.orderId, deliveryPosOrder.id);
    assert.deepEqual(
      [...(stockTrigger.payload.ticketIds as string[])].sort(),
      ticketRows.map((ticket) => ticket.id).sort(),
    );

    const tabsBeforeCrossTenant = await scopedCount(database, posTabs, organizationA.id);
    await assert.rejects(
      () =>
        service.place(slug, `cross-${suffix}`, {
          ...pickupInput,
          items: [{ productId: productB.id, quantity: 1, modifierOptionIds: [] }],
        }),
      hasCode("PUBLIC_PRODUCT_NOT_IN_MENU"),
    );
    assert.equal(await scopedCount(database, posTabs, organizationA.id), tabsBeforeCrossTenant);

    const [serviceIdentity] = await database.db
      .select({ id: identities.id, kind: identities.kind })
      .from(identities)
      .where(eq(identities.email, `public-orders+${organizationA.id}@system.giromesa.invalid`))
      .limit(1);
    assert.ok(serviceIdentity);
    assert.equal(serviceIdentity.kind, "service");
    const [existingTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organizationA.id,
        unitId: unitA.id,
        openedByIdentityId: serviceIdentity.id,
        label: "Rollback fixture",
      })
      .returning();
    assert.ok(existingTab);
    const rollbackKey = `rollback-${suffix}`;
    await database.db.insert(deliveryOrders).values({
      organizationId: organizationA.id,
      unitId: unitA.id,
      orderRef: existingTab.id,
      fulfillment: "pickup",
      status: "placed",
      subtotalCents: 0,
      deliveryFeeCents: 0,
      totalCents: 0,
      idempotencyKey: rollbackKey,
      requestFingerprint: "rollback-fixture",
    });
    const tabsBeforeRollback = await scopedCount(database, posTabs, organizationA.id);
    const ordersBeforeRollback = await scopedCount(database, posOrders, organizationA.id);
    await assert.rejects(() => service.place(slug, rollbackKey, pickupInput));
    assert.equal(await scopedCount(database, posTabs, organizationA.id), tabsBeforeRollback);
    assert.equal(await scopedCount(database, posOrders, organizationA.id), ordersBeforeRollback);
    assert.equal((await stock())?.soldToday, 4);
  } finally {
    await database.onModuleDestroy();
  }
});
