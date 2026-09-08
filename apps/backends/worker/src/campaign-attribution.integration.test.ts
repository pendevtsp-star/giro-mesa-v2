import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import test from "node:test";
import {
  campaignDeliveries,
  createDatabase,
  deviceEnrollments,
  growthCustomers,
  identities,
  marketingCampaigns,
  organizations,
  posCatalogCategories,
  posOrderItems,
  posOrders,
  posPaymentAttempts,
  posPaymentReversals,
  posProducts,
  posTabCustomerLinks,
  posTabPayments,
  posTabs,
  units,
} from "@giromesa/db";
import { eq, inArray } from "drizzle-orm";
import { OutboxWorker } from "./outbox.js";

function document() {
  return String(randomInt(10_000_000_000_000, 99_999_999_999_999));
}

test("attributes net revenue and only complete historical costs without double counting", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("WORKER_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = createDatabase(databaseUrl);
  let worker: OutboxWorker | undefined;
  let organizationId: string | undefined;
  const organizationIds: string[] = [];
  try {
    const runId = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Campaign attribution Ltda",
        tradeName: "Campaign attribution",
        document: document(),
      })
      .returning();
    assert.ok(organization);
    organizationId = organization.id;
    organizationIds.push(organizationId);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId, name: "Attribution unit" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `attribution-${runId}@example.test`, displayName: "Attribution owner" })
      .returning();
    const [category] = await database.db
      .insert(posCatalogCategories)
      .values({ organizationId, name: "Campaign items", slug: `campaign-${runId}` })
      .returning();
    assert.ok(unit && identity && category);
    const [device] = await database.db
      .insert(deviceEnrollments)
      .values({ organizationId, unitId: unit.id, label: "Attribution terminal" })
      .returning();
    const [product] = await database.db
      .insert(posProducts)
      .values({ organizationId, categoryId: category.id, name: "Campaign item" })
      .returning();
    assert.ok(product);
    const [knownCustomer, unknownCustomer, zeroCostCustomer] = await database.db
      .insert(growthCustomers)
      .values([
        {
          organizationId,
          name: "Known cost customer",
          idempotencyKey: `known:${runId}`,
          requestFingerprint: "1".repeat(64),
        },
        {
          organizationId,
          name: "Unknown cost customer",
          idempotencyKey: `unknown:${runId}`,
          requestFingerprint: "2".repeat(64),
        },
        {
          organizationId,
          name: "Zero cost customer",
          idempotencyKey: `zero:${runId}`,
          requestFingerprint: "3".repeat(64),
        },
      ])
      .returning();
    const [campaign, followUpCampaign] = await database.db
      .insert(marketingCampaigns)
      .values([
        {
          organizationId,
          name: "Attribution campaign",
          channel: "email",
          status: "sent",
          subject: "Attribution",
          content: "Attribution test",
        },
        {
          organizationId,
          name: "Attribution follow-up",
          channel: "email",
          status: "sent",
          subject: "Attribution follow-up",
          content: "Attribution follow-up test",
        },
      ])
      .returning();
    assert.ok(
      knownCustomer &&
        unknownCustomer &&
        zeroCostCustomer &&
        campaign &&
        followUpCampaign &&
        device,
    );
    const firstSentAt = new Date(Date.now() - 60_000);
    const firstPaymentAt = new Date(Date.now() - 45_000);
    const followUpSentAt = new Date(Date.now() - 50_000);
    const secondPaymentAt = new Date(Date.now() - 15_000);
    const [knownDelivery, unknownDelivery, zeroCostDelivery] = await database.db
      .insert(campaignDeliveries)
      .values([
        {
          organizationId,
          campaignId: campaign.id,
          customerId: knownCustomer.id,
          idempotencyKey: `delivery:known:${runId}`,
          status: "sent",
          sentAt: firstSentAt,
        },
        {
          organizationId,
          campaignId: campaign.id,
          customerId: unknownCustomer.id,
          idempotencyKey: `delivery:unknown:${runId}`,
          status: "sent",
          sentAt: firstSentAt,
        },
        {
          organizationId,
          campaignId: campaign.id,
          customerId: zeroCostCustomer.id,
          idempotencyKey: `delivery:zero:${runId}`,
          status: "sent",
          sentAt: firstSentAt,
        },
      ])
      .returning();
    const [knownTab, unknownTab, zeroCostTab] = await database.db
      .insert(posTabs)
      .values([
        {
          organizationId,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          label: "Known cost tab",
          subtotalCents: 1_500,
          totalCents: 1_500,
        },
        {
          organizationId,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          label: "Unknown cost tab",
          subtotalCents: 1_000,
          totalCents: 1_000,
        },
        {
          organizationId,
          unitId: unit.id,
          openedByIdentityId: identity.id,
          label: "Zero cost tab",
          subtotalCents: 1_000,
          totalCents: 1_000,
        },
      ])
      .returning();
    assert.ok(
      knownDelivery && unknownDelivery && zeroCostDelivery && knownTab && unknownTab && zeroCostTab,
    );
    await database.db.insert(posTabCustomerLinks).values([
      {
        organizationId,
        unitId: unit.id,
        tabId: knownTab.id,
        customerId: knownCustomer.id,
        linkedByIdentityId: identity.id,
      },
      {
        organizationId,
        unitId: unit.id,
        tabId: unknownTab.id,
        customerId: unknownCustomer.id,
        linkedByIdentityId: identity.id,
      },
      {
        organizationId,
        unitId: unit.id,
        tabId: zeroCostTab.id,
        customerId: zeroCostCustomer.id,
        linkedByIdentityId: identity.id,
      },
    ]);
    const [knownOrder, unknownOrder, zeroCostOrder] = await database.db
      .insert(posOrders)
      .values([
        {
          organizationId,
          unitId: unit.id,
          tabId: knownTab.id,
          createdByIdentityId: identity.id,
        },
        {
          organizationId,
          unitId: unit.id,
          tabId: unknownTab.id,
          createdByIdentityId: identity.id,
        },
        {
          organizationId,
          unitId: unit.id,
          tabId: zeroCostTab.id,
          createdByIdentityId: identity.id,
        },
      ])
      .returning();
    assert.ok(knownOrder && unknownOrder && zeroCostOrder);
    await database.db.insert(posOrderItems).values([
      {
        organizationId,
        unitId: unit.id,
        orderId: knownOrder.id,
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPriceCents: 1_000,
        grossCents: 1_000,
        netCents: 1_000,
        costCents: 400,
      },
      {
        organizationId,
        unitId: unit.id,
        orderId: knownOrder.id,
        productId: product.id,
        productName: "Canceled campaign item",
        quantity: 1,
        unitPriceCents: 500,
        grossCents: 500,
        netCents: 500,
        costCents: 500,
        status: "canceled",
      },
      {
        organizationId,
        unitId: unit.id,
        orderId: unknownOrder.id,
        productId: product.id,
        productName: "Unknown campaign item",
        quantity: 1,
        unitPriceCents: 1_000,
        grossCents: 1_000,
        netCents: 1_000,
        costCents: null,
      },
      {
        organizationId,
        unitId: unit.id,
        orderId: zeroCostOrder.id,
        productId: product.id,
        productName: "Zero-cost campaign item",
        quantity: 1,
        unitPriceCents: 1_000,
        grossCents: 1_000,
        netCents: 1_000,
        costCents: 0,
      },
    ]);
    const [firstPaymentAttempt] = await database.db
      .insert(posPaymentAttempts)
      .values({
        organizationId,
        unitId: unit.id,
        tabId: knownTab.id,
        installationId: device.id,
        requestedByIdentityId: identity.id,
        provider: "test",
        method: "pix",
        amountCents: 500,
        status: "approved",
        expiresAt: new Date(Date.now() + 60_000),
        resolvedAt: firstPaymentAt,
      })
      .returning();
    assert.ok(firstPaymentAttempt);
    const [firstKnownPayment] = await database.db
      .insert(posTabPayments)
      .values({
        organizationId,
        unitId: unit.id,
        tabId: knownTab.id,
        method: "pix",
        amountCents: 500,
        paymentAttemptId: firstPaymentAttempt.id,
        source: "terminal",
        verified: true,
        createdByIdentityId: identity.id,
        createdAt: firstPaymentAt,
      })
      .returning();
    assert.ok(firstKnownPayment);
    await database.db.insert(posTabPayments).values([
      {
        organizationId,
        unitId: unit.id,
        tabId: knownTab.id,
        method: "cash",
        amountCents: 500,
        createdByIdentityId: identity.id,
        createdAt: secondPaymentAt,
      },
      {
        organizationId,
        unitId: unit.id,
        tabId: unknownTab.id,
        method: "cash",
        amountCents: 1_000,
        createdByIdentityId: identity.id,
        createdAt: secondPaymentAt,
      },
      {
        organizationId,
        unitId: unit.id,
        tabId: zeroCostTab.id,
        method: "cash",
        amountCents: 1_000,
        createdByIdentityId: identity.id,
        createdAt: secondPaymentAt,
      },
    ]);

    const [otherOrganization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Campaign attribution isolated Ltda",
        tradeName: "Campaign attribution isolated",
        document: document(),
      })
      .returning();
    assert.ok(otherOrganization);
    organizationIds.push(otherOrganization.id);
    const [otherUnit] = await database.db
      .insert(units)
      .values({ organizationId: otherOrganization.id, name: "Isolated attribution unit" })
      .returning();
    const [otherCustomer] = await database.db
      .insert(growthCustomers)
      .values({
        organizationId: otherOrganization.id,
        name: "Isolated customer",
        idempotencyKey: `isolated:${runId}`,
        requestFingerprint: "4".repeat(64),
      })
      .returning();
    const [otherCampaign] = await database.db
      .insert(marketingCampaigns)
      .values({
        organizationId: otherOrganization.id,
        name: "Isolated attribution campaign",
        channel: "email",
        status: "sent",
        subject: "Isolated attribution",
        content: "Isolated attribution test",
      })
      .returning();
    assert.ok(otherUnit && otherCustomer && otherCampaign);
    const [otherTab] = await database.db
      .insert(posTabs)
      .values({
        organizationId: otherOrganization.id,
        unitId: otherUnit.id,
        openedByIdentityId: identity.id,
        label: "Isolated attribution tab",
        subtotalCents: 100,
        totalCents: 100,
      })
      .returning();
    assert.ok(otherTab);
    const [otherDelivery] = await database.db
      .insert(campaignDeliveries)
      .values({
        organizationId: otherOrganization.id,
        campaignId: otherCampaign.id,
        customerId: otherCustomer.id,
        idempotencyKey: `delivery:isolated:${runId}`,
        status: "sent",
        sentAt: firstSentAt,
      })
      .returning();
    assert.ok(otherDelivery);
    await database.db.insert(posTabCustomerLinks).values({
      organizationId: otherOrganization.id,
      unitId: otherUnit.id,
      tabId: otherTab.id,
      customerId: otherCustomer.id,
      linkedByIdentityId: identity.id,
    });
    await database.db.insert(posTabPayments).values({
      organizationId: otherOrganization.id,
      unitId: otherUnit.id,
      tabId: otherTab.id,
      method: "cash",
      amountCents: 100,
      createdByIdentityId: identity.id,
      createdAt: secondPaymentAt,
    });

    worker = new OutboxWorker();
    await worker.runCrmAutomations({ organizationId, unitId: unit.id });
    const [knownAfterFirst] = await database.db
      .select({
        revenue: campaignDeliveries.attributedRevenueCents,
        cost: campaignDeliveries.attributedCostCents,
        updatedAt: campaignDeliveries.updatedAt,
      })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.id, knownDelivery.id));
    const [unknownAfterFirst] = await database.db
      .select({ cost: campaignDeliveries.attributedCostCents })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.id, unknownDelivery.id));
    const [zeroCostAfterFirst] = await database.db
      .select({ cost: campaignDeliveries.attributedCostCents })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.id, zeroCostDelivery.id));
    const [otherAfterScopedRun] = await database.db
      .select({ revenue: campaignDeliveries.attributedRevenueCents })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.id, otherDelivery.id));
    assert.deepEqual(knownAfterFirst?.revenue, 1_000);
    assert.deepEqual(knownAfterFirst?.cost, 400);
    assert.equal(unknownAfterFirst?.cost, null);
    assert.equal(zeroCostAfterFirst?.cost, 0);
    assert.equal(otherAfterScopedRun?.revenue, null);

    const [followUpDelivery] = await database.db
      .insert(campaignDeliveries)
      .values({
        organizationId,
        campaignId: followUpCampaign.id,
        customerId: knownCustomer.id,
        idempotencyKey: `delivery:follow-up:${runId}`,
        status: "sent",
        sentAt: followUpSentAt,
      })
      .returning();
    assert.ok(followUpDelivery);
    await worker.runCrmAutomations({ organizationId, unitId: unit.id });
    const [knownAfterLateTouch] = await database.db
      .select({
        orderRef: campaignDeliveries.attributedOrderRef,
        revenue: campaignDeliveries.attributedRevenueCents,
        cost: campaignDeliveries.attributedCostCents,
      })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.id, knownDelivery.id));
    const [followUpAfterLateTouch] = await database.db
      .select({
        orderRef: campaignDeliveries.attributedOrderRef,
        revenue: campaignDeliveries.attributedRevenueCents,
        cost: campaignDeliveries.attributedCostCents,
      })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.id, followUpDelivery.id));
    assert.deepEqual(knownAfterLateTouch, { orderRef: null, revenue: 0, cost: null });
    assert.deepEqual(followUpAfterLateTouch, {
      orderRef: knownTab.id,
      revenue: 1_000,
      cost: 400,
    });

    await database.db.insert(posPaymentReversals).values({
      organizationId,
      unitId: unit.id,
      paymentId: firstKnownPayment.id,
      paymentAttemptId: firstPaymentAttempt.id,
      installationId: device.id,
      requestedByIdentityId: identity.id,
      amountCents: 200,
      reason: "Estorno parcial de teste",
      status: "approved",
      resolvedAt: new Date(),
    });
    await worker.runCrmAutomations({ organizationId, unitId: unit.id });
    const [knownAfterReversal] = await database.db
      .select({
        orderRef: campaignDeliveries.attributedOrderRef,
        revenue: campaignDeliveries.attributedRevenueCents,
        cost: campaignDeliveries.attributedCostCents,
        updatedAt: campaignDeliveries.updatedAt,
      })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.id, knownDelivery.id));
    const [followUpAfterReversal] = await database.db
      .select({
        orderRef: campaignDeliveries.attributedOrderRef,
        revenue: campaignDeliveries.attributedRevenueCents,
        cost: campaignDeliveries.attributedCostCents,
      })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.id, followUpDelivery.id));
    assert.deepEqual(knownAfterReversal?.orderRef, null);
    assert.deepEqual(knownAfterReversal?.revenue, 0);
    assert.deepEqual(knownAfterReversal?.cost, null);
    assert.deepEqual(followUpAfterReversal, {
      orderRef: knownTab.id,
      revenue: 800,
      cost: 320,
    });

    await worker.runCrmAutomations({ organizationId, unitId: unit.id });
    const [knownAfterReplay] = await database.db
      .select({
        orderRef: campaignDeliveries.attributedOrderRef,
        revenue: campaignDeliveries.attributedRevenueCents,
        cost: campaignDeliveries.attributedCostCents,
        updatedAt: campaignDeliveries.updatedAt,
      })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.id, knownDelivery.id));
    assert.deepEqual(knownAfterReplay, knownAfterReversal);
  } finally {
    if (worker) await worker.close();
    if (organizationIds.length) {
      await database.db
        .delete(posPaymentReversals)
        .where(inArray(posPaymentReversals.organizationId, organizationIds));
      await database.db
        .delete(posTabPayments)
        .where(inArray(posTabPayments.organizationId, organizationIds));
      await database.db
        .delete(posPaymentAttempts)
        .where(inArray(posPaymentAttempts.organizationId, organizationIds));
      await database.db
        .delete(posOrderItems)
        .where(inArray(posOrderItems.organizationId, organizationIds));
      await database.db.delete(posOrders).where(inArray(posOrders.organizationId, organizationIds));
      await database.db
        .delete(posTabCustomerLinks)
        .where(inArray(posTabCustomerLinks.organizationId, organizationIds));
      await database.db.delete(posTabs).where(inArray(posTabs.organizationId, organizationIds));
      await database.db
        .delete(campaignDeliveries)
        .where(inArray(campaignDeliveries.organizationId, organizationIds));
      await database.db
        .delete(marketingCampaigns)
        .where(inArray(marketingCampaigns.organizationId, organizationIds));
      await database.db
        .delete(growthCustomers)
        .where(inArray(growthCustomers.organizationId, organizationIds));
      await database.db
        .delete(posProducts)
        .where(inArray(posProducts.organizationId, organizationIds));
      await database.db
        .delete(posCatalogCategories)
        .where(inArray(posCatalogCategories.organizationId, organizationIds));
      await database.db
        .delete(deviceEnrollments)
        .where(inArray(deviceEnrollments.organizationId, organizationIds));
      await database.db.delete(units).where(inArray(units.organizationId, organizationIds));
      await database.db.delete(organizations).where(inArray(organizations.id, organizationIds));
    }
    await database.client.end();
  }
});
