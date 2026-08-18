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
    createdIdentityIds.push(local.identity.id);
    const linkedLocal = await auth.authenticateGoogle(
      {
        subject: `local-subject-${suffix}`,
        email: local.identity.email,
        displayName: "Local Owner",
      },
      "login",
    );
    assert.equal("token" in linkedLocal && linkedLocal.identity.id, local.identity.id);
    assert.equal(
      (
        await database.db
          .select()
          .from(passwordCredentials)
          .where(eq(passwordCredentials.identityId, local.identity.id))
      ).length,
      1,
    );

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
    assert.equal(sessions.length, 4);
  } finally {
    if (createdIdentityIds.length > 0) {
      await database.db.delete(identities).where(inArray(identities.id, createdIdentityIds));
    }
    await database.onModuleDestroy();
  }
});
