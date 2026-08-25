import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  billingCheckouts,
  charges,
  commercialCatalogVersions,
  commercialPlans,
  createDatabase,
  organizations,
  paymentEvents,
  subscriptions,
} from "@giromesa/db";
import { eq, inArray } from "drizzle-orm";
import { processBillingPaymentEvent } from "./billing.js";
import type { ClaimedOutboxEvent } from "./outbox.js";

function claimed(paymentEventId: string): ClaimedOutboxEvent {
  return {
    id: randomUUID(),
    topic: "billing.payment_event_received",
    aggregate_type: "payment_event",
    aggregate_id: paymentEventId,
    payload: { paymentEventId, provider: "asaas" },
    attempts: 1,
  };
}

test("processes duplicate and out-of-order Asaas events once in PostgreSQL", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("WORKER_DATABASE_URL not configured");
    return;
  }
  const database = createDatabase(databaseUrl);
  let organizationId: string | undefined;
  let catalogId: string | undefined;
  const receiptIds: string[] = [];
  try {
    const [catalog] = await database.db
      .insert(commercialCatalogVersions)
      .values({ version: randomInt(1_000_000_000, 2_000_000_000), status: "published" })
      .returning();
    assert.ok(catalog);
    catalogId = catalog.id;
    const [plan] = await database.db
      .insert(commercialPlans)
      .values({
        catalogVersionId: catalog.id,
        slug: `worker-${randomUUID()}`,
        name: "Worker billing",
        monthlyPriceCents: 10_000,
        annualPriceCents: 100_000,
        includedUnits: 1,
      })
      .returning();
    assert.ok(plan);
    const [organization] = await database.db
      .insert(organizations)
      .values({
        document: String(randomInt(10_000_000, 99_999_999)).padEnd(14, "0"),
        legalName: "Worker Billing Ltda",
        tradeName: "Worker Billing",
        billingState: "grace",
      })
      .returning();
    assert.ok(organization);
    organizationId = organization.id;
    const [subscription] = await database.db
      .insert(subscriptions)
      .values({
        organizationId: organization.id,
        commercialPlanId: plan.id,
        provider: "asaas",
        providerSubscriptionId: `sub_${randomUUID()}`,
        cycle: "monthly",
        state: "active",
        contractedPriceCents: 10_000,
        currentPeriodStartsAt: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEndsAt: new Date("2026-09-01T00:00:00.000Z"),
        reconciliationStatus: "pending",
      })
      .returning();
    assert.ok(subscription);
    const providerChargeId = `pay_${randomUUID()}`;
    const [checkout] = await database.db
      .insert(billingCheckouts)
      .values({
        organizationId: organization.id,
        subscriptionId: subscription.id,
        targetCommercialPlanId: plan.id,
        provider: "asaas",
        providerCheckoutId: `payment:${providerChargeId}`,
        providerCheckoutUrl: "https://sandbox.asaas.com/payment/test",
        intent: "regularize",
        idempotencyKey: `worker-${randomUUID()}`,
        amountCents: 10_000,
        cycle: "monthly",
        status: "created",
      })
      .returning();
    assert.ok(checkout);
    await database.db.insert(charges).values({
      subscriptionId: subscription.id,
      billingCheckoutId: checkout.id,
      providerChargeId,
      amountCents: 10_000,
      status: "overdue",
      dueAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    const paymentPayload = {
      payment: {
        id: providerChargeId,
        subscription: subscription.providerSubscriptionId,
        value: 100,
        dueDate: "2026-08-01",
        paymentDate: "2026-08-02",
        billingType: "PIX",
        status: "RECEIVED",
      },
    };
    const [paidReceipt] = await database.db
      .insert(paymentEvents)
      .values({
        provider: "asaas",
        providerEventId: `evt_${randomUUID()}`,
        eventType: "PAYMENT_CONFIRMED",
        payload: paymentPayload,
      })
      .returning();
    assert.ok(paidReceipt);
    receiptIds.push(paidReceipt.id);
    await Promise.all([
      processBillingPaymentEvent(database.db, claimed(paidReceipt.id)),
      processBillingPaymentEvent(database.db, claimed(paidReceipt.id)),
    ]);
    const [processed] = await database.db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.id, paidReceipt.id));
    const [paidCharge] = await database.db
      .select()
      .from(charges)
      .where(eq(charges.providerChargeId, providerChargeId));
    const [paidCheckout] = await database.db
      .select()
      .from(billingCheckouts)
      .where(eq(billingCheckouts.id, checkout.id));
    const [activeOrganization] = await database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organization.id));
    assert.equal(processed?.processingAttempts, 1);
    assert.equal(paidCharge?.status, "paid");
    assert.equal(paidCheckout?.status, "paid");
    assert.equal(activeOrganization?.billingState, "active");

    for (const [eventType, status, expected] of [
      ["PAYMENT_OVERDUE", "OVERDUE", "paid"],
      ["PAYMENT_REFUNDED", "REFUNDED", "refunded"],
    ] as const) {
      const [receipt] = await database.db
        .insert(paymentEvents)
        .values({
          provider: "asaas",
          providerEventId: `evt_${randomUUID()}`,
          eventType,
          payload: { payment: { ...paymentPayload.payment, status } },
        })
        .returning();
      assert.ok(receipt);
      receiptIds.push(receipt.id);
      await processBillingPaymentEvent(database.db, claimed(receipt.id));
      const [currentCharge] = await database.db
        .select()
        .from(charges)
        .where(eq(charges.providerChargeId, providerChargeId));
      assert.equal(currentCharge?.status, expected);
    }

    const [subscriptionReceipt] = await database.db
      .insert(paymentEvents)
      .values({
        provider: "asaas",
        providerEventId: `evt_${randomUUID()}`,
        eventType: "SUBSCRIPTION_UPDATED",
        payload: {
          subscription: {
            id: subscription.providerSubscriptionId,
            status: "ACTIVE",
            value: 100,
            nextDueDate: "2026-10-01",
            cycle: "MONTHLY",
            billingType: "CREDIT_CARD",
          },
        },
      })
      .returning();
    assert.ok(subscriptionReceipt);
    receiptIds.push(subscriptionReceipt.id);
    await processBillingPaymentEvent(database.db, claimed(subscriptionReceipt.id));
    const [synchronized] = await database.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscription.id));
    assert.equal(synchronized?.reconciliationStatus, "succeeded");
    assert.equal(synchronized?.paymentMethod, "credit_card");
    assert.equal(synchronized?.currentPeriodEndsAt?.toISOString(), "2026-10-01T00:00:00.000Z");

    for (const eventType of ["SUBSCRIPTION_INACTIVATED", "SUBSCRIPTION_UPDATED"] as const) {
      const [receipt] = await database.db
        .insert(paymentEvents)
        .values({
          provider: "asaas",
          providerEventId: `evt_${randomUUID()}`,
          eventType,
          payload: {
            subscription: {
              id: subscription.providerSubscriptionId,
              status: eventType === "SUBSCRIPTION_INACTIVATED" ? "INACTIVE" : "ACTIVE",
              value: 100,
              cycle: "MONTHLY",
            },
          },
        })
        .returning();
      assert.ok(receipt);
      receiptIds.push(receipt.id);
      await processBillingPaymentEvent(database.db, claimed(receipt.id));
    }
    const [canceledSubscription] = await database.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.id, subscription.id));
    const [canceledOrganization] = await database.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, organization.id));
    assert.equal(canceledSubscription?.state, "canceled");
    assert.equal(canceledOrganization?.billingState, "canceled");
  } finally {
    if (receiptIds.length > 0) {
      await database.db.delete(paymentEvents).where(inArray(paymentEvents.id, receiptIds));
    }
    if (organizationId) {
      await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    }
    if (catalogId) {
      await database.db
        .delete(commercialCatalogVersions)
        .where(eq(commercialCatalogVersions.id, catalogId));
    }
    await database.client.end();
  }
});
