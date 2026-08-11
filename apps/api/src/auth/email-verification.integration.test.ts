import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  auditEvents,
  authSessions,
  createDatabase,
  emailVerificationRequests,
  emailVerificationTokens,
  identities,
  mfaChallenges,
  mfaFactors,
  oauthAccounts,
  outboxEvents,
  passwordCredentials,
  passwordResetTokens,
} from "@giromesa/db";
import { decryptSecret, encryptionKey, type SecretEnvelope } from "@giromesa/domain";
import * as argon2 from "argon2";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { AuthService } from "./auth.service.js";
import { encryptMfaSecret, mfaKey, recoveryCodeHash } from "./mfa.js";

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

async function bounded<T>(promise: Promise<T>, label: string, timeoutMs = 15_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForAdvisoryWaits(
  owner: ReturnType<typeof createDatabase>,
  databaseName: string,
  loginRole: string,
  minimum: number,
) {
  await bounded(
    (async () => {
      while (true) {
        const [result] = await owner.client<{ waiting: number }[]>`
          select count(*)::int as waiting
          from pg_stat_activity
          where datname = ${databaseName}
            and usename = ${loginRole}
            and wait_event_type = 'Lock'
            and wait_event = 'advisory'
        `;
        if ((result?.waiting ?? 0) >= minimum) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    })(),
    `waiting for ${minimum} advisory lock waiter(s)`,
  );
}

async function waitForPasswordHashWork(
  owner: ReturnType<typeof createDatabase>,
  databaseName: string,
  loginRole: string,
) {
  await bounded(
    (async () => {
      while (true) {
        const [result] = await owner.client<{ hashing: number }[]>`
          select count(*)::int as hashing
          from pg_stat_activity
          where datname = ${databaseName}
            and usename = ${loginRole}
            and state = 'idle in transaction'
            and query ilike '%password_credentials%'
        `;
        if ((result?.hashing ?? 0) >= 1) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    })(),
    "waiting for password hash verification",
  );
}

async function installSessionSweepGate(
  owner: ReturnType<typeof createDatabase>,
  identityId: string,
  gate: number,
  name: string,
) {
  await owner.client.unsafe(`
    create function ${name}() returns trigger
    language plpgsql as $$
    begin
      if old.revoked_at is null and new.revoked_at is not null
        and new.identity_id = '${identityId}'::uuid then
        perform pg_advisory_xact_lock(${gate});
      end if;
      return new;
    end
    $$
  `);
  await owner.client.unsafe(`
    create trigger ${name}
    after update on auth_sessions
    for each row execute function ${name}()
  `);
}

async function removeSessionSweepGate(owner: ReturnType<typeof createDatabase>, name: string) {
  await owner.client.unsafe(`drop trigger if exists ${name} on auth_sessions`);
  await owner.client.unsafe(`drop function if exists ${name}()`);
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
      const emailMigration = migrations.find((file) => file.startsWith("0013_"));
      assert.ok(emailMigration);
      for (const file of migrations.filter((file) => file !== emailMigration)) {
        await applyMigration(migrator.client, file);
      }
      const upgradeIdentityId = randomUUID();
      await migrator.client`
        insert into identities (id, email, display_name, email_verified_at)
        values (${upgradeIdentityId}, ${`upgrade-${suffix}@example.test`}, 'Upgrade survivor', now())
      `;
      await applyMigration(migrator.client, emailMigration);
      const upgraded = await migrator.client<{ id: string }[]>`
        select id from identities where id = ${upgradeIdentityId}
      `;
      assert.equal(upgraded[0]?.id, upgradeIdentityId);
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
    process.env.MFA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    process.env.DATABASE_URL = applicationUrl(databaseUrl.toString(), loginRole, password);
    process.env.APP_URL = "https://app.example.test";
    process.env.OPS_APP_URL = "https://ops.example.test";
    process.env.API_URL = "https://api.example.test";
    process.env.CORS_ORIGINS = "https://app.example.test";
    process.env.NODE_ENV = "production";
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

  it("keeps a legacy verified MFA factor between e-mail confirmation and session creation", async (context) => {
    if (!integrationUrl || !testOwner || !database || !auth) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const email = `mfa-verification-${suffix}@example.test`;
    const service = auth;
    await database.withRoleContext("identity", null, () =>
      service.register({
        email,
        displayName: "MFA Owner",
        password: "a-secure-mfa-owner-password",
      }),
    );
    const [identity] = await testOwner.db
      .select()
      .from(identities)
      .where(eq(identities.email, email));
    assert.ok(identity);
    const recoveryCode = "legacy-recovery-code";
    const key = mfaKey();
    await testOwner.db.insert(mfaFactors).values({
      identityId: identity.id,
      ...encryptMfaSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", key),
      recoveryCodeHashes: [recoveryCodeHash(recoveryCode, key)],
      verifiedAt: new Date(),
    });
    const [event] = await testOwner.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.topic, "auth.email_verification_requested"),
          eq(outboxEvents.aggregateId, identity.id),
        ),
      );
    assert.ok(event);
    const token = decryptSecret(
      event.payload.verificationTokenEnvelope as SecretEnvelope,
      encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
      `email-verification:${identity.id}:${event.id}`,
    );

    const confirmations = await Promise.all([
      database.withRoleContext("identity", null, () => service.verifyEmail({ token })),
      database.withRoleContext("identity", null, () => service.verifyEmail({ token })),
    ]);
    const mfa = confirmations.find((result) => result.status === "mfa_required");
    assert.ok(mfa && "challengeToken" in mfa);
    assert.equal(confirmations.filter((result) => result.status === "already_verified").length, 1);
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(authSessions)
          .where(and(eq(authSessions.identityId, identity.id), isNull(authSessions.revokedAt)))
      ).length,
      0,
    );
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(mfaChallenges)
          .where(and(eq(mfaChallenges.identityId, identity.id), isNull(mfaChallenges.usedAt)))
      ).length,
      1,
    );

    const session = await database.withRoleContext("identity", null, () =>
      service.verifyMfaChallenge({ challengeToken: mfa.challengeToken, recoveryCode }),
    );
    assert.ok(session.token);
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(authSessions)
          .where(and(eq(authSessions.identityId, identity.id), isNull(authSessions.revokedAt)))
      ).length,
      1,
    );
    await assert.rejects(
      database.withRoleContext("identity", null, () =>
        service.verifyMfaChallenge({ challengeToken: mfa.challengeToken, recoveryCode }),
      ),
      (error: unknown) => JSON.stringify(error).includes("INVALID_MFA_CHALLENGE"),
    );
  });

  it("is enumeration-safe and enforces durable rate limits and least privilege", async (context) => {
    if (!integrationUrl || !testOwner || !database || !auth) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const service = auth;
    const outboxCountBefore = (
      await testOwner.db
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(eq(outboxEvents.topic, "auth.email_verification_requested"))
    ).length;
    const unknownEmail = `unknown-${suffix}@example.test`;
    const accepted = await database.withRoleContext("identity", null, () =>
      service.requestEmailVerification({ email: unknownEmail }),
    );
    assert.deepEqual(accepted, { accepted: true });
    assert.deepEqual(
      await database.withRoleContext("identity", null, () =>
        service.requestEmailVerification({ email: unknownEmail }),
      ),
      { accepted: true },
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
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 2);
    assert.equal(concurrent.filter((result) => result.status === "rejected").length, 0);

    const hourlyEmail = `hourly-${suffix}@example.test`;
    const hourlyHash = createHash("sha256").update(hourlyEmail).digest("hex");
    await testOwner.db.insert(emailVerificationRequests).values(
      Array.from({ length: 5 }, (_, index) => ({
        emailHash: hourlyHash,
        requestedAt: new Date(Date.now() - (index + 1) * 2 * 60_000),
      })),
    );
    assert.deepEqual(
      await database.withRoleContext("identity", null, () =>
        service.requestEmailVerification({ email: hourlyEmail }),
      ),
      { accepted: true },
    );

    const dailyEmail = `daily-${suffix}@example.test`;
    const dailyHash = createHash("sha256").update(dailyEmail).digest("hex");
    await testOwner.db.insert(emailVerificationRequests).values(
      Array.from({ length: 10 }, (_, index) => ({
        emailHash: dailyHash,
        requestedAt: new Date(Date.now() - (index + 2) * 65 * 60_000),
      })),
    );
    assert.deepEqual(
      await database.withRoleContext("identity", null, () =>
        service.requestEmailVerification({ email: dailyEmail }),
      ),
      { accepted: true },
    );

    const outboxCountAfter = (
      await testOwner.db
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(eq(outboxEvents.topic, "auth.email_verification_requested"))
    ).length;
    assert.equal(outboxCountAfter, outboxCountBefore);

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

  it("returns uniform resend HTTP responses and sets a session cookie only after MFA", async (context) => {
    if (!integrationUrl || !testOwner || !database || !auth) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const service = auth;
    const pendingEmail = `http-pending-${suffix}@example.test`;
    await database.withRoleContext("identity", null, () =>
      service.register({
        email: pendingEmail,
        displayName: "HTTP MFA Owner",
        password: "a-secure-http-mfa-password",
      }),
    );
    const [pendingIdentity] = await testOwner.db
      .select()
      .from(identities)
      .where(eq(identities.email, pendingEmail));
    assert.ok(pendingIdentity);
    assert.equal(pendingIdentity.emailVerifiedAt, null);
    const recoveryCode = "http-recovery-code";
    const key = mfaKey();
    await testOwner.db.insert(mfaFactors).values({
      identityId: pendingIdentity.id,
      ...encryptMfaSecret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", key),
      recoveryCodeHashes: [recoveryCodeHash(recoveryCode, key)],
      verifiedAt: new Date(),
    });
    const [verificationEvent] = await testOwner.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.topic, "auth.email_verification_requested"),
          eq(outboxEvents.aggregateId, pendingIdentity.id),
        ),
      );
    assert.ok(verificationEvent);
    const verificationToken = decryptSecret(
      verificationEvent.payload.verificationTokenEnvelope as SecretEnvelope,
      encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
      `email-verification:${pendingIdentity.id}:${verificationEvent.id}`,
    );

    const verifiedEmail = `http-verified-${suffix}@example.test`;
    await testOwner.db.insert(identities).values({
      email: verifiedEmail,
      displayName: "Verified HTTP identity",
      emailVerifiedAt: new Date(),
    });
    const unknownEmail = `http-unknown-${suffix}@example.test`;
    const quotaEmail = `http-quota-${suffix}@example.test`;
    const quotaHash = createHash("sha256").update(quotaEmail).digest("hex");
    await testOwner.db.insert(emailVerificationRequests).values(
      Array.from({ length: 10 }, (_, index) => ({
        emailHash: quotaHash,
        requestedAt: new Date(Date.now() - (index + 1) * 2 * 60_000),
      })),
    );
    const beforeOutbox = (
      await testOwner.db
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(eq(outboxEvents.topic, "auth.email_verification_requested"))
    ).length;

    const { createApplication } = await import("../app-factory.js");
    const { app } = await createApplication();
    try {
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const confirmation = await app.inject({
        method: "POST",
        url: "/v1/auth/email-verification/confirm",
        payload: { token: verificationToken },
      });
      assert.equal(confirmation.statusCode, 200);
      assert.equal(confirmation.headers["set-cookie"], undefined);
      assert.equal(confirmation.headers["cache-control"], "no-store");
      const challenge = confirmation.json<{
        status: string;
        mfaRequired: boolean;
        challengeToken: string;
      }>();
      assert.equal(challenge.status, "mfa_required");
      assert.equal(challenge.mfaRequired, true);

      const responses = await Promise.all(
        [pendingEmail, verifiedEmail, unknownEmail, quotaEmail].map((email) =>
          app.inject({
            method: "POST",
            url: "/v1/auth/email-verification/request",
            payload: { email },
          }),
        ),
      );
      for (const response of responses) {
        assert.equal(response.statusCode, 202);
        assert.deepEqual(response.json(), { accepted: true });
        assert.equal(response.headers["retry-after"], "60");
        assert.equal(response.headers["cache-control"], "no-store");
      }

      const secondFactor = await app.inject({
        method: "POST",
        url: "/v1/auth/mfa/challenge/verify",
        payload: { challengeToken: challenge.challengeToken, recoveryCode },
      });
      assert.equal(secondFactor.statusCode, 200);
      assert.equal("token" in secondFactor.json(), false);
      const cookie = String(secondFactor.headers["set-cookie"]);
      assert.match(cookie, /giromesa_session=/);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      assert.match(cookie, /Secure/i);
    } finally {
      await app.close();
    }

    const afterOutbox = (
      await testOwner.db
        .select({ id: outboxEvents.id })
        .from(outboxEvents)
        .where(eq(outboxEvents.topic, "auth.email_verification_requested"))
    ).length;
    assert.equal(afterOutbox, beforeOutbox);

    const { app: rateLimitedApp } = await createApplication();
    try {
      await rateLimitedApp.init();
      await rateLimitedApp.getHttpAdapter().getInstance().ready();
      const results = [];
      for (let index = 0; index < 11; index += 1) {
        results.push(
          await rateLimitedApp.inject({
            method: "POST",
            url: "/v1/auth/email-verification/request",
            payload: { email: `ip-limit-${index}-${suffix}@example.test` },
          }),
        );
      }
      assert.equal(
        results.slice(0, 10).every((response) => response.statusCode === 202),
        true,
      );
      const apiAlias = results[10];
      assert.equal(apiAlias?.statusCode, 429);
      assert.ok(Number(apiAlias?.headers["retry-after"]) > 0);
      assert.equal(apiAlias?.headers["cache-control"], "no-store");
      const canonicalAlias = await rateLimitedApp.inject({
        method: "POST",
        url: "/api/v1/auth/email-verification/request",
        payload: { email: `ip-limit-canonical-${suffix}@example.test` },
      });
      assert.equal(canonicalAlias.statusCode, 429);
      assert.deepEqual(canonicalAlias.json(), apiAlias?.json());
      assert.equal(canonicalAlias.headers["retry-after"], apiAlias?.headers["retry-after"]);
      assert.equal(canonicalAlias.headers["cache-control"], apiAlias?.headers["cache-control"]);
      const publicAlias = await rateLimitedApp.inject({
        method: "POST",
        url: "/public/v1/auth/email-verification/request",
        payload: { email: `ip-limit-alias-${suffix}@example.test` },
      });
      assert.equal(publicAlias.statusCode, 429);
      assert.deepEqual(publicAlias.json(), apiAlias?.json());
      assert.equal(publicAlias.headers["retry-after"], apiAlias?.headers["retry-after"]);
      assert.equal(publicAlias.headers["cache-control"], apiAlias?.headers["cache-control"]);
    } finally {
      await rateLimitedApp.close();
    }
  });

  it("keeps registration independent after the verification-request IP bucket is exhausted", async (context) => {
    if (!integrationUrl || !testOwner) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const { createApplication } = await import("../app-factory.js");
    const { app } = await createApplication();
    const email = `independent-register-${suffix}@example.test`;
    try {
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const accepted = [];
      for (let index = 0; index < 10; index += 1) {
        accepted.push(
          await app.inject({
            method: "POST",
            url: "/v1/auth/email-verification/request",
            payload: { email: `isolated-bucket-${index}-${suffix}@example.test` },
          }),
        );
      }
      assert.equal(
        accepted.every((response) => response.statusCode === 202),
        true,
      );

      const exhausted = await app.inject({
        method: "POST",
        url: "/v1/auth/email-verification/request",
        payload: { email: `isolated-bucket-overflow-${suffix}@example.test` },
      });
      assert.equal(exhausted.statusCode, 429);
      assert.ok(Number(exhausted.headers["retry-after"]) > 0);
      assert.equal(exhausted.headers["cache-control"], "no-store");

      const registration = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email,
          name: "Independent Bucket Owner",
          password: "a-secure-independent-bucket-password",
          termsAccepted: true,
        },
      });
      assert.equal(registration.statusCode, 201);
      assert.deepEqual(registration.json(), {
        accepted: true,
        email,
        verificationRequired: true,
      });
    } finally {
      await app.close();
    }
  });

  it("atomically arbitrates concurrent registration and rolls back non-identity unique failures", async (context) => {
    if (!integrationUrl || !testOwner) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const { createApplication } = await import("../app-factory.js");
    const { app } = await createApplication();
    const email = `concurrent-register-${suffix}@example.test`;
    try {
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const registrations = await Promise.all(
        ["First", "Second"].map((name) =>
          app.inject({
            method: "POST",
            url: "/v1/auth/register",
            payload: {
              email,
              name: `${name} Concurrent Owner`,
              password: `a-secure-${name.toLowerCase()}-concurrent-password`,
              termsAccepted: true,
            },
          }),
        ),
      );
      assert.deepEqual(registrations.map((response) => response.statusCode).sort(), [201, 409]);
      const [identity] = await testOwner.db
        .select({ id: identities.id })
        .from(identities)
        .where(eq(identities.email, email));
      assert.ok(identity);
      assert.equal(
        (
          await testOwner.db
            .select({ identityId: passwordCredentials.identityId })
            .from(passwordCredentials)
            .where(eq(passwordCredentials.identityId, identity.id))
        ).length,
        1,
      );
      assert.equal(
        (
          await testOwner.db
            .select({ id: emailVerificationTokens.id })
            .from(emailVerificationTokens)
            .where(eq(emailVerificationTokens.identityId, identity.id))
        ).length,
        1,
      );
      for (const topic of ["identity.registered", "auth.email_verification_requested"]) {
        assert.equal(
          (
            await testOwner.db
              .select({ id: outboxEvents.id })
              .from(outboxEvents)
              .where(and(eq(outboxEvents.aggregateId, identity.id), eq(outboxEvents.topic, topic)))
          ).length,
          1,
        );
      }

      const rollbackEmail = `forced-rollback-${suffix}@example.test`;
      const beforeOutbox = (await testOwner.db.select({ id: outboxEvents.id }).from(outboxEvents))
        .length;
      await testOwner.client.unsafe(`
        create function task6_force_non_identity_unique() returns trigger
        language plpgsql as $$
        begin
          raise exception 'forced verification insert failure'
            using errcode = '23505', constraint = 'task6_forced_non_identity_unique';
        end
        $$
      `);
      await testOwner.client.unsafe(`
        create trigger task6_force_non_identity_unique
        before insert on email_verification_tokens
        for each row execute function task6_force_non_identity_unique()
      `);
      try {
        const failed = await app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: {
            email: rollbackEmail,
            name: "Rollback Owner",
            password: "a-secure-rollback-password",
            termsAccepted: true,
          },
        });
        assert.equal(failed.statusCode, 500);
      } finally {
        await testOwner.client.unsafe(
          "drop trigger if exists task6_force_non_identity_unique on email_verification_tokens",
        );
        await testOwner.client.unsafe("drop function if exists task6_force_non_identity_unique()");
      }
      assert.equal(
        (
          await testOwner.db
            .select({ id: identities.id })
            .from(identities)
            .where(eq(identities.email, rollbackEmail))
        ).length,
        0,
      );
      assert.equal(
        (await testOwner.db.select({ id: outboxEvents.id }).from(outboxEvents)).length,
        beforeOutbox,
      );
      const [orphans] = await testOwner.client<{ password_count: number; token_count: number }[]>`
        select
          (select count(*)::int from password_credentials p
            left join identities i on i.id = p.identity_id where i.id is null) password_count,
          (select count(*)::int from email_verification_tokens t
            left join identities i on i.id = t.identity_id where i.id is null) token_count
      `;
      assert.deepEqual(orphans, { password_count: 0, token_count: 0 });
    } finally {
      await app.close();
    }
  });

  it("lets verified Google recover a pending local identity without retaining attacker credentials", async (context) => {
    if (!integrationUrl || !testOwner || !database || !auth) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const service = auth;
    const email = `google-recovery-${suffix}@example.test`;
    await database.withRoleContext("identity", null, () =>
      service.register({
        email,
        displayName: "Pending Local Identity",
        password: "attacker-controlled-password",
      }),
    );
    const [identity] = await testOwner.db
      .select()
      .from(identities)
      .where(eq(identities.email, email));
    assert.ok(identity);
    const legacySessionToken = randomBytes(32).toString("base64url");
    await testOwner.db.insert(authSessions).values({
      identityId: identity.id,
      tokenHash: createHash("sha256").update(legacySessionToken).digest("hex"),
      trustedDevice: true,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    await testOwner.db.insert(mfaChallenges).values({
      identityId: identity.id,
      tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      trustedDevice: false,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });
    await testOwner.db.insert(passwordResetTokens).values({
      identityId: identity.id,
      tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });

    const google = await database.withRoleContext("identity", null, () =>
      service.authenticateGoogle(
        { subject: `recovery-subject-${suffix}`, email, displayName: "Verified Google Owner" },
        "login",
      ),
    );
    assert.equal("token" in google, true);
    if (!("token" in google)) return;
    assert.ok(
      await database.withRoleContext("identity", null, () => service.authenticate(google.token)),
    );
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(passwordCredentials)
          .where(eq(passwordCredentials.identityId, identity.id))
      ).length,
      0,
    );
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(oauthAccounts)
          .where(eq(oauthAccounts.identityId, identity.id))
      ).length,
      1,
    );
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.entityId, identity.id),
              eq(auditEvents.action, "auth.google_pending_identity_recovered"),
            ),
          )
      ).length,
      1,
    );
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(emailVerificationTokens)
          .where(
            and(
              eq(emailVerificationTokens.identityId, identity.id),
              isNull(emailVerificationTokens.revokedAt),
            ),
          )
      ).length,
      0,
    );
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(authSessions)
          .where(and(eq(authSessions.identityId, identity.id), isNull(authSessions.revokedAt)))
      ).length,
      1,
    );
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(mfaChallenges)
          .where(and(eq(mfaChallenges.identityId, identity.id), isNull(mfaChallenges.usedAt)))
      ).length,
      0,
    );
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(passwordResetTokens)
          .where(
            and(
              eq(passwordResetTokens.identityId, identity.id),
              isNull(passwordResetTokens.usedAt),
            ),
          )
      ).length,
      0,
    );
    await assert.rejects(
      database.withRoleContext("identity", null, () =>
        service.login({ email, password: "attacker-controlled-password", trustedDevice: false }),
      ),
      (error: unknown) => JSON.stringify(error).includes("INVALID_CREDENTIALS"),
    );

    await database.withRoleContext("identity", null, () => service.requestPasswordReset({ email }));
    const [resetEvent] = await testOwner.db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateId, identity.id),
          eq(outboxEvents.topic, "auth.password_reset_requested"),
        ),
      )
      .orderBy(desc(outboxEvents.createdAt))
      .limit(1);
    assert.ok(resetEvent);
    const resetToken = decryptSecret(
      resetEvent.payload.resetTokenEnvelope as SecretEnvelope,
      encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
      `identity:${identity.id}`,
    );
    await database.withRoleContext("identity", null, () =>
      service.confirmPasswordReset({ token: resetToken, password: "owner-restored-password" }),
    );
    const restored = await database.withRoleContext("identity", null, () =>
      service.login({ email, password: "owner-restored-password", trustedDevice: false }),
    );
    assert.equal("token" in restored, true);

    const concurrentEmail = `google-local-race-${suffix}@example.test`;
    const [localRace, googleRace] = await bounded(
      Promise.allSettled([
        database.withRoleContext("identity", null, () =>
          service.register({
            email: concurrentEmail,
            displayName: "Concurrent Local",
            password: "concurrent-local-password",
          }),
        ),
        database.withRoleContext("identity", null, () =>
          service.authenticateGoogle(
            {
              subject: `concurrent-google-${suffix}`,
              email: concurrentEmail,
              displayName: "Concurrent Google",
            },
            "signup",
          ),
        ),
      ]),
      "register versus Google",
    );
    assert.equal(googleRace.status, "fulfilled");
    if (localRace.status === "rejected") {
      assert.match(JSON.stringify(localRace.reason), /IDENTITY_EXISTS/);
    } else {
      assert.equal(localRace.value.verificationRequired, true);
    }
    const racedIdentities = await testOwner.db
      .select()
      .from(identities)
      .where(eq(identities.email, concurrentEmail));
    assert.equal(racedIdentities.length, 1);
    const [racedIdentity] = racedIdentities;
    assert.ok(racedIdentity?.emailVerifiedAt);
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(passwordCredentials)
          .where(eq(passwordCredentials.identityId, racedIdentity.id))
      ).length,
      0,
    );
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(oauthAccounts)
          .where(eq(oauthAccounts.identityId, racedIdentity.id))
      ).length,
      1,
    );
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(emailVerificationTokens)
          .where(
            and(
              eq(emailVerificationTokens.identityId, racedIdentity.id),
              isNull(emailVerificationTokens.usedAt),
              isNull(emailVerificationTokens.revokedAt),
            ),
          )
      ).length,
      0,
    );
    assert.equal(
      (
        await testOwner.db
          .select()
          .from(authSessions)
          .where(and(eq(authSessions.identityId, racedIdentity.id), isNull(authSessions.revokedAt)))
      ).length,
      1,
    );
  });

  it("serializes pending Google recovery against an already-issued MFA challenge", async (context) => {
    if (!integrationUrl || !testOwner || !database || !auth || !databaseUrl) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const service = auth;
    const email = `google-mfa-race-${suffix}@example.test`;
    await database.withRoleContext("identity", null, () =>
      service.register({
        email,
        displayName: "Pending MFA Race",
        password: "attacker-controlled-password",
      }),
    );
    const [identity] = await testOwner.db
      .select()
      .from(identities)
      .where(eq(identities.email, email));
    assert.ok(identity);
    const attackerSession = randomBytes(32).toString("base64url");
    await testOwner.db.insert(authSessions).values({
      identityId: identity.id,
      tokenHash: createHash("sha256").update(attackerSession).digest("hex"),
      trustedDevice: true,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const resetToken = randomBytes(32).toString("base64url");
    await testOwner.db.insert(passwordResetTokens).values({
      identityId: identity.id,
      tokenHash: createHash("sha256").update(resetToken).digest("hex"),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    const challengeToken = randomBytes(32).toString("base64url");
    const recoveryCode = "attacker-recovery-code";
    const key = mfaKey();
    await testOwner.db.insert(mfaFactors).values({
      identityId: identity.id,
      ...encryptMfaSecret("JBSWY3DPEHPK3PXP", key),
      recoveryCodeHashes: [recoveryCodeHash(recoveryCode, key)],
      verifiedAt: new Date(),
    });
    await testOwner.db.insert(mfaChallenges).values({
      identityId: identity.id,
      tokenHash: createHash("sha256").update(challengeToken).digest("hex"),
      trustedDevice: false,
      expiresAt: new Date(Date.now() + 5 * 60_000),
    });

    const gate = 900_000_000 + Number.parseInt(suffix.slice(0, 6), 16);
    const triggerName = `task6_mfa_gate_${suffix.slice(0, 12)}`;
    const blocker = createDatabase(databaseUrl.toString(), { max: 1 });
    let googlePromise: Promise<Awaited<ReturnType<AuthService["authenticateGoogle"]>>> | undefined;
    let mfaPromise: Promise<Awaited<ReturnType<AuthService["verifyMfaChallenge"]>>> | undefined;
    try {
      await installSessionSweepGate(testOwner, identity.id, gate, triggerName);
      await blocker.client.unsafe(`select pg_advisory_lock(${gate})`);
      googlePromise = database.withRoleContext("identity", null, () =>
        service.authenticateGoogle(
          { subject: `mfa-race-${suffix}`, email, displayName: "Verified Google Owner" },
          "login",
        ),
      );
      await waitForAdvisoryWaits(testOwner, databaseName, loginRole, 1);
      mfaPromise = database.withRoleContext("identity", null, () =>
        service.verifyMfaChallenge({ challengeToken, recoveryCode }),
      );
      await waitForAdvisoryWaits(testOwner, databaseName, loginRole, 2);
      await blocker.client.unsafe(`select pg_advisory_unlock(${gate})`);

      const [googleResult, mfaResult] = await bounded(
        Promise.allSettled([googlePromise, mfaPromise]),
        "Google recovery versus MFA",
      );
      assert.equal(googleResult.status, "fulfilled");
      assert.equal(mfaResult.status, "rejected");
      if (mfaResult.status === "rejected") {
        assert.match(JSON.stringify(mfaResult.reason), /INVALID_MFA_CHALLENGE/);
      }
      assert.equal(
        await database.withRoleContext("identity", null, () =>
          service.authenticate(attackerSession),
        ),
        null,
      );
      const [counts] = await testOwner.client<
        {
          passwords: number;
          factors: number;
          active_challenges: number;
          active_verifications: number;
          active_resets: number;
          active_sessions: number;
        }[]
      >`
          select
            (select count(*)::int from password_credentials where identity_id = ${identity.id}) passwords,
            (select count(*)::int from mfa_factors where identity_id = ${identity.id}) factors,
            (select count(*)::int from mfa_challenges where identity_id = ${identity.id} and used_at is null) active_challenges,
            (select count(*)::int from email_verification_tokens where identity_id = ${identity.id} and used_at is null and revoked_at is null) active_verifications,
            (select count(*)::int from password_reset_tokens where identity_id = ${identity.id} and used_at is null) active_resets,
            (select count(*)::int from auth_sessions where identity_id = ${identity.id} and revoked_at is null) active_sessions
        `;
      assert.deepEqual(counts, {
        passwords: 0,
        factors: 0,
        active_challenges: 0,
        active_verifications: 0,
        active_resets: 0,
        active_sessions: 1,
      });
      if (googleResult.status === "fulfilled") {
        assert.equal("token" in googleResult.value, true);
        if ("token" in googleResult.value) {
          const googleToken = googleResult.value.token;
          assert.ok(
            await database.withRoleContext("identity", null, () =>
              service.authenticate(googleToken),
            ),
          );
        }
      }
    } finally {
      await blocker.client.unsafe(`select pg_advisory_unlock(${gate})`).catch(() => undefined);
      if (googlePromise) await bounded(Promise.allSettled([googlePromise]), "Google cleanup");
      if (mfaPromise) await bounded(Promise.allSettled([mfaPromise]), "MFA cleanup");
      await removeSessionSweepGate(testOwner, triggerName);
      await blocker.client.end();
    }
  });

  it("finishes pending Google recovery versus password reset without deadlock", async (context) => {
    if (!integrationUrl || !testOwner || !database || !auth || !databaseUrl) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const service = auth;
    const email = `google-reset-race-${suffix}@example.test`;
    await database.withRoleContext("identity", null, () =>
      service.register({
        email,
        displayName: "Pending Reset Race",
        password: "attacker-original-password",
      }),
    );
    const [identity] = await testOwner.db
      .select()
      .from(identities)
      .where(eq(identities.email, email));
    assert.ok(identity);
    const attackerSession = randomBytes(32).toString("base64url");
    await testOwner.db.insert(authSessions).values({
      identityId: identity.id,
      tokenHash: createHash("sha256").update(attackerSession).digest("hex"),
      trustedDevice: false,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const resetToken = randomBytes(32).toString("base64url");
    await testOwner.db.insert(passwordResetTokens).values({
      identityId: identity.id,
      tokenHash: createHash("sha256").update(resetToken).digest("hex"),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });

    const gate = 920_000_000 + Number.parseInt(suffix.slice(0, 6), 16);
    const triggerName = `task6_reset_gate_${suffix.slice(0, 12)}`;
    const blocker = createDatabase(databaseUrl.toString(), { max: 1 });
    let googlePromise: Promise<Awaited<ReturnType<AuthService["authenticateGoogle"]>>> | undefined;
    let resetPromise: Promise<void> | undefined;
    try {
      await installSessionSweepGate(testOwner, identity.id, gate, triggerName);
      await blocker.client.unsafe(`select pg_advisory_lock(${gate})`);
      googlePromise = database.withRoleContext("identity", null, () =>
        service.authenticateGoogle(
          { subject: `reset-race-${suffix}`, email, displayName: "Verified Google Owner" },
          "login",
        ),
      );
      await waitForAdvisoryWaits(testOwner, databaseName, loginRole, 1);
      resetPromise = database.withRoleContext("identity", null, () =>
        service.confirmPasswordReset({
          token: resetToken,
          password: "attacker-raced-password",
        }),
      );
      await waitForAdvisoryWaits(testOwner, databaseName, loginRole, 2);
      await blocker.client.unsafe(`select pg_advisory_unlock(${gate})`);
      const [googleResult, resetResult] = await bounded(
        Promise.allSettled([googlePromise, resetPromise]),
        "Google recovery versus password reset",
      );
      assert.equal(googleResult.status, "fulfilled");
      assert.equal(resetResult.status, "rejected");
      if (resetResult.status === "rejected") {
        assert.match(JSON.stringify(resetResult.reason), /INVALID_RESET_TOKEN/);
      }
      assert.equal(
        (
          await testOwner.db
            .select()
            .from(passwordCredentials)
            .where(eq(passwordCredentials.identityId, identity.id))
        ).length,
        0,
      );
      for (const password of ["attacker-original-password", "attacker-raced-password"]) {
        await assert.rejects(
          database.withRoleContext("identity", null, () =>
            service.login({ email, password, trustedDevice: false }),
          ),
          (error: unknown) => JSON.stringify(error).includes("INVALID_CREDENTIALS"),
        );
      }
    } finally {
      await blocker.client.unsafe(`select pg_advisory_unlock(${gate})`).catch(() => undefined);
      if (googlePromise) await bounded(Promise.allSettled([googlePromise]), "Google cleanup");
      if (resetPromise) await bounded(Promise.allSettled([resetPromise]), "reset cleanup");
      await removeSessionSweepGate(testOwner, triggerName);
      await blocker.client.end();
    }
  });

  it("rejects a password login that verified a hash before Google recovery committed", async (context) => {
    if (!integrationUrl || !testOwner || !database || !auth || !databaseUrl) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const service = auth;
    const email = `google-login-race-${suffix}@example.test`;
    const attackerPassword = "attacker-stale-login-password";
    await database.withRoleContext("identity", null, () =>
      service.register({ email, displayName: "Pending Login Race", password: attackerPassword }),
    );
    const [identity] = await testOwner.db
      .select()
      .from(identities)
      .where(eq(identities.email, email));
    assert.ok(identity);
    const sweptSession = randomBytes(32).toString("base64url");
    await testOwner.db.insert(authSessions).values({
      identityId: identity.id,
      tokenHash: createHash("sha256").update(sweptSession).digest("hex"),
      trustedDevice: false,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const deliberatelySlowHash = await argon2.hash(attackerPassword, {
      type: argon2.argon2id,
      memoryCost: 32 * 1024,
      timeCost: 30,
      parallelism: 1,
    });
    await testOwner.db
      .update(passwordCredentials)
      .set({ passwordHash: deliberatelySlowHash })
      .where(eq(passwordCredentials.identityId, identity.id));
    await testOwner.db
      .update(identities)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(identities.id, identity.id));

    const gate = 940_000_000 + Number.parseInt(suffix.slice(0, 6), 16);
    const triggerName = `task6_login_gate_${suffix.slice(0, 12)}`;
    const blocker = createDatabase(databaseUrl.toString(), { max: 1 });
    let googlePromise: Promise<Awaited<ReturnType<AuthService["authenticateGoogle"]>>> | undefined;
    let loginPromise: Promise<Awaited<ReturnType<AuthService["login"]>>> | undefined;
    try {
      await installSessionSweepGate(testOwner, identity.id, gate, triggerName);
      await blocker.client.unsafe(`select pg_advisory_lock(${gate})`);
      loginPromise = database.withRoleContext("identity", null, () =>
        service.login({ email, password: attackerPassword, trustedDevice: true }),
      );
      await waitForPasswordHashWork(testOwner, databaseName, loginRole);
      await testOwner.db
        .update(identities)
        .set({ emailVerifiedAt: null })
        .where(eq(identities.id, identity.id));
      googlePromise = database.withRoleContext("identity", null, () =>
        service.authenticateGoogle(
          { subject: `login-race-${suffix}`, email, displayName: "Verified Google Owner" },
          "login",
        ),
      );
      await waitForAdvisoryWaits(testOwner, databaseName, loginRole, 1);
      await waitForAdvisoryWaits(testOwner, databaseName, loginRole, 2);
      await blocker.client.unsafe(`select pg_advisory_unlock(${gate})`);
      const [googleResult, loginResult] = await bounded(
        Promise.allSettled([googlePromise, loginPromise]),
        "Google recovery versus stale password login",
      );
      assert.equal(googleResult.status, "fulfilled");
      assert.equal(loginResult.status, "rejected");
      if (loginResult.status === "rejected") {
        assert.match(JSON.stringify(loginResult.reason), /INVALID_CREDENTIALS/);
      }
      const activeSessions = await testOwner.db
        .select({ tokenHash: authSessions.tokenHash })
        .from(authSessions)
        .where(and(eq(authSessions.identityId, identity.id), isNull(authSessions.revokedAt)));
      assert.equal(activeSessions.length, 1);
      assert.equal(
        await database.withRoleContext("identity", null, () => service.authenticate(sweptSession)),
        null,
      );
    } finally {
      await blocker.client.unsafe(`select pg_advisory_unlock(${gate})`).catch(() => undefined);
      if (googlePromise) await bounded(Promise.allSettled([googlePromise]), "Google cleanup");
      if (loginPromise) await bounded(Promise.allSettled([loginPromise]), "login cleanup");
      await removeSessionSweepGate(testOwner, triggerName);
      await blocker.client.end();
    }
  });

  it("guarantees one initial verification after anonymous durable quota without bypassing resends", async (context) => {
    if (!integrationUrl || !testOwner) {
      context.skip("EMAIL_VERIFICATION_DATABASE_URL not configured");
      return;
    }
    const email = `quota-before-register-${suffix}@example.test`;
    const emailHash = createHash("sha256").update(email).digest("hex");
    const { createApplication } = await import("../app-factory.js");
    const { app: anonymousApp } = await createApplication();
    try {
      await anonymousApp.init();
      await anonymousApp.getHttpAdapter().getInstance().ready();
      for (let index = 0; index < 10; index += 1) {
        const response = await anonymousApp.inject({
          method: "POST",
          url: "/v1/auth/email-verification/request",
          payload: { email },
        });
        assert.equal(response.statusCode, 202);
        const [freshRequest] = await testOwner.db
          .select({ id: emailVerificationRequests.id })
          .from(emailVerificationRequests)
          .where(eq(emailVerificationRequests.emailHash, emailHash))
          .orderBy(desc(emailVerificationRequests.requestedAt))
          .limit(1);
        assert.ok(freshRequest);
        await testOwner.db
          .update(emailVerificationRequests)
          .set({ requestedAt: new Date(Date.now() - (index + 1) * 2 * 60 * 60_000) })
          .where(eq(emailVerificationRequests.id, freshRequest.id));
      }
    } finally {
      await anonymousApp.close();
    }

    assert.equal(
      (
        await testOwner.db
          .select({ id: emailVerificationRequests.id })
          .from(emailVerificationRequests)
          .where(eq(emailVerificationRequests.emailHash, emailHash))
      ).length,
      10,
    );

    const { app: registrationApp } = await createApplication();
    try {
      await registrationApp.init();
      await registrationApp.getHttpAdapter().getInstance().ready();
      const firstRegistration = await registrationApp.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email,
          name: "Quota First Owner",
          password: "a-secure-quota-first-password",
          termsAccepted: true,
        },
      });
      assert.equal(firstRegistration.statusCode, 201);
      assert.deepEqual(firstRegistration.json(), {
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
            .select({ id: emailVerificationTokens.id })
            .from(emailVerificationTokens)
            .where(eq(emailVerificationTokens.identityId, identity.id))
        ).length,
        1,
      );

      const minuteResend = await registrationApp.inject({
        method: "POST",
        url: "/v1/auth/email-verification/request",
        payload: { email },
      });
      assert.equal(minuteResend.statusCode, 202);
      assert.deepEqual(minuteResend.json(), { accepted: true });
      assert.equal(minuteResend.headers["retry-after"], "60");
      assert.equal(minuteResend.headers["cache-control"], "no-store");

      const requests = await testOwner.db
        .select({ id: emailVerificationRequests.id })
        .from(emailVerificationRequests)
        .where(eq(emailVerificationRequests.emailHash, emailHash));
      assert.equal(requests.length, 11);
      for (const [index, request] of requests.entries()) {
        await testOwner.db
          .update(emailVerificationRequests)
          .set({
            requestedAt:
              index < 5
                ? new Date(Date.now() - (index + 1) * 2 * 60_000)
                : new Date(Date.now() - 25 * 60 * 60_000),
          })
          .where(eq(emailVerificationRequests.id, request.id));
      }
      const hourlyResend = await registrationApp.inject({
        method: "POST",
        url: "/v1/auth/email-verification/request",
        payload: { email },
      });
      assert.equal(hourlyResend.statusCode, 202);
      assert.deepEqual(hourlyResend.json(), { accepted: true });

      for (const [index, request] of requests.entries()) {
        await testOwner.db
          .update(emailVerificationRequests)
          .set({ requestedAt: new Date(Date.now() - (index + 1) * 2 * 60 * 60_000) })
          .where(eq(emailVerificationRequests.id, request.id));
      }
      const dailyResend = await registrationApp.inject({
        method: "POST",
        url: "/v1/auth/email-verification/request",
        payload: { email },
      });
      assert.equal(dailyResend.statusCode, 202);
      assert.deepEqual(dailyResend.json(), { accepted: true });
      assert.equal(
        (
          await testOwner.db
            .select({ id: outboxEvents.id })
            .from(outboxEvents)
            .where(
              and(
                eq(outboxEvents.topic, "auth.email_verification_requested"),
                eq(outboxEvents.aggregateId, identity.id),
              ),
            )
        ).length,
        1,
      );

      const duplicateRegistration = await registrationApp.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email,
          name: "Quota Duplicate Owner",
          password: "a-secure-quota-duplicate-password",
          termsAccepted: true,
        },
      });
      assert.equal(duplicateRegistration.statusCode, 409);

      const resend = await registrationApp.inject({
        method: "POST",
        url: "/v1/auth/email-verification/request",
        payload: { email },
      });
      assert.equal(resend.statusCode, 202);
      assert.deepEqual(resend.json(), { accepted: true });
      assert.equal(resend.headers["retry-after"], "60");
      assert.equal(resend.headers["cache-control"], "no-store");
      assert.equal(
        (
          await testOwner.db
            .select({ id: emailVerificationTokens.id })
            .from(emailVerificationTokens)
            .where(eq(emailVerificationTokens.identityId, identity.id))
        ).length,
        1,
      );
      assert.equal(
        (
          await testOwner.db
            .select({ id: outboxEvents.id })
            .from(outboxEvents)
            .where(
              and(
                eq(outboxEvents.topic, "auth.email_verification_requested"),
                eq(outboxEvents.aggregateId, identity.id),
              ),
            )
        ).length,
        1,
      );
    } finally {
      await registrationApp.close();
    }
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
