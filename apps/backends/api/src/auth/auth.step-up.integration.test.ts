import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { it } from "node:test";
import { authSessions, identities } from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { AuthService } from "./auth.service.js";
import { totpCode } from "./mfa.js";

function hasCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    JSON.stringify(error.response).includes(code)
  );
}

it("confirms sensitive access changes with password or verified one-time MFA", async (context) => {
  const databaseUrl = process.env.AUTH_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("AUTH_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  process.env.MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
  const database = new DatabaseService();
  const auth = new AuthService(database);
  const password = "senha-segura-para-step-up";
  const registered = await auth.register({
    email: `step-up-${randomBytes(8).toString("hex")}@example.test`,
    displayName: "Gestor Step-up",
    password,
  });

  try {
    await auth.verifyStepUp(registered.identity.id, { currentPassword: password });
    await assert.rejects(
      auth.verifyStepUp(registered.identity.id, { currentPassword: "senha-incorreta" }),
      (error: unknown) => hasCode(error, "ACCESS_STEP_UP_INVALID"),
    );

    const [session] = await database.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(eq(authSessions.identityId, registered.identity.id))
      .limit(1);
    assert.ok(session);
    const setup = await auth.beginMfaSetup(registered.identity.id);
    const counter = Math.floor(Date.now() / 30_000);
    await assert.rejects(
      auth.verifyStepUp(registered.identity.id, { mfaCode: totpCode(setup.secret, counter) }),
      (error: unknown) => hasCode(error, "ACCESS_STEP_UP_INVALID"),
    );
    await auth.confirmMfaSetup(registered.identity.id, session.id, totpCode(setup.secret, counter));
    const stepUpCode = totpCode(setup.secret, counter + 1);
    await auth.verifyStepUp(registered.identity.id, { mfaCode: stepUpCode });
    await assert.rejects(
      auth.verifyStepUp(registered.identity.id, { mfaCode: stepUpCode }),
      (error: unknown) => hasCode(error, "ACCESS_STEP_UP_INVALID"),
    );
  } finally {
    await database.db.delete(identities).where(eq(identities.id, registered.identity.id));
    await database.onModuleDestroy();
  }
});
