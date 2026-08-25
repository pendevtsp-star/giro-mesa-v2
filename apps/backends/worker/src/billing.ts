import {
  auditEvents,
  billingCheckouts,
  billingUpgradeQuotes,
  charges,
  commercialPlans,
  type GiroMesaDatabase,
  organizations,
  outboxEvents,
  paymentEvents,
  providerCustomers,
  subscriptions,
} from "@giromesa/db";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { ClaimedOutboxEvent } from "./outbox.js";

type Database = GiroMesaDatabase["db"];
type Json = Record<string, unknown>;

export class BillingDeliveryError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "BillingDeliveryError";
  }
}

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function date(value: unknown): Date | null {
  const parsed = string(value);
  if (!parsed) return null;
  const result = new Date(parsed);
  return Number.isNaN(result.valueOf()) ? null : result;
}

function paymentMethod(value: unknown): "credit_card" | "pix" | null {
  const normalized = string(value)?.toUpperCase();
  if (normalized === "CREDIT_CARD") return "credit_card";
  return normalized === "PIX" ? "pix" : null;
}

async function requestDoseClubProvisioning(
  db: Database,
  organizationId: string,
  subscriptionId: string,
) {
  await db.insert(outboxEvents).values({
    topic: "doseclub.provisioning_requested",
    aggregateType: "subscription",
    aggregateId: subscriptionId,
    payload: { organizationId, subscriptionId },
  });
}

export function nextBillingPeriod(start: Date, cycle: "monthly" | "annual") {
  const next = new Date(start);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + (cycle === "monthly" ? 1 : 12));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function checkoutPayload(payload: Json) {
  const checkout = record(payload.checkout ?? payload.checkoutSession);
  return {
    id: string(checkout.id),
    externalReference: string(checkout.externalReference),
    customerId: string(checkout.customer) ?? string(record(checkout.customerData).id),
    subscriptionId: string(record(checkout.subscription).id) ?? string(checkout.subscriptionId),
    method: paymentMethod(checkout.billingType ?? record(payload.payment).billingType),
  };
}

function paymentPayload(payload: Json) {
  const payment = record(payload.payment);
  return {
    id: string(payment.id),
    status: string(payment.status),
    subscriptionId: string(payment.subscription),
    externalReference: string(payment.externalReference),
    amountCents: cents(payment.value),
    dueAt: date(payment.dueDate),
    paidAt: date(payment.paymentDate ?? payment.confirmedDate),
    method: paymentMethod(payment.billingType),
    paymentUrl:
      string(payment.invoiceUrl) ??
      string(payment.bankSlipUrl) ??
      string(payment.transactionReceiptUrl),
  };
}

function checkoutStatus(eventType: string) {
  if (eventType === "CHECKOUT_PAID") return "paid";
  if (eventType === "CHECKOUT_CANCELED") return "canceled";
  if (eventType === "CHECKOUT_EXPIRED") return "expired";
  return null;
}

function chargeStatus(eventType: string, providerStatus: string | null) {
  const normalized = providerStatus?.toUpperCase();
  if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"].includes(normalized ?? "")) return "paid";
  if (["REFUNDED", "PARTIALLY_REFUNDED", "REFUND_REQUESTED"].includes(normalized ?? ""))
    return "refunded";
  if (["DELETED", "CANCELED"].includes(normalized ?? "")) return "canceled";
  if (normalized === "OVERDUE") return "overdue";
  if (["PAYMENT_RECEIVED", "PAYMENT_CONFIRMED"].includes(eventType)) return "paid";
  if (eventType === "PAYMENT_OVERDUE") return "overdue";
  if (["PAYMENT_REFUNDED", "PAYMENT_PARTIALLY_REFUNDED"].includes(eventType)) return "refunded";
  if (["PAYMENT_DELETED", "PAYMENT_CANCELED"].includes(eventType)) return "canceled";
  if (["PAYMENT_CREATED", "PAYMENT_UPDATED", "PAYMENT_AWAITING_RISK_ANALYSIS"].includes(eventType))
    return "pending";
  return null;
}

export function resolvedChargeStatus(current: string | null, incoming: string) {
  const rank: Record<string, number> = {
    pending: 0,
    overdue: 1,
    paid: 2,
    canceled: 3,
    refunded: 3,
  };
  if (!current || !(current in rank)) return incoming;
  return (rank[incoming] ?? 0) >= (rank[current] ?? 0) ? incoming : current;
}

async function findCheckout(db: Database, payload: ReturnType<typeof checkoutPayload>) {
  const byProvider = payload.id ? eq(billingCheckouts.providerCheckoutId, payload.id) : null;
  const byReference = payload.externalReference
    ? eq(billingCheckouts.id, payload.externalReference)
    : null;
  const predicate =
    byProvider && byReference ? and(byProvider, byReference) : (byProvider ?? byReference);
  if (!predicate) return null;
  const [checkout] = await db.select().from(billingCheckouts).where(predicate).limit(1);
  return checkout ?? null;
}

async function activateSubscriptionCheckout(
  db: Database,
  checkout: typeof billingCheckouts.$inferSelect,
  payload: ReturnType<typeof checkoutPayload>,
  now: Date,
) {
  if (!checkout.targetCommercialPlanId || !checkout.cycle || !checkout.amountCents) {
    throw new BillingDeliveryError("BILLING_CHECKOUT_CONTEXT_INVALID", false);
  }
  let providerCustomerId: string | null = null;
  if (payload.customerId) {
    const [existing] = await db
      .select()
      .from(providerCustomers)
      .where(
        and(
          eq(providerCustomers.provider, checkout.provider),
          eq(providerCustomers.providerCustomerId, payload.customerId),
        ),
      )
      .limit(1);
    if (existing && existing.organizationId !== checkout.organizationId) {
      throw new BillingDeliveryError("BILLING_PROVIDER_CUSTOMER_SCOPE_MISMATCH", false);
    }
    if (existing) providerCustomerId = existing.id;
    else {
      const [created] = await db
        .insert(providerCustomers)
        .values({
          organizationId: checkout.organizationId,
          provider: checkout.provider,
          providerCustomerId: payload.customerId,
        })
        .returning({ id: providerCustomers.id });
      providerCustomerId = created?.id ?? null;
    }
  }
  const periodEndsAt = nextBillingPeriod(now, checkout.cycle);
  const [subscription] = await db
    .insert(subscriptions)
    .values({
      organizationId: checkout.organizationId,
      commercialPlanId: checkout.targetCommercialPlanId,
      providerCustomerId,
      provider: checkout.provider,
      providerSubscriptionId: payload.subscriptionId,
      cycle: checkout.cycle,
      state: "active",
      contractedPriceCents: checkout.amountCents,
      paymentMethod: payload.method,
      currentPeriodStartsAt: now,
      currentPeriodEndsAt: periodEndsAt,
    })
    .returning({ id: subscriptions.id });
  if (!subscription) throw new BillingDeliveryError("BILLING_SUBSCRIPTION_NOT_CREATED", true);
  await db
    .update(billingCheckouts)
    .set({ subscriptionId: subscription.id, confirmedAt: now, updatedAt: now })
    .where(eq(billingCheckouts.id, checkout.id));
  await db
    .update(organizations)
    .set({
      billingState: "active",
      billingStateChangedAt: now,
      operationalClosureUntil: null,
      updatedAt: now,
    })
    .where(eq(organizations.id, checkout.organizationId));
  await db.insert(auditEvents).values({
    organizationId: checkout.organizationId,
    action: "billing.subscription_activated",
    entityType: "subscription",
    entityId: subscription.id,
    metadata: { checkoutId: checkout.id, planId: checkout.targetCommercialPlanId },
  });
  await requestDoseClubProvisioning(db, checkout.organizationId, subscription.id);
}

async function applyUpgradeCheckout(
  db: Database,
  checkout: typeof billingCheckouts.$inferSelect,
  now: Date,
) {
  if (!checkout.subscriptionId || !checkout.targetCommercialPlanId || !checkout.upgradeQuoteId) {
    throw new BillingDeliveryError("BILLING_UPGRADE_CONTEXT_INVALID", false);
  }
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.id, checkout.subscriptionId),
        eq(subscriptions.organizationId, checkout.organizationId),
      ),
    )
    .limit(1);
  const [plan] = await db
    .select()
    .from(commercialPlans)
    .where(eq(commercialPlans.id, checkout.targetCommercialPlanId))
    .limit(1);
  if (!subscription || !plan)
    throw new BillingDeliveryError("BILLING_UPGRADE_TARGET_MISSING", false);
  const contractedPriceCents =
    subscription.cycle === "annual" ? plan.annualPriceCents : plan.monthlyPriceCents;
  await db
    .update(subscriptions)
    .set({
      commercialPlanId: plan.id,
      contractedPriceCents,
      reconciliationStatus: subscription.providerSubscriptionId ? "pending" : "not_required",
      reconciliationError: null,
      updatedAt: now,
    })
    .where(eq(subscriptions.id, subscription.id));
  await db
    .update(billingUpgradeQuotes)
    .set({ status: "consumed" })
    .where(eq(billingUpgradeQuotes.id, checkout.upgradeQuoteId));
  if (subscription.providerSubscriptionId) {
    await db.insert(outboxEvents).values({
      topic: "billing.subscription_sync_requested",
      aggregateType: "subscription",
      aggregateId: subscription.id,
      payload: {
        organizationId: checkout.organizationId,
        subscriptionId: subscription.id,
        targetPlanId: plan.id,
        valueCents: contractedPriceCents,
        cycle: subscription.cycle,
      },
    });
  }
  await db.insert(auditEvents).values({
    organizationId: checkout.organizationId,
    action: "billing.upgrade_applied",
    entityType: "subscription",
    entityId: subscription.id,
    metadata: { checkoutId: checkout.id, targetPlanId: plan.id, contractedPriceCents },
  });
  await requestDoseClubProvisioning(db, checkout.organizationId, subscription.id);
}

async function processCheckoutEvent(db: Database, eventType: string, payload: Json, now: Date) {
  const status = checkoutStatus(eventType);
  if (!status) return false;
  const parsed = checkoutPayload(payload);
  const checkout = await findCheckout(db, parsed);
  if (!checkout) throw new BillingDeliveryError("BILLING_CHECKOUT_NOT_FOUND", true);
  if (checkout.status === "paid") return true;
  await db
    .update(billingCheckouts)
    .set({
      status,
      confirmedAt: status === "paid" ? now : checkout.confirmedAt,
      reconciliationStatus: "succeeded",
      reconciliationError: null,
      updatedAt: now,
    })
    .where(eq(billingCheckouts.id, checkout.id));
  if (status !== "paid") return true;
  if (checkout.intent === "subscribe")
    await activateSubscriptionCheckout(db, checkout, parsed, now);
  else if (checkout.intent === "upgrade") await applyUpgradeCheckout(db, checkout, now);
  else {
    await db
      .update(charges)
      .set({ status: "paid", paidAt: now })
      .where(eq(charges.billingCheckoutId, checkout.id));
    await db
      .update(organizations)
      .set({
        billingState: "active",
        billingStateChangedAt: now,
        operationalClosureUntil: null,
        updatedAt: now,
      })
      .where(eq(organizations.id, checkout.organizationId));
  }
  return true;
}

async function processPaymentEvent(db: Database, eventType: string, payload: Json, now: Date) {
  const parsed = paymentPayload(payload);
  const status = chargeStatus(eventType, parsed.status);
  if (!status) return false;
  if (!parsed.id) throw new BillingDeliveryError("BILLING_PAYMENT_ID_MISSING", false);
  let [subscription] = parsed.subscriptionId
    ? await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.providerSubscriptionId, parsed.subscriptionId))
        .limit(1)
    : [];
  if (!subscription && parsed.externalReference) {
    const [checkout] = await db
      .select()
      .from(billingCheckouts)
      .where(eq(billingCheckouts.id, parsed.externalReference))
      .limit(1);
    if (checkout?.subscriptionId) {
      [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, checkout.subscriptionId))
        .limit(1);
    }
  }
  if (!subscription) throw new BillingDeliveryError("BILLING_PAYMENT_SUBSCRIPTION_NOT_FOUND", true);
  const [existing] = await db
    .select()
    .from(charges)
    .where(eq(charges.providerChargeId, parsed.id))
    .limit(1);
  const finalStatus = resolvedChargeStatus(existing?.status ?? null, status);
  if (existing) {
    await db
      .update(charges)
      .set({
        status: finalStatus,
        amountCents: parsed.amountCents ?? existing.amountCents,
        paymentMethod: parsed.method ?? existing.paymentMethod,
        paymentUrl: parsed.paymentUrl ?? existing.paymentUrl,
        dueAt: parsed.dueAt ?? existing.dueAt,
        paidAt:
          finalStatus === "paid" ? (parsed.paidAt ?? existing.paidAt ?? now) : existing.paidAt,
      })
      .where(eq(charges.id, existing.id));
  } else {
    await db.insert(charges).values({
      subscriptionId: subscription.id,
      providerChargeId: parsed.id,
      amountCents: parsed.amountCents ?? subscription.contractedPriceCents ?? 0,
      status: finalStatus,
      paymentMethod: parsed.method,
      paymentUrl: parsed.paymentUrl,
      dueAt: parsed.dueAt ?? now,
      paidAt: finalStatus === "paid" ? (parsed.paidAt ?? now) : null,
    });
  }
  if (finalStatus === "paid") {
    const [outstanding] = await db
      .select({ id: charges.id })
      .from(charges)
      .where(
        and(
          eq(charges.subscriptionId, subscription.id),
          inArray(charges.status, ["pending", "overdue"]),
          lte(charges.dueAt, now),
        ),
      )
      .limit(1);
    if (!outstanding) {
      await db
        .update(organizations)
        .set({
          billingState: sql`case when ${organizations.billingState} in ('grace', 'restricted') then 'active' else ${organizations.billingState} end`,
          billingStateChangedAt: now,
          operationalClosureUntil: null,
          updatedAt: now,
        })
        .where(eq(organizations.id, subscription.organizationId));
    }
    const [regularization] = await db
      .update(billingCheckouts)
      .set({
        status: "paid",
        confirmedAt: now,
        reconciliationStatus: "succeeded",
        reconciliationError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(billingCheckouts.organizationId, subscription.organizationId),
          eq(billingCheckouts.provider, "asaas"),
          eq(billingCheckouts.providerCheckoutId, `payment:${parsed.id}`),
          eq(billingCheckouts.intent, "regularize"),
        ),
      )
      .returning({ id: billingCheckouts.id });
    if (regularization) {
      await db.insert(auditEvents).values({
        organizationId: subscription.organizationId,
        action: "billing.regularization_confirmed",
        entityType: "billing_checkout",
        entityId: regularization.id,
        metadata: { providerChargeId: parsed.id },
      });
    }
  } else if (finalStatus === "overdue") {
    await db
      .update(organizations)
      .set({
        billingState: sql`case when ${organizations.billingState} = 'active' then 'grace' else ${organizations.billingState} end`,
        billingStateChangedAt: now,
        updatedAt: now,
      })
      .where(eq(organizations.id, subscription.organizationId));
  }
  return true;
}

function subscriptionPayload(payload: Json) {
  const subscription = record(payload.subscription);
  const cycle = string(subscription.cycle)?.toUpperCase();
  return {
    id: string(subscription.id),
    externalReference: string(subscription.externalReference),
    status: string(subscription.status)?.toUpperCase() ?? null,
    valueCents: cents(subscription.value),
    periodEndsAt: date(subscription.nextDueDate),
    cycle:
      cycle === "MONTHLY" ? ("monthly" as const) : cycle === "YEARLY" ? ("annual" as const) : null,
    method: paymentMethod(subscription.billingType),
  };
}

async function processSubscriptionEvent(db: Database, eventType: string, payload: Json, now: Date) {
  if (!eventType.startsWith("SUBSCRIPTION_")) return false;
  const parsed = subscriptionPayload(payload);
  if (!parsed.id) throw new BillingDeliveryError("BILLING_SUBSCRIPTION_ID_MISSING", false);
  let [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.providerSubscriptionId, parsed.id))
    .limit(1);
  if (!subscription && parsed.externalReference) {
    const [checkout] = await db
      .select({ subscriptionId: billingCheckouts.subscriptionId })
      .from(billingCheckouts)
      .where(eq(billingCheckouts.id, parsed.externalReference))
      .limit(1);
    if (checkout?.subscriptionId) {
      [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, checkout.subscriptionId))
        .limit(1);
    }
  }
  if (!subscription) throw new BillingDeliveryError("BILLING_SUBSCRIPTION_NOT_FOUND", true);
  if (subscription.providerSubscriptionId && subscription.providerSubscriptionId !== parsed.id) {
    throw new BillingDeliveryError("BILLING_SUBSCRIPTION_PROVIDER_MISMATCH", false);
  }
  const canceled =
    ["SUBSCRIPTION_DELETED", "SUBSCRIPTION_INACTIVATED"].includes(eventType) ||
    ["INACTIVE", "EXPIRED"].includes(parsed.status ?? "");
  const reconciliationMatches =
    parsed.valueCents !== null && parsed.valueCents === subscription.contractedPriceCents;
  await db
    .update(subscriptions)
    .set({
      providerSubscriptionId: parsed.id,
      paymentMethod: parsed.method ?? subscription.paymentMethod,
      currentPeriodEndsAt:
        parsed.periodEndsAt &&
        (!subscription.currentPeriodStartsAt ||
          parsed.periodEndsAt > subscription.currentPeriodStartsAt)
          ? parsed.periodEndsAt
          : subscription.currentPeriodEndsAt,
      state: canceled ? "canceled" : subscription.state,
      reconciliationStatus: reconciliationMatches
        ? "succeeded"
        : subscription.reconciliationStatus === "pending" && parsed.valueCents !== null
          ? "failed"
          : subscription.reconciliationStatus,
      reconciliationError:
        subscription.reconciliationStatus === "pending" &&
        parsed.valueCents !== null &&
        !reconciliationMatches
          ? "ASAAS_SUBSCRIPTION_VALUE_MISMATCH"
          : reconciliationMatches
            ? null
            : subscription.reconciliationError,
      updatedAt: now,
    })
    .where(eq(subscriptions.id, subscription.id));
  if (canceled) {
    await db
      .update(organizations)
      .set({ billingState: "canceled", billingStateChangedAt: now, updatedAt: now })
      .where(eq(organizations.id, subscription.organizationId));
  }
  await db.insert(auditEvents).values({
    organizationId: subscription.organizationId,
    action: canceled ? "billing.subscription_canceled" : "billing.subscription_synchronized",
    entityType: "subscription",
    entityId: subscription.id,
    metadata: { providerSubscriptionId: parsed.id, eventType },
  });
  if (canceled) {
    await requestDoseClubProvisioning(db, subscription.organizationId, subscription.id);
  }
  return true;
}

export async function processBillingPaymentEvent(db: Database, event: ClaimedOutboxEvent) {
  const paymentEventId = string(event.payload.paymentEventId);
  if (!paymentEventId || event.aggregate_id !== paymentEventId) {
    throw new BillingDeliveryError("BILLING_PAYMENT_EVENT_CONTEXT_INVALID", false);
  }
  const [receipt] = await db
    .select()
    .from(paymentEvents)
    .where(eq(paymentEvents.id, paymentEventId))
    .limit(1);
  if (receipt?.provider !== "asaas") {
    throw new BillingDeliveryError("BILLING_PAYMENT_EVENT_NOT_FOUND", false);
  }
  if (receipt.processedAt) return;
  const now = new Date();
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`billing-event:${receipt.providerEventId}`}, 0))`,
      );
      const [currentReceipt] = await tx
        .select()
        .from(paymentEvents)
        .where(eq(paymentEvents.id, receipt.id))
        .limit(1);
      if (!currentReceipt || currentReceipt.processedAt) return;
      const handled =
        (await processCheckoutEvent(tx, currentReceipt.eventType, currentReceipt.payload, now)) ||
        (await processSubscriptionEvent(
          tx,
          currentReceipt.eventType,
          currentReceipt.payload,
          now,
        )) ||
        (await processPaymentEvent(tx, currentReceipt.eventType, currentReceipt.payload, now));
      await tx
        .update(paymentEvents)
        .set({
          processedAt: now,
          processingAttempts: sql`${paymentEvents.processingAttempts} + 1`,
          lastProcessingError: handled ? null : `IGNORED:${currentReceipt.eventType}`,
        })
        .where(and(eq(paymentEvents.id, receipt.id), sql`${paymentEvents.processedAt} is null`));
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 2_000) : "UNKNOWN";
    await db
      .update(paymentEvents)
      .set({
        processingAttempts: sql`${paymentEvents.processingAttempts} + 1`,
        lastProcessingError: message,
      })
      .where(eq(paymentEvents.id, receipt.id));
    throw error;
  }
}

function requiredString(payload: Json, key: string) {
  const value = string(payload[key]);
  if (!value) throw new BillingDeliveryError(`BILLING_SYNC_${key.toUpperCase()}_INVALID`, false);
  return value;
}

export async function reconcileBillingCheckout(db: Database, event: ClaimedOutboxEvent) {
  const checkoutId = requiredString(event.payload, "checkoutId");
  const organizationId = requiredString(event.payload, "organizationId");
  if (
    event.aggregate_type !== "billing_checkout" ||
    event.aggregate_id !== checkoutId ||
    string(event.payload.provider) !== "asaas"
  ) {
    throw new BillingDeliveryError("BILLING_RECONCILIATION_CONTEXT_INVALID", false);
  }
  const [checkout] = await db
    .select()
    .from(billingCheckouts)
    .where(
      and(eq(billingCheckouts.id, checkoutId), eq(billingCheckouts.organizationId, organizationId)),
    )
    .limit(1);
  if (!checkout) throw new BillingDeliveryError("BILLING_CHECKOUT_NOT_FOUND", false);
  if (["paid", "canceled", "expired"].includes(checkout.status)) return;
  const firstAlert = checkout.reconciliationStatus !== "failed";
  await db
    .update(billingCheckouts)
    .set({
      reconciliationStatus: "failed",
      reconciliationError: "ASAAS_CHECKOUT_RESULT_UNKNOWN",
      updatedAt: new Date(),
    })
    .where(eq(billingCheckouts.id, checkout.id));
  if (firstAlert) {
    await db.insert(auditEvents).values({
      organizationId,
      action: "billing.checkout_reconciliation_required",
      entityType: "billing_checkout",
      entityId: checkout.id,
      metadata: { outboxEventId: event.id, provider: "asaas" },
    });
  }
  throw new BillingDeliveryError("ASAAS_CHECKOUT_RESULT_UNKNOWN", true);
}

export async function syncBillingSubscription(db: Database, event: ClaimedOutboxEvent) {
  const subscriptionId = requiredString(event.payload, "subscriptionId");
  const targetPlanId = requiredString(event.payload, "targetPlanId");
  const valueCents = event.payload.valueCents;
  const cycle = event.payload.cycle;
  if (
    event.aggregate_type !== "subscription" ||
    event.aggregate_id !== subscriptionId ||
    typeof valueCents !== "number" ||
    !Number.isInteger(valueCents) ||
    valueCents <= 0 ||
    (cycle !== "monthly" && cycle !== "annual")
  ) {
    throw new BillingDeliveryError("BILLING_SYNC_CONTEXT_INVALID", false);
  }
  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  if (
    !subscription ||
    subscription.commercialPlanId !== targetPlanId ||
    subscription.contractedPriceCents !== valueCents ||
    subscription.cycle !== cycle ||
    !subscription.providerSubscriptionId
  ) {
    throw new BillingDeliveryError("BILLING_SYNC_SUBSCRIPTION_MISMATCH", false);
  }
  const baseUrl = process.env.ASAAS_API_URL?.trim();
  const apiKey = process.env.ASAAS_API_KEY?.trim();
  const failConfiguration = async (code: string) => {
    await db
      .update(subscriptions)
      .set({ reconciliationStatus: "failed", reconciliationError: code, updatedAt: new Date() })
      .where(eq(subscriptions.id, subscription.id));
    throw new BillingDeliveryError(code, false);
  };
  if (!baseUrl || !apiKey) return failConfiguration("ASAAS_DISABLED");
  let endpoint: URL;
  try {
    endpoint = new URL(
      `${baseUrl.replace(/\/$/, "")}/subscriptions/${encodeURIComponent(subscription.providerSubscriptionId)}`,
    );
  } catch {
    return failConfiguration("ASAAS_URL_INVALID");
  }
  if (process.env.NODE_ENV === "production" && endpoint.protocol !== "https:") {
    return failConfiguration("ASAAS_URL_INSECURE");
  }
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "PUT",
      headers: {
        accept: "application/json",
        access_token: apiKey,
        "content-type": "application/json",
        "user-agent": "GiroMesa-Worker/2.0",
      },
      body: JSON.stringify({
        value: valueCents / 100,
        cycle: cycle === "monthly" ? "MONTHLY" : "YEARLY",
        updatePendingPayments: false,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    await db
      .update(subscriptions)
      .set({
        reconciliationStatus: "failed",
        reconciliationError: "ASAAS_UNAVAILABLE",
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscription.id));
    throw new BillingDeliveryError("ASAAS_UNAVAILABLE", true);
  }
  if (!response.ok) {
    const code = `ASAAS_SYNC_HTTP_${response.status}`;
    await db
      .update(subscriptions)
      .set({ reconciliationStatus: "failed", reconciliationError: code, updatedAt: new Date() })
      .where(eq(subscriptions.id, subscription.id));
    throw new BillingDeliveryError(code, response.status === 429 || response.status >= 500);
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(subscriptions)
      .set({ reconciliationStatus: "succeeded", reconciliationError: null, updatedAt: now })
      .where(eq(subscriptions.id, subscription.id));
    await tx.insert(auditEvents).values({
      organizationId: subscription.organizationId,
      action: "billing.subscription_reconciled",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: { targetPlanId, valueCents, cycle },
    });
  });
}
