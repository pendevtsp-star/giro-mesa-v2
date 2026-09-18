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
  managementStockBalances,
  memberships,
  organizations,
  outboxEvents,
  posCatalogCategories,
  posProducts,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { inventoryItemSchema } from "../management/management.schemas.js";
import { ManagementService } from "../management/management.service.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotCatalogService } from "./pilot-catalog.service.js";
import { productSchema, productUnitConfigSchema } from "./pilot-schemas.js";

const hasCode = (code: string) => (error: unknown) =>
  (error as { getResponse?: () => { code?: string } }).getResponse?.().code === code;

it("links existing resale stock atomically, once, with tenant and unit isolation", async (context) => {
  if (!process.env.MANAGEMENT_DATABASE_URL) {
    context.skip("MANAGEMENT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = process.env.MANAGEMENT_DATABASE_URL;
  const database = new DatabaseService();
  try {
    const scope = new ScopeService(database);
    const management = new ManagementService(database, scope);
    const catalog = new PilotCatalogService(database, scope);
    const [organization, otherOrganization] = await database.db
      .insert(organizations)
      .values(
        ["Resale", "Other Resale"].map((name) => ({
          legalName: name,
          tradeName: name,
          document: Array.from({ length: 14 }, () => randomInt(0, 10)).join(""),
        })),
      )
      .returning();
    assert.ok(organization && otherOrganization);
    const [unit, siblingUnit, otherUnit] = await database.db
      .insert(units)
      .values([
        { organizationId: organization.id, name: "Main" },
        { organizationId: organization.id, name: "Sibling" },
        { organizationId: otherOrganization.id, name: "Other" },
      ])
      .returning();
    const [actor] = await database.db
      .insert(identities)
      .values({ email: `resale-${randomUUID()}@example.test`, displayName: "Owner" })
      .returning();
    assert.ok(unit && siblingUnit && otherUnit && actor);
    const [membership] = await database.db
      .insert(memberships)
      .values({ organizationId: organization.id, identityId: actor.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });
    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({ organizationId: organization.id, name: "Bebidas", slug: "bebidas" })
      .returning();
    assert.ok(category);
    const station = await catalog.createStation(actor.id, organization.id, unit.id, randomUUID(), {
      name: "Bar",
      code: "bar",
    });
    const location = await management.createStockLocation(
      actor.id,
      organization.id,
      unit.id,
      randomUUID(),
      { name: "Bar", code: "bar" },
    );
    const item = await management.createInventoryItem(
      actor.id,
      organization.id,
      unit.id,
      randomUUID(),
      inventoryItemSchema.parse({
        name: "Cerveja 600ml",
        kind: "resale",
        unit: "un",
        purchaseUnit: "cx",
        purchaseToStockFactor: "24",
      }),
    );
    assert.equal(item.productId, null);
    await management.updateInventoryItem(actor.id, organization.id, unit.id, item.id, {
      sku: "beer-600",
    });
    await database.db.insert(managementStockBalances).values({
      organizationId: organization.id,
      unitId: unit.id,
      inventoryItemId: item.id,
      locationId: location.id,
      quantity: "24",
      averageCostCents: 600,
    });
    const input = productSchema.parse({
      categoryId: category.id,
      name: item.name,
      productType: "resale",
      inventoryItemId: item.id,
      stationIds: [station.id],
      priceCents: 1500,
    });
    const key = randomUUID();
    const [created, replay] = await Promise.all([
      catalog.createProduct(actor.id, organization.id, unit.id, key, input),
      catalog.createProduct(actor.id, organization.id, unit.id, key, input),
    ]);
    assert.equal(created.id, replay.id);
    assert.deepEqual([created.idempotentReplay, replay.idempotentReplay].sort(), [false, true]);
    const [linked] = await database.db
      .select()
      .from(managementInventoryItems)
      .where(eq(managementInventoryItems.id, item.id));
    assert.equal(linked?.productId, created.id);
    const balances = await database.db
      .select()
      .from(managementStockBalances)
      .where(eq(managementStockBalances.inventoryItemId, item.id));
    assert.equal(balances.length, 1);
    assert.equal(balances[0]?.quantity, "24.000");
    const audits = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.entityId, created.id));
    const events = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.aggregateId, created.id));
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.metadata?.inventoryItemId, item.id);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.payload?.inventoryItemId, item.id);
    const dailyConfig = { priceCents: 1500, available: true, stationIds: [station.id] };
    await catalog.updateProductUnitConfig(
      actor.id,
      organization.id,
      unit.id,
      created.id,
      productUnitConfigSchema.parse({ ...dailyConfig, dailyStock: 12, autoDeductStock: true }),
    );
    const quickEdit = productUnitConfigSchema.parse({
      ...dailyConfig,
      priceCents: 1600,
      available: false,
    });
    assert.equal(quickEdit.autoDeductStock, undefined);
    await catalog.updateProductUnitConfig(
      actor.id,
      organization.id,
      unit.id,
      created.id,
      quickEdit,
    );
    const afterQuickEdit = (
      await catalog.list(actor.id, organization.id, unit.id)
    ).availability.find((row) => row.productId === created.id);
    assert.equal(afterQuickEdit?.autoDeductStock, true);
    assert.equal(afterQuickEdit?.dailyStock, 12);
    assert.equal(afterQuickEdit?.available, false);
    await catalog.updateProductUnitConfig(
      actor.id,
      organization.id,
      unit.id,
      created.id,
      productUnitConfigSchema.parse({ ...dailyConfig, autoDeductStock: false }),
    );
    assert.equal(
      (await catalog.list(actor.id, organization.id, unit.id)).availability.find(
        (row) => row.productId === created.id,
      )?.autoDeductStock,
      false,
    );
    await assert.rejects(
      catalog.createProduct(actor.id, organization.id, unit.id, randomUUID(), input),
      hasCode("INVENTORY_ITEM_ALREADY_LINKED"),
    );
    const candidates = await database.db
      .insert(managementInventoryItems)
      .values([
        {
          organizationId: organization.id,
          unitId: unit.id,
          name: "Race",
          kind: "resale",
          unit: "UN",
        },
        {
          organizationId: organization.id,
          unitId: siblingUnit.id,
          name: "Sibling",
          kind: "resale",
          unit: "un",
        },
        {
          organizationId: otherOrganization.id,
          unitId: otherUnit.id,
          name: "Other",
          kind: "resale",
          unit: "un",
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          name: "Inactive",
          kind: "resale",
          unit: "un",
          active: false,
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          name: "Ingredient",
          kind: "ingredient",
          unit: "un",
        },
        {
          organizationId: organization.id,
          unitId: unit.id,
          name: "Weight",
          kind: "resale",
          unit: "kg",
        },
      ])
      .returning();
    const [race, ...ineligible] = candidates;
    assert.ok(race);
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        catalog.createProduct(actor.id, organization.id, unit.id, randomUUID(), {
          ...input,
          inventoryItemId: race.id,
        }),
      ),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(
      rejected?.status === "rejected" && hasCode("INVENTORY_ITEM_ALREADY_LINKED")(rejected.reason),
    );
    for (const candidate of ineligible) {
      await assert.rejects(
        catalog.createProduct(actor.id, organization.id, unit.id, randomUUID(), {
          ...input,
          inventoryItemId: candidate.id,
        }),
        hasCode(
          candidate.unit === "kg"
            ? "RESALE_INVENTORY_UNIT_INVALID"
            : "RESALE_INVENTORY_ITEM_NOT_FOUND",
        ),
      );
    }
    for (const kind of ["ingredient", "prepared", "reusable", "returnable_container"] as const) {
      await assert.rejects(
        management.createInventoryItem(
          actor.id,
          organization.id,
          unit.id,
          randomUUID(),
          inventoryItemSchema.parse({
            name: kind,
            kind,
            unit: "un",
            productId: created.id,
          }),
        ),
        hasCode("INVENTORY_KIND_PRODUCT_FORBIDDEN"),
      );
    }
    const products = await database.db
      .select()
      .from(posProducts)
      .where(eq(posProducts.organizationId, organization.id));
    assert.equal(products.length, 2, "failed links must not leave orphan catalog products");
    const items = await database.db
      .select()
      .from(managementInventoryItems)
      .where(eq(managementInventoryItems.organizationId, organization.id));
    assert.equal(items.length, 6, "catalog linking must not duplicate inventory items");

    await database.db.insert(managementInventoryReservations).values({
      organizationId: organization.id,
      unitId: unit.id,
      inventoryItemId: item.id,
      locationId: location.id,
      quantity: "3",
      sourceType: "test",
      sourceId: randomUUID(),
      reason: "Pedido em andamento",
      idempotencyKey: randomUUID(),
      actorIdentityId: actor.id,
    });
    await database.db.insert(managementInventoryReservations).values({
      organizationId: organization.id,
      unitId: unit.id,
      inventoryItemId: item.id,
      locationId: location.id,
      quantity: "4",
      sourceType: "test",
      sourceId: randomUUID(),
      reason: "Reserva expirada",
      expiresAt: new Date(Date.now() - 60_000),
      idempotencyKey: randomUUID(),
      actorIdentityId: actor.id,
    });
    const [lot] = await database.db
      .insert(managementInventoryLots)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        inventoryItemId: item.id,
        locationId: location.id,
        quantity: "2",
        batchCode: randomUUID(),
      })
      .returning();
    assert.ok(lot);
    await database.db.insert(managementInventoryLotHolds).values({
      organizationId: organization.id,
      unitId: unit.id,
      lotId: lot.id,
      reason: "Conferência",
      idempotencyKey: randomUUID(),
      createdByIdentityId: actor.id,
    });
    const ownerCatalog = await catalog.list(actor.id, organization.id, unit.id);
    const stock = ownerCatalog.inventoryProducts?.find((row) => row.productId === created.id);
    assert.equal(ownerCatalog.capabilities.canManage, true);
    assert.equal(stock?.physicalQuantity, 24);
    assert.equal(stock?.availableQuantity, 19);
    assert.equal(stock?.estimatedCostCents, 600);
    assert.equal(stock?.recipeVersion, null, "a resale product does not require a recipe");

    const [operator] = await database.db
      .insert(identities)
      .values({
        email: `catalog-waiter-${randomUUID()}@example.test`,
        displayName: "Garçom",
      })
      .returning();
    assert.ok(operator);
    const [operatorMembership] = await database.db
      .insert(memberships)
      .values({
        organizationId: organization.id,
        identityId: operator.id,
        status: "active",
      })
      .returning();
    assert.ok(operatorMembership);
    await database.db.insert(roleBindings).values([
      { membershipId: operatorMembership.id, role: "waiter", unitId: unit.id },
      { membershipId: operatorMembership.id, role: "manager", unitId: siblingUnit.id },
    ]);
    const operatorCatalog = await catalog.list(operator.id, organization.id, unit.id);
    assert.equal(operatorCatalog.capabilities.canManage, false);
    assert.equal("inventoryProducts" in operatorCatalog, false);
    assert.deepEqual(operatorCatalog.recipes, []);
    assert.ok(operatorCatalog.prices.every((price) => !("costCents" in price)));
    assert.ok(operatorCatalog.products.some((product) => product.id === created.id));
    await assert.rejects(
      catalog.createCategory(operator.id, organization.id, unit.id, randomUUID(), {
        name: "Unauthorized",
        slug: "unauthorized",
        sortOrder: 0,
      }),
      hasCode("CATALOG_SCOPE_DENIED"),
    );

    const ingredient = items.find((candidate) => candidate.kind === "ingredient");
    assert.ok(ingredient);
    await database.db.insert(managementStockBalances).values({
      organizationId: organization.id,
      unitId: unit.id,
      inventoryItemId: ingredient.id,
      locationId: location.id,
      quantity: "0",
      averageCostCents: 2000,
    });
    const prepared = await catalog.createProduct(
      actor.id,
      organization.id,
      unit.id,
      randomUUID(),
      productSchema.parse({
        categoryId: category.id,
        name: "Prato opcional",
        stationIds: [station.id],
        priceCents: 3000,
      }),
    );
    assert.equal(
      (await catalog.list(actor.id, organization.id, unit.id)).availability.find(
        (row) => row.productId === prepared.id,
      )?.available,
      true,
    );
    await management.configureRecipe(actor.id, organization.id, unit.id, randomUUID(), {
      productId: prepared.id,
      components: [
        {
          inventoryItemId: ingredient.id,
          locationId: location.id,
          quantityMilli: 250,
          lossBasisPoints: 1000,
        },
      ],
    });
    const withRecipe = await catalog.list(actor.id, organization.id, unit.id);
    const recipeStock = withRecipe.inventoryProducts?.find((row) => row.productId === prepared.id);
    assert.equal(recipeStock?.recipeVersion, 1);
    assert.equal(recipeStock?.componentCount, 1);
    assert.equal(
      recipeStock?.estimatedCostCents,
      556,
      "cost uses the same loss yield and milli rounding as consumption",
    );
    assert.equal(
      recipeStock?.physicalQuantity,
      null,
      "ingredient quantities are not reported as prepared dish stock",
    );
    assert.equal(
      withRecipe.availability.find((row) => row.productId === prepared.id)?.available,
      true,
      "zero ingredient stock must not pause a product",
    );
  } finally {
    await database.onModuleDestroy();
  }
});
