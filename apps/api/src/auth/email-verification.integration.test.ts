import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  authSessions,
  createDatabase,
  emailVerificationRequests,
  emailVerificationTokens,
  identities,
  outboxEvents,
} from "@giromesa/db";
import { decryptSecret, encryptionKey, type SecretEnvelope } from "@giromesa/domain";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { AuthService } from "./auth.service.js";

const integrationUrl = process.env.EMAIL_VERIFICATION_DATABASE_URL;
const migrationsDirectory = fileURLToPath(
  new URL("../../../../packages/db/drizzle/", import.meta.url),
);

function applicationUrl(ownerUrl: string, user: string, password: string) {
  const url = new URL(ownerUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

async function applyMigration(client: ReturnType<typeof createDatabase>["client"], file: string) {
  const source = await readFile(`${migrationsDirectory}${file}`, "utf8");
  const statements = source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await client.begin(async (transaction) => {
    for (const statement of statements) await transaction.unsafe(statement);
  });
}

describe("email verification", () => {
  const suffix = randomUUID().replaceAll("-", "");
  const databaseName = `giromesa_email_${suffix}`;
  const loginRole = `giromesa_email_test_${suffix}`;
  const password = `email-test-${suffix}`;
  const owner = integrationUrl ? createDatabase(integrationUrl) : undefined;
  let appConnection: ReturnType<typeof createDatabase> | undefined;
  let testOwner: ReturnType<typeof createDatabase> | undefined;
  let database: DatabaseService | undefined;
  let auth: AuthService | undefined;
  let databaseUrl: URL | undefined;
  const previousEnvironment = { ...process.env };

  before(async () => {
    if (!integrationUrl || !owner) return;
    databaseUrl = new URL(integrationUrl);
    databaseUrl.pathname = `/${databaseName}`;
    await owner.client.unsafe(`create database "${databaseName}"`);
    const migrator = createDatabase(databaseUrl.toString(), { max: 1 });
    try {
      const migrations = (await readdir(migrationsDirectory))
        .filter((file) => /^\d{4}_.+\.sql$/.test(file))
        .sort();
      for (const file of migrations) await applyMigration(migrator.client, file);
      await migrator.client.unsafe(
        `create role "${loginRole}" login password '${password}' noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
      );
      await migrator.client.unsafe(
        `grant giromesa_identity, giromesa_worker, giromesa_app to "${loginRole}"`,
      );
    } finally {
      await migrator.client.end();
    }
    appConnection = createDatabase(applicationUrl(databaseUrl.toString(), loginRole, password), {
      max: 8,
    });
    testOwner = createDatabase(databaseUrl.toString(), { max: 4 });
    database = new DatabaseService(appConnection);
    auth = new AuthService(database);
    process.env.EMAIL_PROVIDER_ENABLED = "true";
    process.env.OUTBOX_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  after(async () => {
    if (database) await database.onModuleDestroy();
    if (testOwner) await testOwner.client.end();
    if (owner && databaseUrl) {
      await owner.client.unsafe(`drop role if exists "${loginRole}"`);
      await owner.client.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
      );
      await owner.client.unsafe(`drop database if exists "${databaseName}"`);
      await owner.client.end();
    }
    for (const name of Object.keys(process.env)) {
      if (!(name in previousEnvironment)) delete process.env[name];
    }
    Object.assign(process.env, previousEnvironment);
  });

  it("stores only a hash, blocks login, rotates the token and verifies exactly once", async (context) => {
    if (!integrationUrl || !testOwner || !database || !auth || !databaseUrl) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const service = auth;
    const email = `local-${suffix}@example.test`;
    const registration = await database.withRoleContext("identity", null, () =>
      service.register({ email, displayName: "Local Owner", password: "a-secure-local-password" }),
    );
    assert.deepEqual(registration, {
      accepted: true,
      email,
      verificationRequired: true,
    });

    const [identity] = await testOwner.db
      .select()
      .from(identities)
      .where(eq(identities.email, email));
    assert.ok(identity);
    assert.equal(identity.emailVerifiedAt, null);
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(authSessions)
          .where(eq(authSessions.identityId, identity.id))
      ).length,
      0,
    );
    const legacyToken = `legacy-${randomBytes(24).toString("base64url")}`;
    await testOwner.db.insert(authSessions).values({
      identityId: identity.id,
      tokenHash: createHash("sha256").update(legacyToken).digest("hex"),
      trustedDevice: false,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    assert.equal(
      await database.withRoleContext("identity", null, () => service.authenticate(legacyToken)),
      null,
    );
    await assert.rejects(
      database.withRoleContext("identity", null, () =>
        service.login({ email, password: "a-secure-local-password", trustedDevice: false }),
      ),
      (error: unknown) => JSON.stringify(error).includes("EMAIL_VERIFICATION_REQUIRED"),
    );

    const [firstEvent] = await testOwner.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.topic, "auth.email_verification_requested"));
    assert.ok(firstEvent);
    const firstEnvelope = firstEvent.payload.verificationTokenEnvelope as SecretEnvelope;
    const firstToken = decryptSecret(
      firstEnvelope,
      encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
      `email-verification:${identity.id}:${firstEvent.id}`,
    );
    const [firstStored] = await testOwner.db
      .select()
      .from(emailVerificationTokens)
      .where(eq(emailVerificationTokens.identityId, identity.id));
    assert.ok(firstStored);
    assert.equal(firstStored.tokenHash, createHash("sha256").update(firstToken).digest("hex"));
    assert.doesNotMatch(JSON.stringify(firstEvent.payload), new RegExp(firstToken));

    await testOwner.db
      .update(emailVerificationRequests)
      .set({ requestedAt: new Date(Date.now() - 61_000) })
      .where(eq(emailVerificationRequests.identityId, identity.id));
    await database.withRoleContext("identity", null, () =>
      service.requestEmailVerification({ email }),
    );
    const activeTokens = await testOwner.db
      .select()
      .from(emailVerificationTokens)
      .where(
        and(
          eq(emailVerificationTokens.identityId, identity.id),
          isNull(emailVerificationTokens.revokedAt),
          isNull(emailVerificationTokens.usedAt),
        ),
      );
    assert.equal(activeTokens.length, 1);
    assert.notEqual(activeTokens[0]?.tokenHash, firstStored.tokenHash);

    const verificationEvents = await testOwner.db
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.topic, "auth.email_verification_requested"));
    const latestEvent = verificationEvents.at(-1);
    assert.ok(latestEvent);
    const token = decryptSecret(
      latestEvent.payload.verificationTokenEnvelope as SecretEnvelope,
      encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
      `email-verification:${identity.id}:${latestEvent.id}`,
    );
    const results = await Promise.all([
      database.withRoleContext("identity", null, () => service.verifyEmail({ token })),
      database.withRoleContext("identity", null, () => service.verifyEmail({ token })),
    ]);
    assert.equal(results.filter((result) => result.status === "verified").length, 1);
    assert.equal(results.filter((result) => result.status === "already_verified").length, 1);
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(authSessions)
          .where(and(eq(authSessions.identityId, identity.id), isNull(authSessions.revokedAt)))
      ).length,
      1,
    );
  });

  it("is enumeration-safe and enforces durable rate limits and least privilege", async (context) => {
    if (!integrationUrl || !testOwner || !database || !auth) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const service = auth;
    const unknownEmail = `unknown-${suffix}@example.test`;
    const accepted = await database.withRoleContext("identity", null, () =>
      service.requestEmailVerification({ email: unknownEmail }),
    );
    assert.deepEqual(accepted, { accepted: true });
    await assert.rejects(
      database.withRoleContext("identity", null, () =>
        service.requestEmailVerification({ email: unknownEmail }),
      ),
      (error: unknown) => JSON.stringify(error).includes("EMAIL_VERIFICATION_RATE_LIMITED"),
    );

    const concurrentEmail = `concurrent-${suffix}@example.test`;
    const concurrent = await Promise.allSettled([
      database.withRoleContext("identity", null, () =>
        service.requestEmailVerification({ email: concurrentEmail }),
      ),
      database.withRoleContext("identity", null, () =>
        service.requestEmailVerification({ email: concurrentEmail }),
      ),
    ]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);

    const hourlyEmail = `hourly-${suffix}@example.test`;
    const hourlyHash = createHash("sha256").update(hourlyEmail).digest("hex");
    await testOwner.db.insert(emailVerificationRequests).values(
      Array.from({ length: 5 }, (_, index) => ({
        emailHash: hourlyHash,
        requestedAt: new Date(Date.now() - (index + 1) * 2 * 60_000),
      })),
    );
    await assert.rejects(
      database.withRoleContext("identity", null, () =>
        service.requestEmailVerification({ email: hourlyEmail }),
      ),
      (error: unknown) => JSON.stringify(error).includes("EMAIL_VERIFICATION_RATE_LIMITED"),
    );

    const dailyEmail = `daily-${suffix}@example.test`;
    const dailyHash = createHash("sha256").update(dailyEmail).digest("hex");
    await testOwner.db.insert(emailVerificationRequests).values(
      Array.from({ length: 10 }, (_, index) => ({
        emailHash: dailyHash,
        requestedAt: new Date(Date.now() - (index + 2) * 65 * 60_000),
      })),
    );
    await assert.rejects(
      database.withRoleContext("identity", null, () =>
        service.requestEmailVerification({ email: dailyEmail }),
      ),
      (error: unknown) => JSON.stringify(error).includes("EMAIL_VERIFICATION_RATE_LIMITED"),
    );

    const [privileges] = await testOwner.client<
      {
        app_tokens: boolean;
        identity_requests: boolean;
        identity_tokens: boolean;
        worker_requests: boolean;
        worker_tokens: boolean;
      }[]
    >`
      select
        has_table_privilege('giromesa_app', 'email_verification_tokens', 'select') app_tokens,
        has_table_privilege('giromesa_identity', 'email_verification_requests', 'select,insert') identity_requests,
        has_table_privilege('giromesa_identity', 'email_verification_tokens', 'select,insert,update') identity_tokens,
        has_table_privilege('giromesa_worker', 'email_verification_requests', 'select') worker_requests,
        has_table_privilege('giromesa_worker', 'email_verification_tokens', 'select') worker_tokens
    `;
    assert.deepEqual(privileges, {
      app_tokens: false,
      identity_requests: true,
      identity_tokens: true,
      worker_requests: false,
      worker_tokens: false,
    });
  });

  it("rejects expired links while a verified Google identity needs no verification token", async (context) => {
    if (!integrationUrl || !testOwner || !database || !auth) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const service = auth;
    const expiredEmail = `expired-${suffix}@example.test`;
    await database.withRoleContext("identity", null, () =>
      service.register({
        email: expiredEmail,
        displayName: "Expired Owner",
        password: "a-secure-expired-password",
      }),
    );
    const [expiredIdentity] = await testOwner.db
      .select()
      .from(identities)
      .where(eq(identities.email, expiredEmail));
    assert.ok(expiredIdentity);
    const [expiredEvent] = await testOwner.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.topic, "auth.email_verification_requested"),
          eq(outboxEvents.aggregateId, expiredIdentity.id),
        ),
      );
    assert.ok(expiredEvent);
    const expiredToken = decryptSecret(
      expiredEvent.payload.verificationTokenEnvelope as SecretEnvelope,
      encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
      `email-verification:${expiredIdentity.id}:${expiredEvent.id}`,
    );
    await testOwner.db
      .update(emailVerificationTokens)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(emailVerificationTokens.identityId, expiredIdentity.id));
    await assert.rejects(
      database.withRoleContext("identity", null, () =>
        service.verifyEmail({ token: expiredToken }),
      ),
      (error: unknown) => JSON.stringify(error).includes("INVALID_EMAIL_VERIFICATION_TOKEN"),
    );

    const googleEmail = `google-verified-${suffix}@example.test`;
    const google = await database.withRoleContext("identity", null, () =>
      service.authenticateGoogle(
        { subject: `subject-${suffix}`, email: googleEmail, displayName: "Google Owner" },
        "signup",
      ),
    );
    assert.equal("token" in google, true);
    const [googleIdentity] = await testOwner.db
      .select()
      .from(identities)
      .where(eq(identities.email, googleEmail));
    assert.ok(googleIdentity?.emailVerifiedAt);
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(emailVerificationTokens)
          .where(eq(emailVerificationTokens.identityId, googleIdentity.id))
      ).length,
      0,
    );
  });
});
