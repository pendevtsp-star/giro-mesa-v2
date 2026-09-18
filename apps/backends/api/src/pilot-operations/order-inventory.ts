import {
  auditEvents,
  type Database,
  managementInventoryIssueRoutes,
  managementInventoryItems,
  managementInventoryReservations,
  managementProductReturnables,
  managementRecipeComponents,
  managementRecipeVersions,
  managementReturnablePolicies,
  managementStockBalances,
  managementStockLocations,
} from "@giromesa/db";
import { ConflictException } from "@nestjs/common";
import { and, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function reserveOrderInventory(
  tx: Transaction,
  input: {
    identityId: string;
    organizationId: string;
    unitId: string;
    orderId: string;
    sentAt: Date;
    acknowledgeInventoryShortage?: boolean;
    source: "operator" | "offline" | "public_menu";
    items: Array<{
      id: string;
      productId: string;
      productName: string;
      quantity: number;
      stationId: string | null;
    }>;
  },
) {
  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const [components, inventoryItems, issueRoutes, returnableMappings, [returnablePolicy]] =
    await Promise.all([
      tx
        .select({
          id: managementRecipeComponents.id,
          inventoryItemId: managementRecipeComponents.inventoryItemId,
          locationId: managementRecipeComponents.locationId,
          lossBasisPoints: managementRecipeComponents.lossBasisPoints,
          productId: managementRecipeVersions.productId,
          quantityMilli: managementRecipeComponents.quantityMilli,
        })
        .from(managementRecipeVersions)
        .innerJoin(
          managementRecipeComponents,
          and(
            eq(managementRecipeComponents.organizationId, managementRecipeVersions.organizationId),
            eq(managementRecipeComponents.unitId, managementRecipeVersions.unitId),
            eq(managementRecipeComponents.recipeVersionId, managementRecipeVersions.id),
          ),
        )
        .where(
          and(
            eq(managementRecipeVersions.organizationId, input.organizationId),
            eq(managementRecipeVersions.unitId, input.unitId),
            inArray(managementRecipeVersions.productId, productIds),
            lte(managementRecipeVersions.validFrom, input.sentAt),
            or(
              isNull(managementRecipeVersions.validUntil),
              gt(managementRecipeVersions.validUntil, input.sentAt),
            ),
          ),
        ),
      tx
        .select({
          allowNegative: managementInventoryItems.allowNegative,
          active: managementInventoryItems.active,
          id: managementInventoryItems.id,
          kind: managementInventoryItems.kind,
          productId: managementInventoryItems.productId,
        })
        .from(managementInventoryItems)
        .where(
          and(
            eq(managementInventoryItems.organizationId, input.organizationId),
            eq(managementInventoryItems.unitId, input.unitId),
          ),
        ),
      tx
        .select({
          locationId: managementInventoryIssueRoutes.locationId,
          productId: managementInventoryIssueRoutes.productId,
          stationId: managementInventoryIssueRoutes.stationId,
        })
        .from(managementInventoryIssueRoutes)
        .where(
          and(
            eq(managementInventoryIssueRoutes.organizationId, input.organizationId),
            eq(managementInventoryIssueRoutes.unitId, input.unitId),
            eq(managementInventoryIssueRoutes.active, true),
            inArray(managementInventoryIssueRoutes.productId, productIds),
          ),
        ),
      tx
        .select({
          id: managementProductReturnables.id,
          productId: managementProductReturnables.productId,
          containerInventoryItemId: managementProductReturnables.containerInventoryItemId,
          quantityPerUnit: managementProductReturnables.quantityPerUnit,
          depositCents: managementProductReturnables.depositCents,
        })
        .from(managementProductReturnables)
        .where(
          and(
            eq(managementProductReturnables.organizationId, input.organizationId),
            eq(managementProductReturnables.unitId, input.unitId),
            eq(managementProductReturnables.active, true),
            inArray(managementProductReturnables.productId, productIds),
          ),
        ),
      tx
        .select({ defaultDueDays: managementReturnablePolicies.defaultDueDays })
        .from(managementReturnablePolicies)
        .where(
          and(
            eq(managementReturnablePolicies.organizationId, input.organizationId),
            eq(managementReturnablePolicies.unitId, input.unitId),
          ),
        )
        .limit(1),
    ]);
  const recipesByProduct = new Map<string, typeof components>();
  for (const component of components)
    recipesByProduct.set(component.productId, [
      ...(recipesByProduct.get(component.productId) ?? []),
      component,
    ]);
  const resaleByProduct = new Map<string, typeof inventoryItems>();
  const inventoryById = new Map(inventoryItems.map((item) => [item.id, item]));
  for (const item of inventoryItems) {
    if (!item.active || !item.productId || item.kind !== "resale") continue;
    resaleByProduct.set(item.productId, [...(resaleByProduct.get(item.productId) ?? []), item]);
  }
  const reservations = new Map<
    string,
    {
      inventoryItemId: string;
      locationId: string;
      quantityMilli: bigint;
      allowNegative: boolean;
      productIds: string[];
    }
  >();
  const sources: Array<{ orderItemId: string; inventoryItemId: string; locationId: string }> = [];
  const addReservation = (
    orderItem: (typeof input.items)[number],
    inventoryItemId: string,
    locationId: string,
    quantityMilli: bigint,
    allowNegative: boolean,
  ) => {
    const key = `${inventoryItemId}:${locationId}`;
    const current = reservations.get(key);
    reservations.set(key, {
      inventoryItemId,
      locationId,
      quantityMilli: (current?.quantityMilli ?? 0n) + quantityMilli,
      allowNegative,
      productIds: [...new Set([...(current?.productIds ?? []), orderItem.productId])],
    });
    sources.push({ orderItemId: orderItem.id, inventoryItemId, locationId });
  };
  for (const orderItem of input.items) {
    const recipe = recipesByProduct.get(orderItem.productId) ?? [];
    if (recipe.length) {
      for (const component of recipe) {
        const inventoryItem = inventoryById.get(component.inventoryItemId);
        if (!inventoryItem?.active)
          throw new ConflictException({ code: "INVENTORY_ITEM_INACTIVE" });
        const yieldBasisPoints = BigInt(10_000 - component.lossBasisPoints);
        const netMilli = BigInt(component.quantityMilli) * BigInt(orderItem.quantity);
        addReservation(
          orderItem,
          component.inventoryItemId,
          component.locationId,
          (netMilli * 10_000n + yieldBasisPoints - 1n) / yieldBasisPoints,
          inventoryItem.allowNegative,
        );
      }
      continue;
    }
    const directItems = resaleByProduct.get(orderItem.productId) ?? [];
    if (directItems.length === 0) {
      if (
        inventoryItems.some(
          (item) =>
            item.kind === "resale" && item.productId === orderItem.productId && !item.active,
        )
      )
        throw new ConflictException({ code: "INVENTORY_ITEM_INACTIVE" });
      continue;
    }
    if (directItems.length > 1)
      throw new ConflictException({
        code: "INVENTORY_MAPPING_AMBIGUOUS",
        productId: orderItem.productId,
      });
    const inventoryItem = directItems[0];
    if (!inventoryItem) continue;
    const route =
      issueRoutes.find(
        (candidate) =>
          candidate.productId === orderItem.productId &&
          candidate.stationId === orderItem.stationId,
      ) ??
      issueRoutes.find(
        (candidate) => candidate.productId === orderItem.productId && candidate.stationId === null,
      );
    let locationId = route?.locationId;
    if (!locationId) {
      const balances = await tx
        .select({ locationId: managementStockBalances.locationId })
        .from(managementStockBalances)
        .innerJoin(
          managementStockLocations,
          and(
            eq(managementStockLocations.organizationId, managementStockBalances.organizationId),
            eq(managementStockLocations.unitId, managementStockBalances.unitId),
            eq(managementStockLocations.id, managementStockBalances.locationId),
            eq(managementStockLocations.active, true),
          ),
        )
        .where(
          and(
            eq(managementStockBalances.organizationId, input.organizationId),
            eq(managementStockBalances.unitId, input.unitId),
            eq(managementStockBalances.inventoryItemId, inventoryItem.id),
          ),
        );
      if (balances.length !== 1)
        throw new ConflictException({
          code: "INVENTORY_ISSUE_ROUTE_MISSING",
          productId: orderItem.productId,
        });
      locationId = balances[0]?.locationId;
    }
    if (locationId)
      addReservation(
        orderItem,
        inventoryItem.id,
        locationId,
        BigInt(orderItem.quantity) * 1_000n,
        inventoryItem.allowNegative,
      );
  }
  const quantity = (milli: bigint) => {
    const absolute = milli < 0n ? -milli : milli;
    return `${milli < 0n ? "-" : ""}${absolute / 1_000n}.${String(absolute % 1_000n).padStart(3, "0")}`;
  };
  const quantityMilli = (value: string) => {
    const [whole = "0", fraction = ""] = value.replace(/^-/, "").split(".");
    const absolute = BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0").slice(0, 3));
    return value.startsWith("-") ? -absolute : absolute;
  };
  const shortages: Array<{
    inventoryItemId: string;
    locationId: string;
    productIds: string[];
    availableQuantity: string;
    requiredQuantity: string;
  }> = [];
  for (const reservation of [...reservations.values()].sort((left, right) =>
    `${left.inventoryItemId}:${left.locationId}`.localeCompare(
      `${right.inventoryItemId}:${right.locationId}`,
    ),
  )) {
    // A configured stock source with no receipts has a real zero balance, never invented stock.
    await tx
      .insert(managementStockBalances)
      .values({
        organizationId: input.organizationId,
        unitId: input.unitId,
        inventoryItemId: reservation.inventoryItemId,
        locationId: reservation.locationId,
        quantity: "0.000",
      })
      .onConflictDoNothing();
    // Read reservations in a fresh statement after the lock, including concurrent send commits.
    await tx.execute(sql`
      select id from management_stock_balances
      where organization_id = ${input.organizationId}::uuid
        and unit_id = ${input.unitId}::uuid
        and location_id = ${reservation.locationId}::uuid
        and inventory_item_id = ${reservation.inventoryItemId}::uuid
      for update
    `);
    const rows = await tx.execute<{
      quantity: string;
      reservedQuantity: string;
      blockedQuantity: string;
    }>(sql`
      select balance.quantity,
             coalesce((select sum(r.quantity) from management_inventory_reservations r
               where r.organization_id = balance.organization_id and r.unit_id = balance.unit_id
                 and r.location_id = balance.location_id and r.inventory_item_id = balance.inventory_item_id
                 and r.status = 'active' and (r.expires_at is null or r.expires_at > now())), 0) as "reservedQuantity",
             coalesce((select sum(lot.quantity) from management_inventory_lots lot
               inner join management_inventory_lot_holds hold on hold.organization_id = lot.organization_id
                 and hold.unit_id = lot.unit_id and hold.lot_id = lot.id and hold.status = 'active'
               where lot.organization_id = balance.organization_id and lot.unit_id = balance.unit_id
                 and lot.location_id = balance.location_id and lot.inventory_item_id = balance.inventory_item_id
                 and lot.active = true), 0) as "blockedQuantity"
      from management_stock_balances balance
      inner join management_stock_locations location on location.organization_id = balance.organization_id
        and location.unit_id = balance.unit_id and location.id = balance.location_id and location.active = true
      where balance.organization_id = ${input.organizationId}::uuid
        and balance.unit_id = ${input.unitId}::uuid
        and balance.location_id = ${reservation.locationId}::uuid
        and balance.inventory_item_id = ${reservation.inventoryItemId}::uuid
    `);
    const balance = rows[0];
    if (!balance)
      throw new ConflictException({
        code: "INVENTORY_STOCK_BALANCE_MISSING",
        message: "Confira o local de estoque configurado para este produto.",
      });
    const availableMilli =
      quantityMilli(balance.quantity) -
      quantityMilli(balance.reservedQuantity) -
      quantityMilli(balance.blockedQuantity);
    if (availableMilli < reservation.quantityMilli) {
      if (quantityMilli(balance.blockedQuantity) > 0n)
        throw new ConflictException({
          code: "INVENTORY_STOCK_HELD",
          message: "Há estoque bloqueado para segurança. Confira os lotes antes de enviar.",
        });
      if (!reservation.allowNegative)
        shortages.push({
          inventoryItemId: reservation.inventoryItemId,
          locationId: reservation.locationId,
          productIds: reservation.productIds,
          availableQuantity: quantity(availableMilli > 0n ? availableMilli : 0n),
          requiredQuantity: quantity(reservation.quantityMilli),
        });
    }
    await tx
      .insert(managementInventoryReservations)
      .values({
        organizationId: input.organizationId,
        unitId: input.unitId,
        inventoryItemId: reservation.inventoryItemId,
        locationId: reservation.locationId,
        quantity: quantity(reservation.quantityMilli),
        sourceType: "order",
        sourceId: input.orderId,
        reason: `Pedido ${input.orderId}`,
        expiresAt: new Date(input.sentAt.getTime() + 24 * 60 * 60_000),
        idempotencyKey: `order:${input.orderId}:${reservation.inventoryItemId}:${reservation.locationId}`,
        actorIdentityId: input.identityId,
      })
      .onConflictDoNothing();
  }
  if (shortages.length && !input.acknowledgeInventoryShortage && input.source === "operator") {
    const productIds = new Set(shortages.flatMap((shortage) => shortage.productIds));
    throw new ConflictException({
      code: "INVENTORY_SHORTAGE_CONFIRMATION_REQUIRED",
      message:
        "O estoque registrado pode não ser suficiente. Confirme a disponibilidade antes de lançar mesmo assim.",
      products: [
        ...new Map(
          input.items
            .filter((item) => productIds.has(item.productId))
            .map((item) => [item.productId, { id: item.productId, name: item.productName }]),
        ).values(),
      ],
    });
  }
  // An empty snapshot also freezes the absence of inventory control at dispatch.
  await tx.insert(auditEvents).values({
    organizationId: input.organizationId,
    unitId: input.unitId,
    actorIdentityId: input.identityId,
    action: "management.inventory.order-reviewed",
    entityType: "order",
    entityId: input.orderId,
    metadata: {
      source: input.source,
      shortageAcknowledged:
        input.source === "operator" &&
        shortages.length > 0 &&
        input.acknowledgeInventoryShortage === true,
      shortages,
      sources,
      // Persist empty mappings too: later configuration only applies to later orders.
      returnables: {
        mappings: returnableMappings,
        defaultDueDays: returnablePolicy?.defaultDueDays ?? 7,
      },
    },
  });
}
