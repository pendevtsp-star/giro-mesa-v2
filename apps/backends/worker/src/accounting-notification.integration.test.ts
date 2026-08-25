import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "node:test";
import {
  accountantRequests,
  createDatabase,
  identities,
  memberships,
  organizations,
  roleBindings,
  units,
} from "@giromesa/db";
import { eq, inArray, sql } from "drizzle-orm";
import { deliverAccountingRequestNotification } from "./accounting-notification.js";
import type { EmailMessage, EmailProviderConfiguration } from "./email.js";

it("notifies the accountant on creation and the authorized author on resolution", async (context) => {
  const databaseUrl = process.env.WORKER_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("WORKER_DATABASE_URL not configured");
    return;
  }
  const connection = createDatabase(databaseUrl);
  const organizationId = randomUUID();
  const identityIds = [randomUUID(), randomUUID(), randomUUID()];
  const [creatorId, accountantId, managerId] = identityIds;
  assert.ok(creatorId && accountantId && managerId);
  const messages: EmailMessage[] = [];
  const configuration: EmailProviderConfiguration = {
    apiKey: "integration-test-key",
    appUrl: "https://app.example.test",
    apiUrl: "https://api.example.test",
    from: "GiroMesa <test@example.test>",
  };
  const send = async (message: EmailMessage) => {
    messages.push(message);
    return { providerReference: "integration-message" };
  };
  try {
    await connection.db.insert(identities).values([
      { id: creatorId, email: `creator-${creatorId}@example.test`, displayName: "Dona da casa" },
      {
        id: accountantId,
        email: `accountant-${accountantId}@example.test`,
        displayName: "Ana Contadora",
      },
      { id: managerId, email: `manager-${managerId}@example.test`, displayName: "Gerente" },
    ]);
    await connection.db.insert(organizations).values({
      id: organizationId,
      legalName: "Accounting Notification Test Ltda",
      tradeName: "Restaurante Teste",
      document: organizationId.replaceAll("-", "").slice(0, 14),
      billingState: "active",
    });
    const [unit] = await connection.db
      .insert(units)
      .values({ organizationId, name: "Unidade Teste" })
      .returning();
    assert.ok(unit);
    const membershipRows = await connection.db
      .insert(memberships)
      .values(
        identityIds.map((identityId) => ({
          identityId,
          organizationId,
          status: "active" as const,
        })),
      )
      .returning();
    const membershipByIdentity = new Map(
      membershipRows.map((membership) => [membership.identityId, membership.id]),
    );
    await connection.db.insert(roleBindings).values([
      {
        membershipId: membershipByIdentity.get(creatorId) as string,
        unitId: unit.id,
        role: "owner",
      },
      {
        membershipId: membershipByIdentity.get(accountantId) as string,
        unitId: unit.id,
        role: "accountant",
      },
      {
        membershipId: membershipByIdentity.get(managerId) as string,
        unitId: unit.id,
        role: "manager",
      },
    ]);
    const [request] = await connection.db.execute<{ id: string }>(sql`
      insert into accountant_requests (
        organization_id, unit_id, created_by_identity_id, idempotency_key,
        competence, title, description, target_audience
      ) values (
        ${organizationId}, ${unit.id}, ${creatorId}, ${`integration-${randomUUID()}`},
        '2026-08-01'::date, 'descrição reservada', 'conteúdo reservado', 'accountant'
      )
      returning id
    `);
    assert.ok(request);
    const createdEvent = {
      id: randomUUID(),
      topic: "accounting.request.created",
      aggregate_type: "accountant_request",
      aggregate_id: request.id,
      attempts: 1,
      payload: {
        organizationId,
        unitId: unit.id,
        requestId: request.id,
        targetAudience: "accountant",
      },
    };
    assert.deepEqual(
      await deliverAccountingRequestNotification(connection.db, createdEvent, {
        send,
        configuration,
      }),
      { delivered: 1, stale: false },
    );
    assert.equal(messages[0]?.to, `accountant-${accountantId}@example.test`);

    await connection.db
      .update(accountantRequests)
      .set({
        status: "resolved",
        resolvedByIdentityId: accountantId,
        resolvedAt: new Date(),
        resolution: "resposta reservada",
      })
      .where(eq(accountantRequests.id, request.id));
    const resolvedEvent = {
      ...createdEvent,
      id: randomUUID(),
      topic: "accounting.request.resolved",
    };
    await deliverAccountingRequestNotification(connection.db, resolvedEvent, {
      send,
      configuration,
    });
    await deliverAccountingRequestNotification(connection.db, resolvedEvent, {
      send,
      configuration,
    });
    assert.equal(messages[1]?.to, `creator-${creatorId}@example.test`);
    assert.equal(messages[1]?.idempotencyKey, messages[2]?.idempotencyKey);
    assert.doesNotMatch(JSON.stringify(messages), /conteúdo reservado|resposta reservada/i);
  } finally {
    await connection.db
      .delete(accountantRequests)
      .where(eq(accountantRequests.organizationId, organizationId));
    await connection.db.delete(memberships).where(eq(memberships.organizationId, organizationId));
    await connection.db.delete(units).where(eq(units.organizationId, organizationId));
    await connection.db.delete(organizations).where(eq(organizations.id, organizationId));
    await connection.db.delete(identities).where(inArray(identities.id, identityIds));
    await connection.client.end();
  }
});
