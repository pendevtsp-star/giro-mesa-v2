import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { createDatabase, type DatabaseConnection } from "@giromesa/db";
import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AuthService } from "../auth/auth.service.js";
import { SessionGuard } from "../auth/session.guard.js";
import { DatabaseService } from "../database/database.module.js";
import { TenantContextInterceptor } from "../database/tenant-context.interceptor.js";
import { PlatformController } from "./platform.controller.js";
import { PlatformAdminGuard } from "./platform.guard.js";
import { PlatformService } from "./platform.service.js";
import { PlatformExceptionFilter } from "./platform-exception.filter.js";

const integrationUrl = process.env.PLATFORM_HTTP_DATABASE_URL;
let ownerConnection: DatabaseConnection | undefined;
let applicationConnection: DatabaseConnection | undefined;
let app: NestFastifyApplication | undefined;

const suffix = randomUUID().replaceAll("-", "");
const loginRole = `giromesa_platform_http_${suffix}`;
const password = `platform-http-${suffix}`;
const organizationId = randomUUID();
const identityA = randomUUID();
const identityB = randomUUID();
const sessionA = randomUUID();
const sessionB = randomUUID();
const tokenA = `platform-http-a-${suffix}`;
const tokenB = `platform-http-b-${suffix}`;
const emailA = `platform-http-a-${suffix}@example.test`;
const emailB = `platform-http-b-${suffix}@example.test`;

function applicationUrl(ownerUrl: string) {
  const url = new URL(ownerUrl);
  url.username = loginRole;
  url.password = password;
  return url.toString();
}

@Module({
  controllers: [PlatformController],
  providers: [
    {
      provide: DatabaseService,
      useFactory: () => {
        if (!applicationConnection) throw new Error("application connection is unavailable");
        return new DatabaseService(applicationConnection);
      },
    },
    AuthService,
    SessionGuard,
    PlatformService,
    PlatformAdminGuard,
    PlatformExceptionFilter,
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
class PlatformHttpTestModule {}

before(async () => {
  if (!integrationUrl) return;
  ownerConnection = createDatabase(integrationUrl);
  const owner = ownerConnection.client;
  await owner.unsafe(
    `create role "${loginRole}" login password '${password}' noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
  );
  const platformRole = await owner<{ exists: boolean }[]>`
    select exists(select 1 from pg_roles where rolname = 'giromesa_platform') as exists
  `;
  const grantedRoles = platformRole[0]?.exists
    ? "giromesa_app, giromesa_identity, giromesa_platform"
    : "giromesa_app, giromesa_identity";
  await owner.unsafe(`grant ${grantedRoles} to "${loginRole}"`);
  await owner`
    insert into organizations (id, legal_name, trade_name, document, billing_state)
    values (${organizationId}, 'Platform HTTP Ltda', 'Platform HTTP', ${suffix.slice(0, 14)}, 'active')
  `;
  await owner`
    insert into identities (id, email, display_name, email_verified_at)
    values
      (${identityA}, ${emailA}, 'Platform HTTP A', now()),
      (${identityB}, ${emailB}, 'Platform HTTP B', now())
  `;
  await owner`
    insert into auth_sessions (id, identity_id, token_hash, expires_at)
    values
      (${sessionA}, ${identityA}, ${createHash("sha256").update(tokenA).digest("hex")}, now() + interval '1 hour'),
      (${sessionB}, ${identityB}, ${createHash("sha256").update(tokenB).digest("hex")}, now() + interval '1 hour')
  `;
  await owner`
    insert into audit_events (actor_identity_id, action, entity_type, entity_id)
    values
      (${identityA}, 'auth.mfa_verified', 'session', ${sessionA}),
      (${identityB}, 'auth.mfa_verified', 'session', ${sessionB})
  `;
  process.env.PLATFORM_ADMIN_EMAILS = `${emailA},${emailB}`;
  const grants = [
    "platform.action.propose",
    "platform.action.approve",
    "platform.action.reject",
    "platform.tenant.suspend",
    "platform.tenant.restore",
  ].join("|");
  process.env.PLATFORM_ADMIN_GRANTS = `${emailA}=${grants};${emailB}=${grants}`;
  applicationConnection = createDatabase(applicationUrl(integrationUrl), { max: 4 });
  app = await NestFactory.create<NestFastifyApplication>(
    PlatformHttpTestModule,
    new FastifyAdapter({ logger: false }),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

after(async () => {
  if (!ownerConnection) return;
  if (app) await app.close();
  app = undefined;
  applicationConnection = undefined;
  const owner = ownerConnection.client;
  await owner`delete from organizations where id = ${organizationId}`;
  await owner`delete from identities where id in (${identityA}, ${identityB})`;
  await owner.unsafe(`drop owned by "${loginRole}"`);
  await owner.unsafe(`drop role "${loginRole}"`);
  await owner.end();
  ownerConnection = undefined;
  delete process.env.PLATFORM_ADMIN_EMAILS;
  delete process.env.PLATFORM_ADMIN_GRANTS;
});

describe("platform HTTP database boundary", () => {
  it("lets an allowlisted platform reader cross tenant RLS without a membership on both aliases", async (context) => {
    if (!app) return context.skip("PLATFORM_HTTP_DATABASE_URL not configured");
    for (const prefix of ["/v1", "/api/v1"]) {
      const overview: { statusCode: number; body: string } = await app.inject({
        method: "GET",
        url: `${prefix}/platform/overview`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      assert.equal(overview.statusCode, 200, overview.body);
      const tenant: {
        statusCode: number;
        body: string;
        json(): { organization: { id: string } };
      } =
        await app.inject({
        method: "GET",
        url: `${prefix}/platform/tenants/${organizationId}/context`,
        headers: { authorization: `Bearer ${tokenA}` },
        });
      assert.equal(tenant.statusCode, 200, tenant.body);
      assert.equal(tenant.json().organization.id, organizationId);
    }
  });

  it("maps only allowlisted domain failures to stable client errors", async (context) => {
    if (!app || !ownerConnection)
      return context.skip("PLATFORM_HTTP_DATABASE_URL not configured");
    const invalid = await app.inject({
      method: "POST",
      url: `/v1/platform/tenants/${organizationId}/actions`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        "idempotency-key": "invalid-payload-0001",
      },
      payload: { action: "tenant.suspend", secret: "must-not-surface" },
    });
    assert.equal(invalid.statusCode, 400, invalid.body);
    assert.equal(invalid.json().code, "INVALID_PLATFORM_ACTION");
    assert.equal(invalid.body.includes("must-not-surface"), false);

    const proposal = await app.inject({
      method: "POST",
      url: `/api/v1/platform/tenants/${organizationId}/actions`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        "idempotency-key": "http-proposal-0001",
      },
      payload: {
        action: "tenant.suspend",
        targetId: organizationId,
        justification: "Incidente confirmado com plano de recuperação documentado.",
        payload: { expectedState: "active" },
      },
    });
    assert.equal(proposal.statusCode, 201, proposal.body);
    const proposalId = proposal.json().id as string;
    const selfApproval = await app.inject({
      method: "POST",
      url: `/v1/platform/tenants/${organizationId}/actions/${proposalId}/approve`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        "idempotency-key": "http-self-approve-0001",
      },
      payload: { expectedVersion: 1 },
    });
    assert.equal(selfApproval.statusCode, 403, selfApproval.body);
    assert.equal(selfApproval.json().code, "DUAL_CONTROL_REQUIRED");

    const stale = await app.inject({
      method: "POST",
      url: `/v1/platform/tenants/${organizationId}/actions/${proposalId}/approve`,
      headers: {
        authorization: `Bearer ${tokenB}`,
        "idempotency-key": "http-stale-approve-0001",
      },
      payload: { expectedVersion: 2 },
    });
    assert.equal(stale.statusCode, 409, stale.body);
    assert.equal(stale.json().code, "PLATFORM_ACTION_VERSION_CONFLICT");

    const expiredId = randomUUID();
    await ownerConnection.client`
      insert into audit_events (
        organization_id, actor_identity_id, action, entity_type, entity_id, metadata, occurred_at
      ) values (
        ${organizationId},
        ${identityA},
        'platform.action.proposed',
        'platform_action',
        ${expiredId},
        ${JSON.stringify({
          version: 1,
          status: "pending",
          action: "tenant.suspend",
          targetType: "organization",
          targetId: organizationId,
          justification: "Proposta expirada construída para validar o contrato HTTP.",
          payload: { expectedState: "active" },
          expiresAt: new Date(Date.now() - 60_000).toISOString(),
          idempotencyHash: "test",
          requestFingerprint: "test",
        })}::jsonb,
        now() - interval '2 minutes'
      )
    `;
    const expired = await app.inject({
      method: "POST",
      url: `/api/v1/platform/tenants/${organizationId}/actions/${expiredId}/approve`,
      headers: {
        authorization: `Bearer ${tokenB}`,
        "idempotency-key": "http-expired-approve-0001",
      },
      payload: { expectedVersion: 1 },
    });
    assert.equal(expired.statusCode, 410, expired.body);
    assert.equal(expired.json().code, "PLATFORM_ACTION_EXPIRED");
  });
});
