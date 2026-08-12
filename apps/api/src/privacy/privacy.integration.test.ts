import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, describe, it } from "node:test";
import { createDatabase } from "@giromesa/db";
import { ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import type { AuthContext } from "../auth/auth.service.js";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { PrivacyService } from "./privacy.service.js";

const integrationUrl = process.env.TENANT_ISOLATION_DATABASE_URL;
const connection = integrationUrl ? createDatabase(integrationUrl, { max: 4 }) : undefined;
const database = connection ? new DatabaseService(connection) : undefined;
const privacy = database ? new PrivacyService(database, new ScopeService(database)) : undefined;

after(async () => {
  await database?.onModuleDestroy();
});

describe("privacy API service on real PostgreSQL", () => {
  it("requires step-up and makes create/approve replay-safe", async (context) => {
    if (!connection || !database || !privacy) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }
    const suffix = randomUUID().replaceAll("-", "");
    const organizationId = randomUUID();
    const ownerId = randomUUID();
    const managerId = randomUUID();
    const ownerMembership = randomUUID();
    const managerMembership = randomUUID();
    await connection.client`
      insert into organizations (id, legal_name, trade_name, document)
      values (${organizationId}, 'Privacy API Ltda', 'Privacy API', ${suffix.slice(0, 14)})
    `;
    await connection.client`
      insert into identities (id, email, display_name, email_verified_at)
      values
        (${ownerId}, ${`privacy-api-owner-${suffix}@example.test`}, 'Privacy API Owner', now()),
        (${managerId}, ${`privacy-api-manager-${suffix}@example.test`}, 'Privacy API Manager', now())
    `;
    await connection.client`
      insert into memberships (id, identity_id, organization_id, status)
      values
        (${ownerMembership}, ${ownerId}, ${organizationId}, 'active'),
        (${managerMembership}, ${managerId}, ${organizationId}, 'active')
    `;
    await connection.client`
      insert into role_bindings (membership_id, role)
      values (${ownerMembership}, 'owner'), (${managerMembership}, 'manager')
    `;
    const staleAuth: AuthContext = {
      identityId: ownerId,
      email: `privacy-api-owner-${suffix}@example.test`,
      displayName: "Privacy API Owner",
      sessionId: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
      mfaVerifiedAt: new Date(Date.now() - 11 * 60_000),
    };
    const steppedUpAuth: AuthContext = { ...staleAuth, mfaVerifiedAt: new Date() };
    const managerAuth: AuthContext = {
      ...steppedUpAuth,
      identityId: managerId,
      email: `privacy-api-manager-${suffix}@example.test`,
      displayName: "Privacy API Manager",
    };

    const created = await database.withTenantContext(
      { source: "http", organizationId, actorIdentityId: ownerId },
      () =>
        privacy.create(steppedUpAuth, organizationId, "privacy-idempotency-0001", {
          type: "access_export",
        }),
    );
    assert.equal(created.steps.length, 8);
    assert.ok(created.steps.every((step) => step.status === "pending"));
    assert.ok(created.steps.every((step) => step.reasonCode === null));
    const replayed = await database.withTenantContext(
      { source: "http", organizationId, actorIdentityId: ownerId },
      () =>
        privacy.create(steppedUpAuth, organizationId, "privacy-idempotency-0001", {
          type: "access_export",
        }),
    );
    assert.equal(replayed.id, created.id);
    await assert.rejects(
      () =>
        database.withTenantContext(
          { source: "http", organizationId, actorIdentityId: ownerId },
          () =>
            privacy.create(steppedUpAuth, organizationId, "privacy-idempotency-0001", {
              type: "anonymization",
              reason: "The subject requested account anonymization",
            }),
        ),
      ConflictException,
    );
    await assert.rejects(
      () =>
        database.withTenantContext(
          { source: "http", organizationId, actorIdentityId: ownerId },
          () => privacy.verify(staleAuth, organizationId, created.id),
        ),
      ForbiddenException,
    );
    const verified = await database.withTenantContext(
      { source: "http", organizationId, actorIdentityId: ownerId },
      () => privacy.verify(steppedUpAuth, organizationId, created.id),
    );
    assert.equal(verified.state, "approval_pending");
    const approved = await database.withTenantContext(
      { source: "http", organizationId, actorIdentityId: ownerId },
      () => privacy.approve(steppedUpAuth, organizationId, created.id),
    );
    const approvalReplay = await database.withTenantContext(
      { source: "http", organizationId, actorIdentityId: ownerId },
      () => privacy.approve(steppedUpAuth, organizationId, created.id),
    );
    assert.equal(approved.state, "processing");
    assert.equal(approvalReplay.state, "processing");
    const [eventCount] = await connection.client<{ count: number; aggregate_id: string }[]>`
      select count(*)::int as count, min(aggregate_id) as aggregate_id from outbox_events
      where topic = 'privacy.request.processing'
        and payload ->> 'requestId' = ${created.id}
    `;
    assert.equal(eventCount?.count, 1);
    assert.equal(eventCount?.aggregate_id, `${created.id}:1`);

    await assert.rejects(
      () =>
        database.withTenantContext(
          { source: "http", organizationId, actorIdentityId: managerId },
          () => privacy.get(managerAuth.identityId, organizationId, created.id),
        ),
      NotFoundException,
    );

    await connection.client`delete from organizations where id = ${organizationId}`;
    await connection.client`delete from identities where id in (${ownerId}, ${managerId})`;
  });
});
