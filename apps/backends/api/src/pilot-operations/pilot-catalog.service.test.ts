import assert from "node:assert/strict";
import { it } from "node:test";
import {
  auditEvents,
  outboxEvents,
  posAllergens,
  posCatalogCategories,
  posComboItems,
  posCombos,
  posIdempotencyReceipts,
  posModifierGroups,
  posModifierOptions,
  posProductAvailability,
  posProductionStations,
  posProductPrices,
  posProductStations,
  posProducts,
  units,
} from "@giromesa/db";
import type { DatabaseService } from "../database/database.module.js";
import type { ScopeService } from "../organizations/scope.service.js";
import { PilotCatalogService } from "./pilot-catalog.service.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const unitId = "22222222-2222-4222-8222-222222222222";
const actorIdentityId = "33333333-3333-4333-8333-333333333333";
const categoryId = "44444444-4444-4444-8444-444444444444";
const stationId = "55555555-5555-4555-8555-555555555555";
const productId = "66666666-6666-4666-8666-666666666666";

type Receipt = {
  actorIdentityId: string;
  operation: string;
  requestHash: string;
  response: Record<string, unknown>;
};

function createHarness(primaryTable: unknown, primaryId: string) {
  let receipt: Receipt | undefined;
  let inTransaction = false;
  const insertCounts = new Map<unknown, number>();
  const increment = (table: unknown) => insertCounts.set(table, (insertCounts.get(table) ?? 0) + 1);
  const rowsFor = (table: unknown) => {
    if (table === posIdempotencyReceipts) return receipt ? [receipt] : [];
    if (table === posCatalogCategories) return [{ id: categoryId }];
    if (table === posProductionStations) return [{ id: stationId }];
    if (table === posProducts) return [{ id: productId }];
    if (table === units) return [{ timezone: "America/Sao_Paulo" }];
    return [];
  };
  const select = () => ({
    from: (table: unknown) => ({
      where: () => {
        const rows = rowsFor(table);
        if (table === posIdempotencyReceipts || table === posCatalogCategories || table === units) {
          return { limit: async (limit: number) => rows.slice(0, limit) };
        }
        return Promise.resolve(rows);
      },
    }),
  });
  const tx = {
    execute: async () => undefined,
    select,
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        assert.equal(inTransaction, true, "catalog writes must stay inside the transaction");
        increment(table);
        if (table === primaryTable) {
          return {
            returning: async () => [
              {
                id: primaryId,
                organizationId,
                ...(values as Record<string, unknown>),
              },
            ],
          };
        }
        if (table === posModifierOptions) {
          return {
            returning: async () =>
              (values as Array<Record<string, unknown>>).map((value, index) => ({
                id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
                ...value,
              })),
          };
        }
        if (table === posIdempotencyReceipts) {
          const stored = values as Receipt;
          receipt = {
            actorIdentityId: stored.actorIdentityId,
            operation: stored.operation,
            requestHash: stored.requestHash,
            response: stored.response,
          };
        }
        return Promise.resolve();
      },
    }),
  };
  const database = {
    db: {
      select,
      transaction: async (work: (transaction: typeof tx) => Promise<unknown>) => {
        inTransaction = true;
        try {
          return await work(tx);
        } finally {
          inTransaction = false;
        }
      },
    },
  } as unknown as DatabaseService;
  const scope = {
    requireUnitAccess: async () => ({ organizationId, unitId }),
    requireOrganizationRole: async () => [{ unitId: null }],
  } as unknown as ScopeService;

  return {
    catalog: new PilotCatalogService(database, scope),
    count: (table: unknown) => insertCounts.get(table) ?? 0,
    receipt: () => receipt,
  };
}

const creations: Array<{
  expectedOperation: string;
  label: string;
  primaryId: string;
  primaryTable: unknown;
  run: (
    catalog: PilotCatalogService,
    key: string,
    name: string,
    actorId?: string,
  ) => Promise<Record<string, unknown>>;
  secondaryTables?: unknown[];
}> = [
  {
    label: "category",
    expectedOperation: "catalog.category.create",
    primaryTable: posCatalogCategories,
    primaryId: categoryId,
    run: (catalog, key, name, actorId = actorIdentityId) =>
      catalog.createCategory(actorId, organizationId, unitId, key, {
        name,
        slug: "executivos",
        sortOrder: 0,
      }),
  },
  {
    label: "allergen",
    expectedOperation: "catalog.allergen.create",
    primaryTable: posAllergens,
    primaryId: "88888888-8888-4888-8888-888888888888",
    run: (catalog, key, name, actorId = actorIdentityId) =>
      catalog.createAllergen(actorId, organizationId, unitId, key, {
        name,
        code: "gluten",
      }),
  },
  {
    label: "modifier group",
    expectedOperation: "catalog.modifier_group.create",
    primaryTable: posModifierGroups,
    primaryId: "99999999-9999-4999-8999-999999999999",
    secondaryTables: [posModifierOptions],
    run: (catalog, key, name, actorId = actorIdentityId) =>
      catalog.createModifierGroup(actorId, organizationId, unitId, key, {
        name,
        minimumSelections: 0,
        maximumSelections: 1,
        options: [{ name: "Bacon", priceDeltaCents: 500, sortOrder: 0 }],
      }),
  },
  {
    label: "station",
    expectedOperation: "catalog.station.create",
    primaryTable: posProductionStations,
    primaryId: stationId,
    run: (catalog, key, name, actorId = actorIdentityId) =>
      catalog.createStation(actorId, organizationId, unitId, key, {
        name,
        code: "cozinha",
      }),
  },
  {
    label: "product",
    expectedOperation: "catalog.product.create",
    primaryTable: posProducts,
    primaryId: productId,
    secondaryTables: [
      posProductPrices,
      posProductAvailability,
      posProductStations,
      auditEvents,
      outboxEvents,
    ],
    run: (catalog, key, name, actorId = actorIdentityId) =>
      catalog.createProduct(actorId, organizationId, unitId, key, {
        categoryId,
        name,
        stationIds: [stationId],
        priceCents: 3_500,
        available: true,
        allergenIds: [],
        modifierGroupIds: [],
        recipe: [],
      }),
  },
  {
    label: "combo",
    expectedOperation: "catalog.combo.create",
    primaryTable: posCombos,
    primaryId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    secondaryTables: [posComboItems, auditEvents, outboxEvents],
    run: (catalog, key, name, actorId = actorIdentityId) =>
      catalog.createCombo(actorId, organizationId, unitId, key, {
        name,
        description: "Prato e bebida",
        priceCents: 4_500,
        active: true,
        items: [{ productId, quantity: 1 }],
      }),
  },
];

it("creates every real catalog resource once and replays the stored response", async () => {
  for (const creation of creations) {
    const harness = createHarness(creation.primaryTable, creation.primaryId);
    const key = `create-${creation.label.replaceAll(" ", "-")}-0001`;
    const created = await creation.run(harness.catalog, key, "Original");
    const replayed = await creation.run(harness.catalog, key, "Original");

    assert.equal(created.id, creation.primaryId, creation.label);
    assert.equal(created.idempotentReplay, false, creation.label);
    assert.equal(replayed.id, creation.primaryId, creation.label);
    assert.equal(replayed.idempotentReplay, true, creation.label);
    assert.equal(harness.count(creation.primaryTable), 1, creation.label);
    assert.equal(harness.count(posIdempotencyReceipts), 1, creation.label);
    assert.equal(harness.receipt()?.operation, creation.expectedOperation, creation.label);
    for (const table of creation.secondaryTables ?? []) {
      assert.equal(harness.count(table), 1, creation.label);
    }
  }
});

it("rejects catalog key reuse with another payload or actor", async () => {
  for (const creation of creations) {
    const harness = createHarness(creation.primaryTable, creation.primaryId);
    const key = `conflict-${creation.label.replaceAll(" ", "-")}-0001`;
    await creation.run(harness.catalog, key, "Original");

    await assert.rejects(() => creation.run(harness.catalog, key, "Changed"), creation.label);
    await assert.rejects(
      () => creation.run(harness.catalog, key, "Original", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
      creation.label,
    );
    assert.equal(harness.count(creation.primaryTable), 1, creation.label);
    assert.equal(harness.count(posIdempotencyReceipts), 1, creation.label);
  }
});

it("requires a valid idempotency key for every catalog creation", async () => {
  for (const creation of creations) {
    const harness = createHarness(creation.primaryTable, creation.primaryId);
    await assert.rejects(() => creation.run(harness.catalog, "short", "Original"), creation.label);
    assert.equal(harness.count(creation.primaryTable), 0, creation.label);
    assert.equal(harness.count(posIdempotencyReceipts), 0, creation.label);
  }
});
