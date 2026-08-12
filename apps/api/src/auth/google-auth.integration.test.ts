import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { it } from "node:test";
import { authSessions, identities, oauthAccounts, passwordCredentials } from "@giromesa/db";
import { eq, inArray } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { AuthService } from "./auth.service.js";

it("links verified Google subjects without duplicating identities", async (context) => {
  const databaseUrl = process.env.AUTH_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("AUTH_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const previousEmailProvider = process.env.EMAIL_PROVIDER_ENABLED;
  const previousOutboxKey = process.env.OUTBOX_ENCRYPTION_KEY;
  process.env.EMAIL_PROVIDER_ENABLED = "true";
  process.env.OUTBOX_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const database = new DatabaseService();
  const createdIdentityIds: string[] = [];
  try {
    const auth = new AuthService(database);
    const suffix = randomBytes(8).toString("hex");
    const email = `google-${suffix}@example.test`;
    const first = await auth.authenticateGoogle(
      { subject: `subject-${suffix}`, email, displayName: "Google Owner" },
      "signup",
    );
    assert.equal("token" in first, true);
    if (!("token" in first)) return;
    createdIdentityIds.push(first.identity.id);

    const replay = await auth.authenticateGoogle(
      {
        subject: `subject-${suffix}`,
        email: `changed-${suffix}@example.test`,
        displayName: "Changed Name",
      },
      "login",
    );
    assert.equal("token" in replay && replay.identity.id, first.identity.id);

    const [linked] = await database.db
      .select({ account: oauthAccounts, identity: identities })
      .from(oauthAccounts)
      .innerJoin(identities, eq(identities.id, oauthAccounts.identityId))
      .where(eq(oauthAccounts.providerSubject, `subject-${suffix}`));
    assert.equal(linked?.identity.email, email);
    assert.equal(linked?.identity.emailVerifiedAt instanceof Date, true);
    assert.equal(linked?.account.provider, "google");

    const local = await auth.register({
      email: `local-${suffix}@example.test`,
      displayName: "Local Owner",
      password: "a-secure-local-password",
    });
    assert.equal(local.verificationRequired, true);
    const [localIdentity] = await database.db
      .select()
      .from(identities)
      .where(eq(identities.email, local.email));
    assert.ok(localIdentity);
    createdIdentityIds.push(localIdentity.id);
    const linkedLocal = await auth.authenticateGoogle(
      {
        subject: `local-subject-${suffix}`,
        email: local.email,
        displayName: "Local Owner",
      },
      "login",
    );
    assert.equal("token" in linkedLocal && linkedLocal.identity.id, localIdentity.id);
    assert.equal(
      (
        await database.db
          .select()
          .from(passwordCredentials)
          .where(eq(passwordCredentials.identityId, localIdentity.id))
      ).length,
      0,
    );
    await assert.rejects(
      auth.login({
        email: local.email,
        password: "a-secure-local-password",
        trustedDevice: false,
      }),
      (error: unknown) => JSON.stringify(error).includes("INVALID_CREDENTIALS"),
    );

    const verifiedLocal = await auth.register({
      email: `verified-local-${suffix}@example.test`,
      displayName: "Verified Local Owner",
      password: "verified-local-password",
    });
    const [verifiedLocalIdentity] = await database.db
      .update(identities)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(identities.email, verifiedLocal.email))
      .returning();
    assert.ok(verifiedLocalIdentity);
    createdIdentityIds.push(verifiedLocalIdentity.id);
    await auth.authenticateGoogle(
      {
        subject: `verified-local-subject-${suffix}`,
        email: verifiedLocal.email,
        displayName: "Verified Local Owner",
      },
      "login",
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(passwordCredentials)
          .where(eq(passwordCredentials.identityId, verifiedLocalIdentity.id))
      ).length,
      1,
    );
    const verifiedLocalLogin = await auth.login({
      email: verifiedLocal.email,
      password: "verified-local-password",
      trustedDevice: false,
    });
    assert.equal("token" in verifiedLocalLogin, true);

    await assert.rejects(
      auth.authenticateGoogle(
        {
          subject: `unknown-${suffix}`,
          email: `unknown-${suffix}@example.test`,
          displayName: "Unknown",
        },
        "login",
      ),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        JSON.stringify(error.response).includes("GOOGLE_ACCOUNT_NOT_LINKED"),
    );

    const sessions = await database.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(inArray(authSessions.identityId, createdIdentityIds));
    assert.equal(sessions.length, 5);
  } finally {
    if (createdIdentityIds.length > 0) {
      await database.db.delete(identities).where(inArray(identities.id, createdIdentityIds));
    }
    await database.onModuleDestroy();
    if (previousEmailProvider === undefined) delete process.env.EMAIL_PROVIDER_ENABLED;
    else process.env.EMAIL_PROVIDER_ENABLED = previousEmailProvider;
    if (previousOutboxKey === undefined) delete process.env.OUTBOX_ENCRYPTION_KEY;
    else process.env.OUTBOX_ENCRYPTION_KEY = previousOutboxKey;
  }
});
