import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  authSessions,
  identities,
  memberships,
  organizations,
  posOperationalPushSubscriptions,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PilotPosService } from "./pilot-pos.service.js";

it("persists an encrypted, session-scoped operational push subscription", async (context) => {
  const databaseUrl = process.env.PILOT_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("PILOT_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const previous = {
    subject: process.env.WEB_PUSH_VAPID_SUBJECT,
    publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
    privateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
    encryptionKey: process.env.OUTBOX_ENCRYPTION_KEY,
  };
  process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:push@example.test";
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = "P".repeat(87);
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = "K".repeat(43);
  process.env.OUTBOX_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const database = new DatabaseService();
  const identityId = randomUUID();
  const organizationId = randomUUID();
  const otherOrganizationId = randomUUID();
  try {
    await database.db.insert(identities).values({
      id: identityId,
      email: `push-${identityId}@example.test`,
      displayName: "Push Operator",
    });
    await database.db.insert(organizations).values([
      {
        id: organizationId,
        legalName: "Push Test Ltda",
        tradeName: "Push Test",
        document: identityId.replaceAll("-", "").slice(0, 14),
        billingState: "active",
      },
      {
        id: otherOrganizationId,
        legalName: "Other Push Test Ltda",
        tradeName: "Other Push Test",
        document: otherOrganizationId.replaceAll("-", "").slice(0, 14),
        billingState: "active",
      },
    ]);
    const [unit, otherUnit] = await database.db
      .insert(units)
      .values([
        { organizationId, name: "Push Unit" },
        { organizationId: otherOrganizationId, name: "Other Push Unit" },
      ])
      .returning();
    assert.ok(unit && otherUnit);
    const [membership] = await database.db
      .insert(memberships)
      .values({ identityId, organizationId, status: "active" })
      .returning();
    assert.ok(membership);
    await database.db.insert(roleBindings).values({ membershipId: membership.id, role: "waiter" });
    const [session] = await database.db
      .insert(authSessions)
      .values({
        identityId,
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    assert.ok(session);
    const service = new PilotPosService(database, new ScopeService(database));
    const installationId = randomUUID();
    const endpoint = "https://fcm.googleapis.com/fcm/send/test-subscription";
    const subscribed = await service.upsertOperationalPushSubscription(
      identityId,
      session.id,
      organizationId,
      unit.id,
      installationId,
      {
        endpoint,
        expirationTime: null,
        keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
      },
    );
    assert.equal(subscribed.active, true);
    const [stored] = await database.db
      .select()
      .from(posOperationalPushSubscriptions)
      .where(eq(posOperationalPushSubscriptions.installationId, installationId));
    assert.ok(stored);
    assert.equal(stored.encryptedSubscription.includes(endpoint), false);
    assert.equal(stored.identityId, identityId);
    assert.equal(stored.sessionId, session.id);
    assert.equal(
      (
        await service.operationalPushConfig(
          identityId,
          session.id,
          organizationId,
          unit.id,
          installationId,
        )
      ).active,
      true,
    );
    await assert.rejects(() =>
      service.operationalPushConfig(
        identityId,
        session.id,
        otherOrganizationId,
        otherUnit.id,
        installationId,
      ),
    );
    await service.removeOperationalPushSubscription(
      identityId,
      session.id,
      organizationId,
      unit.id,
      installationId,
    );
    assert.equal(
      (
        await database.db
          .select()
          .from(posOperationalPushSubscriptions)
          .where(eq(posOperationalPushSubscriptions.installationId, installationId))
      ).length,
      0,
    );
  } finally {
    await database.db.delete(organizations).where(eq(organizations.id, organizationId));
    await database.db.delete(organizations).where(eq(organizations.id, otherOrganizationId));
    await database.db.delete(identities).where(eq(identities.id, identityId));
    await database.onModuleDestroy();
    for (const [key, value] of Object.entries({
      WEB_PUSH_VAPID_SUBJECT: previous.subject,
      WEB_PUSH_VAPID_PUBLIC_KEY: previous.publicKey,
      WEB_PUSH_VAPID_PRIVATE_KEY: previous.privateKey,
      OUTBOX_ENCRYPTION_KEY: previous.encryptionKey,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
