import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  doseClubRedemptions,
  growthIntegrations,
  identities,
  organizations,
  posCatalogCategories,
  posOrderItems,
  posOrders,
  posProducts,
  posTabs,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { DoseClubIntegrationService } from "./doseclub-integration.service.js";

test("stages and reserves a dose before marking the order ready for outbox commit", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }

  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousEnabled = process.env.DOSECLUB_PROVIDER_ENABLED;
  const previousSecret = process.env.DOSECLUB_TEST_INTEGRATION_KEY;
  process.env.DATABASE_URL = databaseUrl;
  process.env.DOSECLUB_PROVIDER_ENABLED = "true";
  process.env.DOSECLUB_TEST_INTEGRATION_KEY = "integration-secret";

  let reservationBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    reservationBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    const now = new Date().toISOString();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        operationId: "dose-operation-1",
        status: "reserved",
        externalCommandId: reservationBody.externalCommandId,
        externalCommandItemId: reservationBody.externalCommandItemId,
        externalClubId: reservationBody.externalClubId,
        externalBranchId: reservationBody.externalBranchId,
        externalProductId: reservationBody.externalProductId,
        doses: reservationBody.doses,
        availableDoses: 7,
        reservedAt: now,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        committedAt: null,
        canceledAt: null,
        expiredAt: null,
        reversedAt: null,
        updatedAt: now,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const database = new DatabaseService();
  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
        legalName: "Dose Club API Integration Ltda",
        tradeName: "Dose Club API Integration",
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Dose Club Unit" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({
        displayName: "Dose Club Operator",
        email: `doseclub-api-${randomUUID()}@example.test`,
      })
      .returning();
    assert.ok(unit && identity);
    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({
        organizationId: organization.id,
        name: "Whisky",
        slug: `whisky-${randomUUID()}`,
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
        label: "Mesa Dose Club",
      })
      .returning();
    assert.ok(product && tab);
    const [order] = await database.db
      .insert(posOrders)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        tabId: tab.id,
        createdByIdentityId: identity.id,
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
      })
      .returning();
    const [integration] = await database.db
      .insert(growthIntegrations)
      .values({
        organizationId: organization.id,
        unitId: unit.id,
        provider: "doseclub",
        status: "active",
        credentialReference: "DOSECLUB_TEST_INTEGRATION_KEY",
        config: { apiBaseUrl: `http://127.0.0.1:${address.port}`, clientId: "giromesa-test" },
      })
      .returning();
    assert.ok(item && integration);

    const service = new DoseClubIntegrationService(database, new ScopeService(database));
    await database.db.transaction((tx) =>
      service.stageRedemption(tx, {
        organizationId: organization.id,
        unitId: unit.id,
        integrationId: integration.id,
        orderId: order.id,
        orderItemId: item.id,
        externalCustomerId: randomUUID(),
        externalClubId: randomUUID(),
        externalProductId: product.id,
        doses: 2,
      }),
    );

    const [staged] = await database.db
      .select()
      .from(doseClubRedemptions)
      .where(eq(doseClubRedemptions.orderItemId, item.id));
    assert.equal(staged?.status, "pending_reservation");

    await service.reserveOrder(organization.id, unit.id, order.id);
    const [reserved] = await database.db
      .select()
      .from(doseClubRedemptions)
      .where(eq(doseClubRedemptions.orderItemId, item.id));
    assert.equal(reserved?.status, "reserved");
    assert.equal(reservationBody?.externalCommandItemId, item.id);
    assert.equal(reservationBody?.doses, 2);

    await database.db.transaction((tx) =>
      service.assertReservedAndMarkCommitPending(tx, organization.id, unit.id, order.id),
    );
    const [readyForOutbox] = await database.db
      .select()
      .from(doseClubRedemptions)
      .where(eq(doseClubRedemptions.orderItemId, item.id));
    assert.equal(readyForOutbox?.status, "commit_pending");
  } finally {
    await database.onModuleDestroy();
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
