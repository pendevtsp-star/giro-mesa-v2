import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  createDatabase,
  doseClubRedemptions,
  growthIntegrations,
  identities,
  managementInventoryItems,
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
import { eq } from "drizzle-orm";
import { OutboxWorker } from "./outbox.js";

test("commits a dose only after physical stock and reverses cancellation idempotently", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("WORKER_DATABASE_URL not configured");
    return;
  }

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousEnabled = process.env.DOSECLUB_PROVIDER_ENABLED;
  const previousSecret = process.env.DOSECLUB_TEST_INTEGRATION_KEY;
  process.env.DATABASE_URL = databaseUrl;
  process.env.DOSECLUB_PROVIDER_ENABLED = "true";
  process.env.DOSECLUB_TEST_INTEGRATION_KEY = "integration-secret";

  const database = createDatabase(databaseUrl);
  let worker: OutboxWorker | undefined;
  let balanceId = "";
  let operationStatus = "reserved";
  let stockSeenAtCommit: string | undefined;
  let commitCalls = 0;
  let reversalCalls = 0;
  const operation = () => {
    const now = new Date().toISOString();
    return {
      operationId: "dose-operation-worker-1",
      status: operationStatus,
      availableDoses: operationStatus === "reversed" ? 10 : 8,
      reservedAt: now,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      committedAt: operationStatus === "committed" ? now : null,
      canceledAt: null,
      expiredAt: null,
      reversedAt: operationStatus === "reversed" ? now : null,
      updatedAt: now,
    };
  };
  const server = createServer(async (request, response) => {
    assert.equal(request.headers["x-giromesa-client-id"], "giromesa-worker-test");
    assert.equal(request.headers["x-giromesa-integration-key"], "integration-secret");
    if (request.url?.endsWith("/commit")) {
      commitCalls += 1;
      const [balance] = await database.db
        .select({ quantity: managementStockBalances.quantity })
        .from(managementStockBalances)
        .where(eq(managementStockBalances.id, balanceId));
      stockSeenAtCommit = balance?.quantity;
      operationStatus = "committed";
    } else if (request.url?.endsWith("/consumption-reversals")) {
      reversalCalls += 1;
      operationStatus = "reversed";
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(operation()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
        legalName: "Dose Club Worker Integration Ltda",
        tradeName: "Dose Club Worker Integration",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Dose Club Worker Unit" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({
        displayName: "Dose Club Worker",
        email: `doseclub-worker-${randomUUID()}@example.test`,
      })
      .returning();
    assert.ok(unit && identity);
    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({
        organizationId: organization.id,
        name: "Whisky",
        slug: `worker-whisky-${randomUUID()}`,
      })
      .returning();
    assert.ok(category);
    const [product] = await database.db
      .insert(posProducts)
      .values({ organizationId: organization.id, categoryId: category.id, name: "Dose 30 ml" })
      .returning();
    const [tab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        openedByIdentityId: identity.id,
        label: "Mesa Dose Club Worker",
      })
      .returning();
    assert.ok(product && tab);
    const sentAt = new Date();
    const [order] = await database.db
      .insert(posOrders)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        tabId: tab.id,
        createdByIdentityId: identity.id,
        status: "sent",
        sentAt,
      })
      .returning();
    assert.ok(order);
    const [item] = await database.db
      .insert(posOrderItems)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        orderId: order.id,
        productId: product.id,
        productName: product.name,
        quantity: 2,
        unitPriceCents: 0,
        grossCents: 0,
        netCents: 0,
        status: "queued",
      })
      .returning();
    assert.ok(item);
    const [location] = await database.db
      .insert(managementStockLocations)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        code: `DOSE-${randomUUID().slice(0, 8)}`,
        name: "Bar",
      })
      .returning();
    const [inventoryItem] = await database.db
      .insert(managementInventoryItems)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        name: "Whisky bottle",
        unit: "ml",
      })
      .returning();
    assert.ok(location && inventoryItem);
    const [recipe] = await database.db
      .insert(managementRecipeVersions)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        productId: product.id,
        version: 1,
        validFrom: new Date(sentAt.getTime() - 60_000),
        createdByIdentityId: identity.id,
      })
      .returning();
    assert.ok(recipe);
    await database.db.insert(managementRecipeComponents).values({
      organizationId: organization.id,
      unitId: unit.id,
      recipeVersionId: recipe.id,
      inventoryItemId: inventoryItem.id,
      locationId: location.id,
      quantityMilli: 30_000,
      lossBasisPoints: 0,
    });
    const [balance] = await database.db
      .insert(managementStockBalances)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        inventoryItemId: inventoryItem.id,
        locationId: location.id,
        quantity: "750.000",
      })
      .returning();
    assert.ok(balance);
    balanceId = balance.id;
    const [integration] = await database.db
      .insert(growthIntegrations)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        provider: "doseclub",
        status: "active",
        credentialReference: "DOSECLUB_TEST_INTEGRATION_KEY",
        config: {
          apiBaseUrl: `http://127.0.0.1:${address.port}`,
          clientId: "giromesa-worker-test",
        },
      })
      .returning();
    assert.ok(integration);
    await database.db.insert(doseClubRedemptions).values({
      organizationId: organization.id,
      unitId: unit.id,
      integrationId: integration.id,
      orderId: order.id,
      orderItemId: item.id,
      externalCustomerId: randomUUID(),
      externalClubId: randomUUID(),
      externalProductId: product.id,
      doses: 2,
      status: "commit_pending",
      operationId: "dose-operation-worker-1",
      reserveIdempotencyKey: randomUUID(),
      requestFingerprint: "a".repeat(64),
      reservedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const [sentEvent] = await database.db
      .insert(outboxEvents)
      .values({
        aggregateId: tab.id,
        aggregateType: "tab",
        availableAt: new Date(0),
        payload: {
          organizationId: organization.id,
          unitId: unit.id,
          tabId: tab.id,
          orderId: order.id,
          ticketIds: [randomUUID()],
        },
        topic: "pos.order.sent",
      })
      .returning();
    assert.ok(sentEvent);

    worker = new OutboxWorker();
    assert.equal(await worker.runEvent(sentEvent.id), 1);
    const [afterCommit, stockAfterCommit] = await Promise.all([
      database.db
        .select({ status: doseClubRedemptions.status })
        .from(doseClubRedemptions)
        .where(eq(doseClubRedemptions.orderItemId, item.id)),
      database.db
        .select({ quantity: managementStockBalances.quantity })
        .from(managementStockBalances)
        .where(eq(managementStockBalances.id, balance.id)),
    ]);
    assert.equal(stockSeenAtCommit, "690.000");
    assert.equal(stockAfterCommit[0]?.quantity, "690.000");
    assert.equal(afterCommit[0]?.status, "committed");
    assert.equal(commitCalls, 1);

    await database.db
      .update(posOrderItems)
      .set({ status: "canceled", canceledAt: new Date(), canceledReason: "Cliente desistiu" })
      .where(eq(posOrderItems.id, item.id));
    const cancellationPayload = {
      organizationId: organization.id,
      unitId: unit.id,
      tabId: tab.id,
      itemId: item.id,
      approvalId: randomUUID(),
      reason: "Cliente desistiu",
    };
    const [cancelEvent] = await database.db
      .insert(outboxEvents)
      .values({
        aggregateId: tab.id,
        aggregateType: "tab",
        availableAt: new Date(0),
        payload: cancellationPayload,
        topic: "pos.item.canceled",
      })
      .returning();
    assert.ok(cancelEvent);
    assert.equal(await worker.runEvent(cancelEvent.id), 1);

    const [replayEvent] = await database.db
      .insert(outboxEvents)
      .values({
        aggregateId: tab.id,
        aggregateType: "tab",
        availableAt: new Date(0),
        payload: cancellationPayload,
        topic: "pos.item.canceled",
      })
      .returning();
    assert.ok(replayEvent);
    assert.equal(await worker.runEvent(replayEvent.id), 1);

    const [afterReverse, stockAfterReverse] = await Promise.all([
      database.db
        .select({ status: doseClubRedemptions.status })
        .from(doseClubRedemptions)
        .where(eq(doseClubRedemptions.orderItemId, item.id)),
      database.db
        .select({ quantity: managementStockBalances.quantity })
        .from(managementStockBalances)
        .where(eq(managementStockBalances.id, balance.id)),
    ]);
    assert.equal(stockAfterReverse[0]?.quantity, "750.000");
    assert.equal(afterReverse[0]?.status, "reversed");
    assert.equal(reversalCalls, 1);
  } finally {
    if (worker) await worker.close();
    await database.client.end();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousEnabled === undefined) delete process.env.DOSECLUB_PROVIDER_ENABLED;
    else process.env.DOSECLUB_PROVIDER_ENABLED = previousEnabled;
    if (previousSecret === undefined) delete process.env.DOSECLUB_TEST_INTEGRATION_KEY;
    else process.env.DOSECLUB_TEST_INTEGRATION_KEY = previousSecret;
  }
});
