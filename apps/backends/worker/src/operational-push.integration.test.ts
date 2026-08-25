import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  authSessions,
  createDatabase,
  identities,
  memberships,
  organizations,
  posDiningRooms,
  posDiningTables,
  posOperationalPushSubscriptions,
  posServiceCalls,
  roleBindings,
  units,
} from "@giromesa/db";
import { encryptionKey, encryptSecret } from "@giromesa/domain";
import { eq } from "drizzle-orm";
import webPush from "web-push";
import { deliverOperationalPush } from "./operational-push.js";

it("targets an active unit operator and removes a 410 subscription", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("WORKER_DATABASE_URL not configured");
    return;
  }
  process.env.DATABASE_URL = databaseUrl;
  const connection = createDatabase();
  const identityId = randomUUID();
  const organizationId = randomUUID();
  const installationId = randomUUID();
  const previous = {
    subject: process.env.WEB_PUSH_VAPID_SUBJECT,
    publicKey: process.env.WEB_PUSH_VAPID_PUBLIC_KEY,
    privateKey: process.env.WEB_PUSH_VAPID_PRIVATE_KEY,
    encryptionKey: process.env.OUTBOX_ENCRYPTION_KEY,
  };
  const vapid = webPush.generateVAPIDKeys();
  process.env.WEB_PUSH_VAPID_SUBJECT = "mailto:push@example.test";
  process.env.WEB_PUSH_VAPID_PUBLIC_KEY = vapid.publicKey;
  process.env.WEB_PUSH_VAPID_PRIVATE_KEY = vapid.privateKey;
  process.env.OUTBOX_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  try {
    await connection.db.insert(identities).values({
      id: identityId,
      email: `worker-push-${identityId}@example.test`,
      displayName: "Worker Push Operator",
    });
    await connection.db.insert(organizations).values({
      id: organizationId,
      legalName: "Worker Push Test Ltda",
      tradeName: "Worker Push Test",
      document: organizationId.replaceAll("-", "").slice(0, 14),
      billingState: "active",
    });
    const [unit] = await connection.db
      .insert(units)
      .values({ organizationId, name: "Worker Push Unit" })
      .returning();
    assert.ok(unit);
    const [membership] = await connection.db
      .insert(memberships)
      .values({ identityId, organizationId, status: "active" })
      .returning();
    assert.ok(membership);
    await connection.db.insert(roleBindings).values({
      membershipId: membership.id,
      unitId: unit.id,
      role: "waiter",
    });
    const [session] = await connection.db
      .insert(authSessions)
      .values({
        identityId,
        tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        expiresAt: new Date(Date.now() + 60_000),
      })
      .returning();
    const [room] = await connection.db
      .insert(posDiningRooms)
      .values({ organizationId, unitId: unit.id, name: "Salão" })
      .returning();
    assert.ok(session && room);
    const [table] = await connection.db
      .insert(posDiningTables)
      .values({ organizationId, unitId: unit.id, roomId: room.id, label: "Mesa 7" })
      .returning();
    assert.ok(table);
    const [call] = await connection.db
      .insert(posServiceCalls)
      .values({ organizationId, unitId: unit.id, tableId: table.id, kind: "assistance" })
      .returning();
    assert.ok(call);
    const subscription = {
      endpoint: "https://fcm.googleapis.com/fcm/send/worker-test",
      expirationTime: null,
      keys: { p256dh: "A".repeat(87), auth: "B".repeat(22) },
    };
    const envelope = encryptSecret(
      JSON.stringify(subscription),
      encryptionKey(process.env.OUTBOX_ENCRYPTION_KEY, "OUTBOX_ENCRYPTION_KEY"),
      `web-push:${installationId}`,
    );
    await connection.db.insert(posOperationalPushSubscriptions).values({
      installationId,
      organizationId,
      unitId: unit.id,
      identityId,
      sessionId: session.id,
      endpointHash: "a".repeat(64),
      encryptedSubscription: envelope.encryptedSecret,
      encryptionIv: envelope.iv,
      encryptionAuthTag: envelope.authTag,
    });
    const event = {
      id: randomUUID(),
      topic: "pos.call.opened",
      aggregate_type: "service_call",
      aggregate_id: call.id,
      attempts: 1,
      payload: {
        organizationId,
        unitId: unit.id,
        callId: call.id,
        tableId: table.id,
        kind: "assistance",
        responsibleIdentityId: null,
      },
    };
    const payloads: string[] = [];
    const delivered = await deliverOperationalPush(
      connection.db,
      event,
      async (_target, payload) => {
        if (typeof payload !== "string") throw new Error("Expected a string payload");
        payloads.push(payload);
        return {} as never;
      },
    );
    assert.equal(delivered?.delivered, 1);
    assert.equal(JSON.parse(payloads[0] ?? "{}").title, "Mesa 7 chamou o atendimento");
    const expired = await deliverOperationalPush(connection.db, event, async () => {
      throw { statusCode: 410 };
    });
    assert.equal(expired?.expired, 1);
    assert.equal(
      (
        await connection.db
          .select()
          .from(posOperationalPushSubscriptions)
          .where(eq(posOperationalPushSubscriptions.installationId, installationId))
      ).length,
      0,
    );
  } finally {
    await connection.db
      .delete(posOperationalPushSubscriptions)
      .where(eq(posOperationalPushSubscriptions.organizationId, organizationId));
    await connection.db
      .delete(posServiceCalls)
      .where(eq(posServiceCalls.organizationId, organizationId));
    await connection.db
      .delete(posDiningTables)
      .where(eq(posDiningTables.organizationId, organizationId));
    await connection.db
      .delete(posDiningRooms)
      .where(eq(posDiningRooms.organizationId, organizationId));
    await connection.db.delete(memberships).where(eq(memberships.organizationId, organizationId));
    await connection.db.delete(authSessions).where(eq(authSessions.identityId, identityId));
    await connection.db.delete(units).where(eq(units.organizationId, organizationId));
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(identities).where(eq(identities.id, identityId));
    await connection.client.end();
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
