import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { auditEvents, createDatabase, type DatabaseConnection, organizations } from "@giromesa/db";
import { eq } from "drizzle-orm";
import type { AuthContext } from "../auth/auth.service.js";
import { DatabaseService } from "../database/database.module.js";
import { PlatformService } from "./platform.service.js";

const integrationUrl = process.env.PLATFORM_ACTIONS_DATABASE_URL;
let connection: DatabaseConnection | undefined;
let service: PlatformService | undefined;

const suffix = randomUUID().replaceAll("-", "");
const organizationA = randomUUID();
const organizationB = randomUUID();
const identityA = randomUUID();
const identityB = randomUUID();
const ownerIdentityA = randomUUID();
const ownerIdentityB = randomUUID();
const ownerMembershipA = randomUUID();
const ownerMembershipB = randomUUID();
const sessionA = randomUUID();
const sessionB = randomUUID();
const emailA = `platform-a-${suffix}@example.test`;
const emailB = `platform-b-${suffix}@example.test`;

function auth(identityId: string, sessionId: string, email: string): AuthContext {
  return {
    identityId,
    sessionId,
    email,
    displayName: "Platform operator",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  };
}

before(async () => {
  if (!integrationUrl) return;
  connection = createDatabase(integrationUrl, { max: 8 });
  service = new PlatformService(new DatabaseService(connection));
  process.env.PLATFORM_ADMIN_EMAILS = `${emailA},${emailB}`;
  const grants = [
    "platform.action.propose",
    "platform.action.approve",
    "platform.action.reject",
    "platform.tenant.suspend",
      "platform.tenant.restore",
      "platform.membership.disable",
      "platform.membership.restore",
  ].join("|");
  process.env.PLATFORM_ADMIN_GRANTS = `${emailA}=${grants};${emailB}=${grants}`;
  await connection.client`
    insert into organizations (id, legal_name, trade_name, document, billing_state)
    values
      (${organizationA}, 'Platform A Ltda', 'Platform A', ${suffix.slice(0, 14)}, 'active'),
      (${organizationB}, 'Platform B Ltda', 'Platform B', ${suffix.slice(14, 28)}, 'active')
  `;
  await connection.client`
    insert into identities (id, email, display_name, email_verified_at)
    values
      (${identityA}, ${emailA}, 'Operator A', now()),
      (${identityB}, ${emailB}, 'Operator B', now()),
      (${ownerIdentityA}, ${`owner-a-${suffix}@example.test`}, 'Owner A', now()),
      (${ownerIdentityB}, ${`owner-b-${suffix}@example.test`}, 'Owner B', now())
  `;
  await connection.client`
    insert into memberships (id, identity_id, organization_id, status)
    values
      (${ownerMembershipA}, ${ownerIdentityA}, ${organizationB}, 'active'),
      (${ownerMembershipB}, ${ownerIdentityB}, ${organizationB}, 'active')
  `;
  await connection.client`
    insert into role_bindings (membership_id, role)
    values (${ownerMembershipA}, 'owner'), (${ownerMembershipB}, 'owner')
  `;
  await connection.client`
    insert into auth_sessions (id, identity_id, token_hash, expires_at)
    values
      (${sessionA}, ${identityA}, ${"a".repeat(64)}, now() + interval '1 hour'),
      (${sessionB}, ${identityB}, ${"b".repeat(64)}, now() + interval '1 hour')
  `;
  await connection.db.insert(auditEvents).values([
    {
      actorIdentityId: identityA,
      action: "auth.mfa_verified",
      entityType: "session",
      entityId: sessionA,
    },
    {
      actorIdentityId: identityB,
      action: "auth.mfa_verified",
      entityType: "session",
      entityId: sessionB,
    },
  ]);
});

after(async () => {
  if (!connection) return;
  await connection.client`delete from audit_events where organization_id in (${organizationA}, ${organizationB}) or actor_identity_id in (${identityA}, ${identityB})`;
  await connection.client`delete from identities where id in (${identityA}, ${identityB}, ${ownerIdentityA}, ${ownerIdentityB})`;
  await connection.client`delete from organizations where id in (${organizationA}, ${organizationB})`;
  await connection.client.end();
  delete process.env.PLATFORM_ADMIN_EMAILS;
  delete process.env.PLATFORM_ADMIN_GRANTS;
});

describe("platform actions in PostgreSQL", () => {
  it("serializes proposal and approval, enforces tenant scope, and applies one effect", async (context) => {
    if (!service || !connection)
      return context.skip("PLATFORM_ACTIONS_DATABASE_URL not configured");
    const requester = auth(identityA, sessionA, emailA);
    const approver = auth(identityB, sessionB, emailB);
    const request = {
      action: "tenant.suspend" as const,
      targetId: organizationA,
      justification: "Incidente operacional confirmado e documentado.",
      payload: { expectedState: "active" as const },
    };
    const [left, right] = await Promise.all([
      service.propose(requester, organizationA, "proposal-idempotency-0001", request),
      service.propose(requester, organizationA, "proposal-idempotency-0001", request),
    ]);
    assert.equal(left.id, right.id);
    assert.equal(left.status, "pending");

    await assert.rejects(
      service.propose(requester, organizationA, "proposal-idempotency-0002", {
        ...request,
        targetId: organizationB,
      }),
      /PLATFORM_TARGET_SCOPE_MISMATCH/,
    );
    await assert.rejects(
      service.approve(requester, organizationA, left.id, "approval-self-0001", 1),
      /DUAL_CONTROL_REQUIRED/,
    );

    const [approvedLeft, approvedRight] = await Promise.all([
      service.approve(approver, organizationA, left.id, "approval-idempotency-0001", 1),
      service.approve(approver, organizationA, left.id, "approval-idempotency-0001", 1),
    ]);
    assert.equal(approvedLeft.status, "executed");
    assert.deepEqual(approvedRight, approvedLeft);
    const [organization] = await connection.db
      .select({ state: organizations.billingState })
      .from(organizations)
      .where(eq(organizations.id, organizationA));
    assert.equal(organization?.state, "suspended");
    const executions = await connection.client<{ count: number }[]>`
      select count(*)::int as count from audit_events
      where organization_id = ${organizationA}
        and entity_id = ${left.id}
        and action = 'platform.action.executed'
    `;
    assert.equal(executions[0]?.count, 1);

    const tenantProjection = await service.projection(requester, organizationA, "tenant", {
      limit: 20,
    });
    assert.equal(tenantProjection.availability, "available");
    assert.ok(tenantProjection.items.every((item) => item.organizationId === organizationA));
    assert.equal(
      tenantProjection.items.some((item) => Object.values(item).includes(organizationB)),
      false,
    );
  });

  it("binds a decision idempotency key to proposal, command, and body", async (context) => {
    if (!service || !connection)
      return context.skip("PLATFORM_ACTIONS_DATABASE_URL not configured");
    const requester = auth(identityA, sessionA, emailA);
    const approver = auth(identityB, sessionB, emailB);
    const proposal = await service.propose(requester, organizationB, "decision-proposal-0001", {
      action: "tenant.suspend",
      targetId: organizationB,
      justification: "Incidente isolado com evidência suficiente para decisão.",
      payload: { expectedState: "active" },
    });
    const executed = await service.approve(
      approver,
      organizationB,
      proposal.id,
      "decision-command-0001",
      1,
    );
    assert.equal(executed.status, "executed");
    await assert.rejects(
      service.reject(
        approver,
        organizationB,
        proposal.id,
        "decision-command-0001",
        1,
      ),
      /PLATFORM_IDEMPOTENCY_CONFLICT/,
    );
  });

  it("serializes owner changes by organization and never disables the final owner", async (context) => {
    if (!service || !connection)
      return context.skip("PLATFORM_ACTIONS_DATABASE_URL not configured");
    const requester = auth(identityA, sessionA, emailA);
    const approver = auth(identityB, sessionB, emailB);
    const functionName = `platform_owner_delay_${suffix}`;
    const triggerName = `platform_owner_delay_${suffix}`;
    await connection.client.unsafe(`
      create function "${functionName}"() returns trigger language plpgsql as $$
      begin
        if old.organization_id = '${organizationB}'::uuid and new.status = 'disabled' then
          perform pg_sleep(0.4);
        end if;
        return new;
      end
      $$
    `);
    await connection.client.unsafe(`
      create trigger "${triggerName}" before update on memberships
      for each row execute function "${functionName}"()
    `);
    try {
      const [proposalA, proposalB] = await Promise.all([
        service.propose(requester, organizationB, "owner-proposal-a-0001", {
          action: "membership.disable",
          targetId: ownerMembershipA,
          justification: "Desativação controlada do primeiro owner com revisão independente.",
          payload: { expectedState: "active" },
        }),
        service.propose(requester, organizationB, "owner-proposal-b-0001", {
          action: "membership.disable",
          targetId: ownerMembershipB,
          justification: "Desativação controlada do segundo owner com revisão independente.",
          payload: { expectedState: "active" },
        }),
      ]);
      const decisions = await Promise.allSettled([
        service.approve(approver, organizationB, proposalA.id, "owner-approval-a-0001", 1),
        service.approve(approver, organizationB, proposalB.id, "owner-approval-b-0001", 1),
      ]);
      assert.equal(decisions.filter((decision) => decision.status === "fulfilled").length, 1);
      assert.equal(decisions.filter((decision) => decision.status === "rejected").length, 1);
      const activeOwners = await connection.client<{ count: number }[]>`
        select count(distinct membership.id)::int as count
        from memberships as membership
        join role_bindings as binding on binding.membership_id = membership.id
        where membership.organization_id = ${organizationB}
          and membership.status = 'active'
          and binding.role = 'owner'
      `;
      assert.equal(activeOwners[0]?.count, 1);
    } finally {
      await connection.client.unsafe(`drop trigger if exists "${triggerName}" on memberships`);
      await connection.client.unsafe(`drop function if exists "${functionName}"()`);
    }
  });
});
