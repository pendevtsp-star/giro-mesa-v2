import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, identities, outboxEvents } from "@giromesa/db";
import { encryptionKey, encryptSecret } from "@giromesa/domain";
import { eq } from "drizzle-orm";
import { OutboxWorker } from "./outbox.js";

test("decrypts and delivers a password reset once through Resend", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("WORKER_DATABASE_URL not configured");
    return;
  }

  const previousEnvironment = { ...process.env };
  const previousFetch = globalThis.fetch;
  process.env.DATABASE_URL = databaseUrl;
  process.env.EMAIL_PROVIDER_ENABLED = "true";
  process.env.EMAIL_PROVIDER_CREDENTIAL_REFERENCE = "resend";
  process.env.RESEND_API_KEY = "re_integration_test_key";
  process.env.RESEND_FROM = "GiroMesa <test@example.test>";
  process.env.APP_URL = "https://site.example.test";
  process.env.API_URL = "https://api.example.test";
  process.env.OUTBOX_ENCRYPTION_KEY = randomBytes(32).toString("base64");

  const requests: Array<{ headers: Headers; payload: Record<string, unknown> }> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push({
      headers: new Headers(init?.headers),
      payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ id: "resend-integration-message" }), { status: 200 });
  };

  const database = createDatabase(databaseUrl);
  let worker: OutboxWorker | undefined;
  let identityId: string | undefined;
  let eventId: string | undefined;
  try {
    const [identity] = await database.db
      .insert(identities)
      .values({
        displayName: "Email Integration",
        email: `email-${randomUUID()}@example.test`,
      })
      .returning();
    assert.ok(identity);
    identityId = identity.id;
    const token = randomBytes(32).toString("base64url");
    const [event] = await database.db
      .insert(outboxEvents)
      .values({
        topic: "auth.password_reset_requested",
        aggregateType: "identity",
        aggregateId: identity.id,
        payload: {
          identityId: identity.id,
          resetTokenEnvelope: encryptSecret(
            token,
            encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
            `identity:${identity.id}`,
          ),
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        },
      })
      .returning();
    assert.ok(event);
    eventId = event.id;

    worker = new OutboxWorker();
    assert.equal(await worker.runOnce(1), 1);
    const [processed] = await database.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, event.id));

    assert.ok(processed?.processedAt);
    assert.equal(processed.lastError, null);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.headers.get("Idempotency-Key"), `password-reset/${event.id}`);
    assert.equal(Array.isArray(requests[0]?.payload.to), true);
    assert.match(String(requests[0]?.payload.text), new RegExp(token));
    assert.doesNotMatch(JSON.stringify(event.payload), new RegExp(token));
  } finally {
    if (worker) await worker.close();
    if (eventId) await database.db.delete(outboxEvents).where(eq(outboxEvents.id, eventId));
    if (identityId) await database.db.delete(identities).where(eq(identities.id, identityId));
    await database.client.end();
    globalThis.fetch = previousFetch;
    for (const name of Object.keys(process.env)) {
      if (!(name in previousEnvironment)) delete process.env[name];
    }
    Object.assign(process.env, previousEnvironment);
  }
});
