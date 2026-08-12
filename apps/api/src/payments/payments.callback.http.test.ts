import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { it } from "node:test";
import { identities, memberships, organizations, roleBindings, units } from "@giromesa/db";
import { sql } from "drizzle-orm";
import { createApplication } from "../app-factory.js";
import { DatabaseService } from "../database/database.module.js";
import { SimulatorPaymentAdapter } from "./adapters/simulator.adapter.js";
import { PaymentsService } from "./payments.service.js";

it("authenticates provider callbacks and derives tenant scope through a least-privilege boundary", async (context) => {
  const databaseUrl = process.env.PAYMENT_CALLBACK_HTTP_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PAYMENT_CALLBACK_HTTP_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const previousSecret = process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET;
  process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET = "callback-secret-with-at-least-32-bytes";
  const { app } = await createApplication();
  try {
    await app.init();
    const database = app.get(DatabaseService);
    const payments = app.get(PaymentsService);
    const adapter = app.get(SimulatorPaymentAdapter);
    const [organization] = await database.db
      .insert(organizations)
      .values({
        legalName: "Callback HTTP Test Ltda",
        tradeName: "Callback HTTP Test",
        document: String(randomInt(10_000_000_000_000, 99_999_999_999_999)),
      })
      .returning();
    assert.ok(organization);
    const [unit] = await database.db
      .insert(units)
      .values({ organizationId: organization.id, name: "Callback HTTP Unit" })
      .returning();
    const [identity] = await database.db
      .insert(identities)
      .values({ email: `callback-http-${randomUUID()}@example.test`, displayName: "Owner" })
      .returning();
    assert.ok(unit && identity);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId: identity.id, organizationId: organization.id, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "owner" });

    const privileges = await database.db.execute<{
      internal_select: boolean;
      internal_execute: boolean;
    }>(sql`
      select
        has_table_privilege('giromesa_internal', 'payment_attempts', 'select') internal_select,
        has_function_privilege(
          'giromesa_internal',
          'giromesa_payment_callback_scope(uuid, character varying)',
          'execute'
        ) internal_execute
    `);
    assert.deepEqual([...privileges][0], { internal_select: false, internal_execute: true });

    const attemptKey = `callback-http-attempt-${randomUUID()}`;
    adapter.setScenario(attemptKey, "unknown_then_authorized");
    const intent = await payments.createPaymentIntent(
      identity.id,
      organization.id,
      unit.id,
      `callback-http-intent-${randomUUID()}`,
      { sourceType: "order", sourceId: randomUUID(), amountCents: 1_200 },
    );
    const attempt = await payments.executePaymentAttempt(
      identity.id,
      organization.id,
      unit.id,
      attemptKey,
      { intentId: intent.intentId, amountCents: 1_200, method: "credit" },
    );
    const callback = {
      attemptId: attempt.attemptId,
      providerEventId: `provider-event-${randomUUID()}`,
      status: "authorized",
      providerReference: attempt.providerReference,
      amountCents: 1_200,
      safePayload: { network: "simulator" },
    };
    const applied = await app.inject({
      method: "POST",
      url: "/api/v1/payment-provider-callbacks/api-simulator",
      headers: { "x-provider-signature": process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET },
      payload: callback,
    });
    assert.equal(applied.statusCode, 201, applied.body);
    assert.equal(applied.json().status, "authorized");
    assert.equal(applied.json().intentStatus, "paid");

    const replay = await app.inject({
      method: "POST",
      url: "/v1/payment-provider-callbacks/api-simulator",
      headers: { "x-provider-signature": process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET },
      payload: callback,
    });
    assert.equal(replay.statusCode, 201, replay.body);
    assert.equal(replay.json().idempotentReplay, true);

    const forgedScope = await app.inject({
      method: "POST",
      url: "/api/v1/payment-provider-callbacks/api-simulator",
      headers: { "x-provider-signature": process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET },
      payload: { ...callback, organizationId: randomUUID(), unitId: randomUUID() },
    });
    assert.equal(forgedScope.statusCode, 400, forgedScope.body);
  } finally {
    await app.close();
    if (previousSecret === undefined) delete process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET;
    else process.env.PAYMENT_SIMULATOR_CALLBACK_SECRET = previousSecret;
  }
});
