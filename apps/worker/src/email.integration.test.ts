import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase, identities, outboxEvents } from "@giromesa/db";
import { encryptionKey, encryptSecret } from "@giromesa/domain";
import { eq } from "drizzle-orm";
import { OutboxWorker } from "./outbox.js";

test("decrypts and idempotently delivers auth e-mails through Resend", async (context) => {
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
  const eventIds: string[] = [];
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
    eventIds.push(event.id);

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

    const verificationToken = randomBytes(32).toString("base64url");
    const verificationEventId = randomUUID();
    const [verificationEvent] = await database.db
      .insert(outboxEvents)
      .values({
        id: verificationEventId,
        topic: "auth.email_verification_requested",
        aggregateType: "identity",
        aggregateId: identity.id,
        payload: {
          identityId: identity.id,
          verificationTokenEnvelope: encryptSecret(
            verificationToken,
            encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
            `email-verification:${identity.id}:${verificationEventId}`,
          ),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      })
      .returning();
    assert.ok(verificationEvent);
    eventIds.push(verificationEvent.id);
    assert.equal(await worker.runOnce(1), 1);
    assert.equal(await worker.runOnce(1), 0);
    assert.equal(requests.length, 2);
    assert.equal(
      requests[1]?.headers.get("Idempotency-Key"),
      `email-verification/${verificationEvent.id}`,
    );
    assert.match(String(requests[1]?.payload.subject), /Confirme seu e-mail/);
    assert.match(String(requests[1]?.payload.text), new RegExp(verificationToken));
    assert.match(
      String(requests[1]?.payload.text),
      new RegExp(`/verificar-email#token=${verificationToken}`),
    );
    assert.doesNotMatch(String(requests[1]?.payload.text), /verificar-email\?token=/);
    assert.doesNotMatch(JSON.stringify(verificationEvent.payload), new RegExp(verificationToken));

    const queueVerificationProbe = async (options: {
      aggregateId?: string;
      expiresAt?: Date;
      aadEventId?: string;
      expectedError?: RegExp;
    }) => {
      const id = randomUUID();
      const probeToken = randomBytes(32).toString("base64url");
      const [probe] = await database.db
        .insert(outboxEvents)
        .values({
          id,
          topic: "auth.email_verification_requested",
          aggregateType: "identity",
          aggregateId: options.aggregateId ?? identity.id,
          payload: {
            identityId: identity.id,
            verificationTokenEnvelope: encryptSecret(
              probeToken,
              encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
              `email-verification:${identity.id}:${options.aadEventId ?? id}`,
            ),
            expiresAt: (options.expiresAt ?? new Date(Date.now() + 60_000)).toISOString(),
          },
        })
        .returning();
      assert.ok(probe);
      eventIds.push(probe.id);
      const requestCount = requests.length;
      assert.equal(await worker?.runOnce(1), 1);
      const [processedProbe] = await database.db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, probe.id));
      assert.ok(processedProbe?.processedAt);
      assert.equal(requests.length, requestCount);
      if (options.expectedError) {
        assert.match(String(processedProbe.lastError), options.expectedError);
      } else {
        assert.equal(processedProbe.lastError, null);
      }
    };

    await queueVerificationProbe({
      aggregateId: randomUUID(),
      expectedError: /DEAD_LETTER:EMAIL_EVENT_CONTEXT_INVALID/,
    });
    await queueVerificationProbe({
      expiresAt: new Date(Date.now() - 1_000),
      expectedError: /DEAD_LETTER:EMAIL_LINK_EXPIRED/,
    });
    await queueVerificationProbe({
      aadEventId: randomUUID(),
      expectedError: /DEAD_LETTER:EMAIL_SECRET_DECRYPTION_FAILED/,
    });
    await database.db
      .update(identities)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(identities.id, identity.id));
    await queueVerificationProbe({});
  } finally {
    if (worker) await worker.close();
    for (const eventId of eventIds) {
      await database.db.delete(outboxEvents).where(eq(outboxEvents.id, eventId));
    }
    if (identityId) await database.db.delete(identities).where(eq(identities.id, identityId));
    await database.client.end();
    globalThis.fetch = previousFetch;
    for (const name of Object.keys(process.env)) {
      if (!(name in previousEnvironment)) delete process.env[name];
    }
    Object.assign(process.env, previousEnvironment);
  }
});
