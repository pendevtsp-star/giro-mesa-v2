import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  campaignDeliveries,
  createDatabase,
  growthCustomers,
  marketingCampaigns,
  organizations,
  outboxEvents,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { OutboxWorker } from "./outbox.js";

test("skips a pending delivery when its campaign was canceled before sending", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("WORKER_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = createDatabase(databaseUrl);
  let worker: OutboxWorker | undefined;
  let eventId: string | undefined;
  let organizationId: string | undefined;
  try {
    const runId = randomUUID();
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Campaign cancellation Ltda",
        tradeName: "Campaign cancellation",
        document: runId.replaceAll("-", "").slice(0, 14),
        billingState: "active",
      })
      .returning();
    assert.ok(organization);
    organizationId = organization.id;
    const [customer] = await database.db
      .insert(growthCustomers)
      .values({
        organizationId,
        name: "Cliente campanha",
        email: `campaign-${runId}@example.test`,
        marketingOptIn: true,
        emailMarketingOptIn: true,
        idempotencyKey: `campaign-test:${runId}`,
        requestFingerprint: "0".repeat(64),
      })
      .returning();
    const [campaign] = await database.db
      .insert(marketingCampaigns)
      .values({
        organizationId,
        name: "Campanha cancelada",
        channel: "email",
        status: "canceled",
        subject: "Cancelada",
        content: "Não enviar",
      })
      .returning();
    assert.ok(customer && campaign);
    const [delivery] = await database.db
      .insert(campaignDeliveries)
      .values({
        organizationId,
        campaignId: campaign.id,
        customerId: customer.id,
        idempotencyKey: `${campaign.id}:${customer.id}`,
      })
      .returning();
    assert.ok(delivery);
    const [event] = await database.db
      .insert(outboxEvents)
      .values({
        topic: "growth.campaign_delivery_requested",
        aggregateType: "growth_campaign_delivery",
        aggregateId: delivery.id,
        payload: {
          organizationId,
          campaignId: campaign.id,
          deliveryId: delivery.id,
          customerId: customer.id,
          channel: "email",
        },
      })
      .returning();
    assert.ok(event);
    eventId = event.id;

    worker = new OutboxWorker();
    assert.equal(await worker.runEvent(event.id), 1);
    const [skipped] = await database.db
      .select({ status: campaignDeliveries.status, errorCode: campaignDeliveries.errorCode })
      .from(campaignDeliveries)
      .where(eq(campaignDeliveries.id, delivery.id));
    assert.deepEqual(skipped, { status: "skipped", errorCode: "CAMPAIGN_CANCELED" });
  } finally {
    if (worker) await worker.close();
    if (eventId) await database.db.delete(outboxEvents).where(eq(outboxEvents.id, eventId));
    if (organizationId)
      await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    await database.client.end();
  }
});
