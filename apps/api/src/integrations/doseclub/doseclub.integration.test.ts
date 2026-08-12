import assert from "node:assert/strict";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  createDatabase,
  doseClubOperations,
  doseClubProductMappings,
  doseClubStates,
  growthIntegrations,
  managementInventoryItems,
  managementStockBalances,
  managementStockLocations,
  organizations,
  posCatalogCategories,
  posProducts,
  publicApiKeys,
  units,
} from "@giromesa/db";
import { Module } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../database/database.module.js";
import { TenantContextInterceptor } from "../../database/tenant-context.interceptor.js";
import { DoseClubController } from "./doseclub.controller.js";
import type {
  DoseClubV1Consumption,
  DoseClubV1Reversal,
  DoseClubV1Sale,
  DoseClubV2Operation,
} from "./doseclub.schemas.js";
import { DoseClubService } from "./doseclub.service.js";

@Module({ controllers: [DoseClubController], providers: [DatabaseService, DoseClubService] })
class DoseClubHttpTestModule {}

it("receives ordered DoseClub operations exactly once with stock and tenant isolation", async (context) => {
  const databaseUrl = process.env.DOSECLUB_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("DOSECLUB_DATABASE_URL not configured");
    return;
  }
  const connection = createDatabase(databaseUrl, { max: 4 });
  const database = new DatabaseService(connection);
  const service = new DoseClubService(database);
  const integrationKey = `gm_${randomUUID()}_${randomUUID()}`;
  const keyHash = createHash("sha256").update(integrationKey).digest("hex");
  const branchId = `branch-${randomUUID()}`;
  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "DoseClub Receiver Test Ltda",
        tradeName: "DoseClub Receiver",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "DoseClub Unit" })
      .returning();
    assert.ok(unit);
    await database.db.insert(publicApiKeys).values({
      organizationId: organization.id,
      name: "DoseClub integration test",
      keyPrefix: integrationKey.slice(0, 12),
      keyHash,
      keyLastFour: integrationKey.slice(-4),
      scopes: ["doseclub:read", "doseclub:write"],
    });
    await database.db.insert(growthIntegrations).values({
      organizationId: organization.id,
      unitId: unit.id,
      provider: "doseclub",
      status: "active",
      config: { branchId },
    });
    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({
        organizationId: organization.id,
        name: "Destilados",
        slug: `spirits-${randomUUID()}`,
      })
      .returning();
    assert.ok(category);
    const [product] = await database.db
      .insert(posProducts)
      .values({ organizationId: organization.id, categoryId: category.id, name: "Whisky Test" })
      .returning();
    const [location] = await database.db
      .insert(managementStockLocations)
      .values({ organizationId: organization.id, unitId: unit.id, name: "Bar", code: "BAR" })
      .returning();
    assert.ok(product && location);
    const [item] = await database.db
      .insert(managementInventoryItems)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        productId: product.id,
        name: "Whisky Test ml",
        unit: "ml",
        dimension: "volume",
      })
      .returning();
    assert.ok(item);
    await database.db.insert(managementStockBalances).values({
      organizationId: organization.id,
      unitId: unit.id,
      locationId: location.id,
      inventoryItemId: item.id,
      quantity: "1000.000000",
    });
    await database.db.insert(doseClubProductMappings).values({
      organizationId: organization.id,
      unitId: unit.id,
      externalProductId: "dose-product-a",
      productId: product.id,
      inventoryItemId: item.id,
      stockLocationId: location.id,
    });
    await database.db.insert(doseClubProductMappings).values({
      organizationId: organization.id,
      unitId: unit.id,
      externalProductId: "dose-product-b",
      productId: product.id,
      inventoryItemId: item.id,
      stockLocationId: location.id,
    });

    const purchaseSnapshot = {
      volumeMlAtPurchase: 500,
      doseMlAtPurchase: 50,
      totalDoses: 10,
      remainingDoses: 10,
    };
    const sale = {
      contractVersion: "v2",
      operation: "sale",
      operationId: randomUUID(),
      idempotencyKey: `sale:${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      version: 1,
      branchId,
      externalClubId: `club-${randomUUID()}`,
      purchaseSnapshot,
      externalOfferId: `offer-${randomUUID()}`,
      saleType: "combo_pool",
      eligibleProductIds: ["dose-product-a", "dose-product-b"],
      quantityBottles: 1,
    } satisfies DoseClubV2Operation;
    const inScope = <T>(work: () => Promise<T>) =>
      database.withDoseClubContext({ keyHash, scope: "doseclub:write", branchId }, work);

    const accepted = await inScope(() => service.receiveV2(sale));
    const replayed = await inScope(() => service.receiveV2(sale));
    assert.equal(accepted.outcome, "accepted");
    assert.equal(replayed.outcome, "duplicate");

    const consumption = {
      contractVersion: "v2",
      operation: "consumption",
      operationId: randomUUID(),
      idempotencyKey: `consumption:${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      version: 2,
      branchId,
      externalClubId: sale.externalClubId,
      purchaseSnapshot,
      productId: "dose-product-a",
      doses: 2,
    } satisfies DoseClubV2Operation;
    const concurrent = await Promise.all([
      inScope(() => service.receiveV2(consumption)),
      inScope(() => service.receiveV2(consumption)),
    ]);
    assert.deepEqual(concurrent.map((entry) => entry.outcome).sort(), ["accepted", "duplicate"]);

    const reversal = {
      contractVersion: "v2",
      operation: "reversal",
      operationId: randomUUID(),
      originalOperationId: consumption.operationId,
      idempotencyKey: `reversal:${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      version: 3,
      branchId,
      externalClubId: sale.externalClubId,
      purchaseSnapshot: { ...purchaseSnapshot, remainingDoses: 8 },
      productId: "dose-product-a",
      doses: 2,
      reason: "cancelamento operacional",
    } satisfies DoseClubV2Operation;
    const reversed = await inScope(() => service.receiveV2(reversal));
    assert.equal(reversed.outcome, "accepted");

    const v1Sale = {
      branchId,
      quantityBottles: 1,
      totalDoses: 4,
      doseMl: 50,
      externalClubId: `legacy-club-${randomUUID()}`,
      externalOfferId: `legacy-offer-${randomUUID()}`,
      idempotencyKey: `legacy-sale:${randomUUID()}`,
      saleType: "combo_pool",
      eligibleProductIds: ["dose-product-a", "dose-product-b"],
    } satisfies DoseClubV1Sale;
    const v1Accepted = await inScope(() => service.receiveV1Sale(v1Sale));
    const v1Replay = await inScope(() => service.receiveV1Sale(v1Sale));
    assert.equal(v1Accepted.outcome, "accepted");
    assert.equal(v1Replay.outcome, "duplicate");
    const v1Consumption = {
      branchId,
      productId: "dose-product-a",
      externalClubId: v1Sale.externalClubId,
      externalConsumptionId: `legacy-consumption-${randomUUID()}`,
      doseMl: 50,
      idempotencyKey: `legacy-consumption:${randomUUID()}`,
    } satisfies DoseClubV1Consumption;
    const v1Consumed = await inScope(() => service.receiveV1Consumption(v1Consumption));
    assert.equal(v1Consumed.outcome, "accepted");
    await assert.rejects(
      () =>
        inScope(() =>
          service.receiveV1Reversal({
            branchId,
            productId: "dose-product-b",
            externalClubId: v1Sale.externalClubId,
            externalConsumptionId: v1Consumption.externalConsumptionId,
            externalReversalId: `legacy-wrong-reversal-${randomUUID()}`,
            originalIdempotencyKey: v1Consumption.idempotencyKey,
            doseMl: 50,
            reason: "produto divergente",
            idempotencyKey: `legacy-wrong-reversal:${randomUUID()}`,
          }),
        ),
      (error: unknown) =>
        error instanceof Error &&
        "response" in error &&
        (error.response as { code?: string }).code === "DOSECLUB_REVERSAL_MISMATCH",
    );
    const v1Reversal = {
      branchId,
      productId: "dose-product-a",
      externalClubId: v1Sale.externalClubId,
      externalConsumptionId: v1Consumption.externalConsumptionId,
      externalReversalId: `legacy-reversal-${randomUUID()}`,
      originalIdempotencyKey: v1Consumption.idempotencyKey,
      doseMl: 50,
      reason: "cancelamento do consumo legado",
      idempotencyKey: `legacy-reversal:${randomUUID()}`,
    } satisfies DoseClubV1Reversal;
    const v1Reversed = await inScope(() => service.receiveV1Reversal(v1Reversal));
    assert.equal(v1Reversed.outcome, "accepted");

    const [state] = await database.db
      .select()
      .from(doseClubStates)
      .where(eq(doseClubStates.externalClubId, sale.externalClubId));
    const [balance] = await database.db
      .select()
      .from(managementStockBalances)
      .where(eq(managementStockBalances.inventoryItemId, item.id));
    assert.equal(state?.version, 3);
    assert.equal(state?.remainingDoses, 10);
    assert.equal(balance?.quantity, "1000.000000");
    const operationRows = await database.db
      .select()
      .from(doseClubOperations)
      .where(eq(doseClubOperations.externalClubId, sale.externalClubId));
    assert.equal(operationRows.length, 3);
    await assert.rejects(
      () =>
        database.withRoleContext("internal", null, (tx) =>
          tx.execute(sql`select key_hash from public.growth_public_api_keys limit 1`),
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        /permission denied/i.test(error.cause.message),
    );
    await assert.rejects(
      () =>
        database.withDoseClubContext({ keyHash, scope: "doseclub:write", branchId }, (tx) =>
          tx.execute(
            sql`update public.doseclub_operations set outcome = 'duplicate' where id = ${operationRows[0]?.id}::uuid`,
          ),
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.cause instanceof Error &&
        /permission denied|immutable/i.test(error.cause.message),
    );

    process.env.DATABASE_URL = databaseUrl;
    const app = await NestFactory.create<NestFastifyApplication>(
      DoseClubHttpTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    const httpDatabase = app.get(DatabaseService);
    app.useGlobalInterceptors(new TenantContextInterceptor(httpDatabase, new Reflector()));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    try {
      const branches = await app.inject({
        method: "GET",
        url: "/api/v1/integrations/club-whisky/branches",
        headers: { "x-giromesa-integration-key": integrationKey },
      });
      assert.equal(branches.statusCode, 200);
      assert.equal(branches.json().branches[0]?.id, branchId);
      const httpSale = {
        ...sale,
        operationId: randomUUID(),
        idempotencyKey: `http-sale:${randomUUID()}`,
        externalClubId: `http-club-${randomUUID()}`,
      } satisfies DoseClubV2Operation;
      const received = await app.inject({
        method: "POST",
        url: "/v1/integrations/club-whisky/sales",
        headers: {
          "content-type": "application/json",
          "x-giromesa-contract-version": "2",
          "x-giromesa-integration-key": integrationKey,
        },
        payload: httpSale,
      });
      assert.equal(received.statusCode, 200, received.body);
      assert.equal(received.json().operationId, httpSale.operationId);
      assert.equal(received.json().outcome, "accepted");
      const invalidVersion = await app.inject({
        method: "POST",
        url: "/api/v1/integrations/club-whisky/sales",
        headers: {
          "content-type": "application/json",
          "x-giromesa-contract-version": "3",
          "x-giromesa-integration-key": integrationKey,
        },
        payload: httpSale,
      });
      assert.equal(invalidVersion.statusCode, 400);
      const denied = await app.inject({
        method: "GET",
        url: "/v1/integrations/club-whisky/branches",
        headers: { "x-giromesa-integration-key": "invalid-integration-key" },
      });
      assert.equal(denied.statusCode, 401);
    } finally {
      await app.close();
    }

    await assert.rejects(
      () =>
        database.withDoseClubContext(
          { keyHash, scope: "doseclub:write", branchId: "unknown-branch" },
          () => service.receiveV2(sale),
        ),
      /DOSECLUB_SCOPE_NOT_FOUND/,
    );
  } finally {
    await database.onModuleDestroy();
  }
});
