import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  financialLedgerEntries,
  financialLedgerTransactions,
  identities,
  memberships,
  organizations,
  paymentIntents,
  paymentProviderEvents,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { SimulatorPaymentAdapter } from "./adapters/simulator.adapter.js";
import { PaymentsService } from "./payments.service.js";

function hasCode(expected: string) {
  return (error: unknown) => {
    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    return (
      typeof response === "object" &&
      response !== null &&
      (response as { code?: string }).code === expected
    );
  };
}

it("persists a balanced append-only ledger with idempotency and tenant scope", async (context) => {
  const databaseUrl = process.env.PAYMENTS_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PAYMENTS_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const database = new DatabaseService();
  try {
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Ledger Test Ltda",
        tradeName: "Ledger Test",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Ledger Unit" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `ledger-${randomUUID()}@example.test`, displayName: "Ledger Owner" })
      .returning();
    assert.ok(unit && identity);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: identity.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });

    const payments = new PaymentsService(database, new ScopeService(database));
    const input = {
      kind: "sale" as const,
      referenceType: "order",
      referenceId: randomUUID(),
      entries: [
        { account: "accounts_receivable", debitCents: 1_100, creditCents: 0 },
        { account: "sales_revenue", debitCents: 0, creditCents: 1_000 },
        { account: "service_fee_payable", debitCents: 0, creditCents: 100 },
      ],
    };
    const posted = await payments.postLedger(
      identity.id,
      organization.id,
      unit.id,
      "ledger-sale-0001",
      input,
    );
    const replay = await payments.postLedger(
      identity.id,
      organization.id,
      unit.id,
      "ledger-sale-0001",
      input,
    );
    assert.equal(replay.transactionId, posted.transactionId);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(
      (
        await database.db
          .select()
          .from(financialLedgerEntries)
          .where(eq(financialLedgerEntries.transactionId, posted.transactionId))
      ).length,
      3,
    );

    const reversed = await payments.reverseLedger(
      identity.id,
      organization.id,
      unit.id,
      "ledger-reversal-0001",
      posted.transactionId,
      "refund",
      randomUUID(),
    );
    assert.equal(reversed.kind, "reversal");
    assert.equal(reversed.reversalOf, posted.transactionId);

    const [organizationB] = await database.db
      .insert(organizations)
      .values({
        legalName: "Ledger Other Ltda",
        tradeName: "Ledger Other",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      })
      .returning();
    assert.ok(organizationB);
    const [unitB] = await database.db
      .insert(units)
      .values({ organizationId: organizationB.id, name: "Other Ledger Unit" })
      .returning();
    const [identityB] = await database.db
      .insert(identities)
      .values({ email: `ledger-other-${randomUUID()}@example.test`, displayName: "Other Owner" })
      .returning();
    assert.ok(unitB && identityB);
    const [membershipB] = await database.db
      .insert(memberships)
      .values({ identityId: identityB.id, organizationId: organizationB.id, status: "active" })
      .returning();
    assert.ok(membershipB);
    await database.db.insert(roleBindings).values({ membershipId: membershipB.id, role: "owner" });
    const otherPosting = await payments.postLedger(
      identityB.id,
      organizationB.id,
      unitB.id,
      "ledger-other-0001",
      { ...input, referenceId: randomUUID() },
    );
    const visibleToA = await database.withTenantContext(
      {
        source: "http",
        organizationId: organization.id,
        unitId: unit.id,
        actorIdentityId: identity.id,
      },
      (tenantDb) => tenantDb.select().from(financialLedgerTransactions),
    );
    assert.equal(
      visibleToA.some((entry) => entry.id === otherPosting.transactionId),
      false,
    );
    assert.deepEqual(
      new Set(visibleToA.map((entry) => entry.organizationId)),
      new Set([organization.id]),
    );

    const simulator = new SimulatorPaymentAdapter();
    simulator.setScenario("payment-attempt-unknown", "unknown_then_authorized");
    const uncertainPayments = new PaymentsService(database, new ScopeService(database), simulator);
    const intent = await uncertainPayments.createPaymentIntent(
      identity.id,
      organization.id,
      unit.id,
      "payment-intent-0001",
      { sourceType: "order", sourceId: randomUUID(), amountCents: 2_500 },
    );
    const unknown = await uncertainPayments.executePaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      "payment-attempt-unknown",
      { intentId: intent.intentId, amountCents: 2_500, method: "credit" },
    );
    assert.equal(unknown.status, "unknown");
    assert.equal(unknown.reviewRequired, true);
    await assert.rejects(
      () =>
        uncertainPayments.executePaymentAttempt(
          identity.id,
          organization.id,
          unit.id,
          "payment-attempt-blocked",
          { intentId: intent.intentId, amountCents: 2_500, method: "credit" },
        ),
      hasCode("PAYMENT_OUTCOME_UNKNOWN"),
    );
    const reconciled = await uncertainPayments.reconcilePaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      unknown.attemptId,
    );
    assert.equal(reconciled.status, "authorized");
    assert.equal(reconciled.intentStatus, "paid");

    const callbackKey = "payment-attempt-callback";
    simulator.setScenario(callbackKey, "unknown_then_authorized");
    const callbackIntent = await uncertainPayments.createPaymentIntent(
      identity.id,
      organization.id,
      unit.id,
      "payment-intent-callback",
      { sourceType: "order", sourceId: randomUUID(), amountCents: 1_200 },
    );
    const callbackAttempt = await uncertainPayments.executePaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      callbackKey,
      { intentId: callbackIntent.intentId, amountCents: 1_200, method: "credit" },
    );
    const previousSecret = process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET;
    process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET = "callback-secret-with-at-least-32-bytes";
    const callbackInput = {
      attemptId: callbackAttempt.attemptId,
      providerEventId: `provider-event-${randomUUID()}`,
      status: "authorized" as const,
      providerReference: callbackAttempt.providerReference ?? undefined,
      amountCents: 1_200,
      safePayload: { network: "simulator" },
    };
    try {
      await assert.rejects(
        () =>
          uncertainPayments.handleProviderCallback(
            "api-simulator",
            "invalid-signature",
            organization.id,
            unit.id,
            callbackInput,
          ),
        hasCode("PAYMENT_CALLBACK_UNAUTHORIZED"),
      );

      await database.db
        .update(paymentIntents)
        .set({ capturedCents: 1_200, status: "paid" })
        .where(eq(paymentIntents.id, callbackIntent.intentId));
      await assert.rejects(() =>
        uncertainPayments.handleProviderCallback(
          "api-simulator",
          process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET as string,
          organization.id,
          unit.id,
          callbackInput,
        ),
      );
      assert.equal(
        (
          await database.db
            .select()
            .from(paymentProviderEvents)
            .where(eq(paymentProviderEvents.providerEventId, callbackInput.providerEventId))
        ).length,
        0,
      );

      await database.db
        .update(paymentIntents)
        .set({ capturedCents: 0, status: "pending" })
        .where(eq(paymentIntents.id, callbackIntent.intentId));
      const applied = await uncertainPayments.handleProviderCallback(
        "api-simulator",
        process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET,
        organization.id,
        unit.id,
        callbackInput,
      );
      const replay = await uncertainPayments.handleProviderCallback(
        "api-simulator",
        process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET,
        organization.id,
        unit.id,
        callbackInput,
      );
      assert.equal(applied.status, "authorized");
      assert.equal(replay.status, "authorized");
      assert.equal(replay.idempotentReplay, true);
      assert.equal(
        (
          await database.db
            .select()
            .from(paymentProviderEvents)
            .where(eq(paymentProviderEvents.providerEventId, callbackInput.providerEventId))
        ).length,
        1,
      );
    } finally {
      if (previousSecret === undefined) delete process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET;
      else process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET = previousSecret;
    }
    await assert.rejects(() =>
      database.db
        .update(financialLedgerTransactions)
        .set({ referenceId: "mutated" })
        .where(eq(financialLedgerTransactions.id, posted.transactionId)),
    );
  } finally {
    await database.onModuleDestroy();
  }
});
