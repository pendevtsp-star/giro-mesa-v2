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
const otherOrganizationId = randomUUID();
const unitId = randomUUID();
const otherUnitId = randomUUID();
const incidentId = randomUUID();
const otherIncidentId = randomUUID();
const identityA = randomUUID();
const identityB = randomUUID();
const reporterIdentityId = randomUUID();
const sessionA = randomUUID();
const sessionB = randomUUID();
const tokenA = `platform-http-a-${suffix}`;
const tokenB = `platform-http-b-${suffix}`;
const emailA = `platform-http-a-${suffix}@example.test`;
const emailB = `platform-http-b-${suffix}@example.test`;
const leadEmail = `marina-${suffix}@example.test`;
const supportEmail = `rafael-${suffix}@example.test`;

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
    values
      (${organizationId}, 'Platform HTTP Ltda', 'Platform HTTP', ${suffix.slice(0, 14)}, 'active'),
      (${otherOrganizationId}, 'Other Platform HTTP Ltda', 'Other Platform HTTP', ${suffix.slice(14, 28)}, 'active')
  `;
  await owner`
    insert into identities (id, email, display_name, email_verified_at)
    values
      (${identityA}, ${emailA}, 'Platform HTTP A', now()),
      (${identityB}, ${emailB}, 'Platform HTTP B', now()),
      (${reporterIdentityId}, ${`incident-reporter-${suffix}@example.test`}, 'Incident Reporter', now())
  `;
  await owner`
    insert into units (id, organization_id, name)
    values
      (${unitId}, ${organizationId}, 'Platform Unit'),
      (${otherUnitId}, ${otherOrganizationId}, 'Other Platform Unit')
  `;
  await owner`
    insert into management_incidents (
      id, organization_id, unit_id, incident_type, neutral_summary, amount_cents,
      idempotency_key, request_hash, reporter_identity_id, occurred_at
    ) values
      (
        ${incidentId}, ${organizationId}, ${unitId}, 'inventory_variance',
        'Diferença neutra confirmada na contagem.', 1290,
        ${`incident-${suffix}-a`}, ${"a".repeat(64)}, ${reporterIdentityId}, now()
      ),
      (
        ${otherIncidentId}, ${otherOrganizationId}, ${otherUnitId}, 'inventory_variance',
        'Incidente pertencente a outro tenant.', 890,
        ${`incident-${suffix}-b`}, ${"b".repeat(64)}, ${reporterIdentityId}, now()
      )
  `;
  await owner`
    insert into management_incident_events (
      organization_id, unit_id, incident_id, event, from_status, to_status,
      neutral_note, idempotency_key, request_hash, actor_identity_id
    ) values
      (
        ${organizationId}, ${unitId}, ${incidentId}, 'reported', null, 'reported',
        'Incidente inicial para teste HTTP.', ${`incident-${suffix}-a`}, ${"a".repeat(64)}, ${reporterIdentityId}
      ),
      (
        ${otherOrganizationId}, ${otherUnitId}, ${otherIncidentId}, 'reported', null, 'reported',
        'Incidente de outro tenant.', ${`incident-${suffix}-b`}, ${"b".repeat(64)}, ${reporterIdentityId}
      )
  `;
  await owner`
    insert into trial_applications (
      name, email, phone, business_name, segment, plan_slug, consented_at
    ) values (
      'Marina Lopes', ${leadEmail}, '+5511998765432', 'Bar Horizonte',
      'bar', 'operacao', now()
    )
  `;
  await owner`
    insert into contact_requests (name, email, phone, message, consented_at)
    values (
      'Rafael Lima', ${supportEmail}, '+5511987654321',
      'Mensagem livre com segredo-que-nao-pode-sair', now()
    )
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
    "platform.incident.transition",
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
  await owner`delete from trial_applications where email = ${leadEmail}`;
  await owner`delete from contact_requests where email = ${supportEmail}`;
  await owner`set session_replication_role = replica`;
  try {
    await owner`delete from management_incident_events where incident_id in (${incidentId}, ${otherIncidentId})`;
    await owner`delete from management_incidents where id in (${incidentId}, ${otherIncidentId})`;
  } finally {
    await owner`set session_replication_role = origin`;
  }
  await owner`delete from organizations where id in (${organizationId}, ${otherOrganizationId})`;
  await owner`delete from identities where id in (${identityA}, ${identityB}, ${reporterIdentityId})`;
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
      } = await app.inject({
        method: "GET",
        url: `${prefix}/platform/tenants/${organizationId}/context`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      assert.equal(tenant.statusCode, 200, tenant.body);
      assert.equal(tenant.json().organization.id, organizationId);
    }
  });

  it("serves global intake read-only with masked PII and no support free text", async (context) => {
    if (!app) return context.skip("PLATFORM_HTTP_DATABASE_URL not configured");
    for (const prefix of ["/v1", "/api/v1"]) {
      const leads: {
        statusCode: number;
        body: string;
        json(): {
          items: Array<{
            businessName?: string;
            displayName?: string;
            email?: string;
            actionAvailability?: string;
          }>;
        };
      } = await app.inject({
        method: "GET",
        url: `${prefix}/platform/resources/leads`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      assert.equal(leads.statusCode, 200, leads.body);
      const lead = leads
        .json()
        .items.find((item: { businessName?: string }) => item.businessName === "Bar Horizonte");
      assert.equal(lead?.displayName, "M***");
      assert.equal(lead?.email, "m***@example.test");
      assert.equal(lead?.actionAvailability, "unavailable");

      const support: {
        statusCode: number;
        body: string;
        json(): { items: Array<{ actionReasonCode?: string }> };
      } = await app.inject({
        method: "GET",
        url: `${prefix}/platform/resources/support`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      assert.equal(support.statusCode, 200, support.body);
      assert.equal(support.body.includes("segredo-que-nao-pode-sair"), false);
      assert.equal(support.body.includes('"message"'), false);
      assert.equal(support.json().items[0]?.actionReasonCode, "SUPPORT_WORKFLOW_NOT_AVAILABLE");

      const tenantQueue: {
        statusCode: number;
        body: string;
        json(): { availability?: string; reasonCode?: string };
      } = await app.inject({
        method: "GET",
        url: `${prefix}/platform/tenants/${organizationId}/resources/leads`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      assert.equal(tenantQueue.statusCode, 200, tenantQueue.body);
      assert.equal(tenantQueue.json().availability, "unavailable");
      assert.equal(tenantQueue.json().reasonCode, "PLATFORM_RESOURCE_GLOBAL_ONLY");
    }
  });

  it("projects only tenant incidents and serializes a dual-control transition", async (context) => {
    if (!app || !ownerConnection) return context.skip("PLATFORM_HTTP_DATABASE_URL not configured");
    const projection = await app.inject({
      method: "GET",
      url: `/api/v1/platform/tenants/${organizationId}/resources/incidents?unitId=${unitId}`,
      headers: { authorization: `Bearer ${tokenA}` },
    });
    assert.equal(projection.statusCode, 200, projection.body);
    assert.deepEqual(
      projection.json().items.map((item: { id: string }) => item.id),
      [incidentId],
    );
    assert.equal(projection.body.includes(otherIncidentId), false);
    assert.equal(projection.body.includes("requestHash"), false);
    assert.equal(projection.body.includes("evidence"), false);

    const proposals = await Promise.all(
      ["incident-review-proposal-a", "incident-review-proposal-b"].map((key) =>
        app?.inject({
          method: "POST",
          url: `/v1/platform/tenants/${organizationId}/actions`,
          headers: { authorization: `Bearer ${tokenA}`, "idempotency-key": key },
          payload: {
            action: "incident.review",
            targetId: incidentId,
            justification: "Revisão independente com fundamento operacional documentado.",
            payload: { expectedState: "reported", unitId },
          },
        }),
      ),
    );
    assert.ok(proposals.every((response) => response?.statusCode === 201));
    const approvals = await Promise.all(
      proposals.map((proposal, index) =>
        app?.inject({
          method: "POST",
          url: `/api/v1/platform/tenants/${organizationId}/actions/${proposal?.json().id}/approve`,
          headers: {
            authorization: `Bearer ${tokenB}`,
            "idempotency-key": `incident-review-approval-${index}`,
          },
          payload: { expectedVersion: 1 },
        }),
      ),
    );
    assert.deepEqual(
      approvals.map((response) => response?.statusCode).sort(),
      [200, 409],
      approvals.map((response) => response?.body).join("\n"),
    );
    const [incident] = await ownerConnection.client<{ status: string }[]>`
      select status from management_incidents where id = ${incidentId}
    `;
    assert.equal(incident?.status, "under_review");
    const [eventCount] = await ownerConnection.client<{ count: number }[]>`
      select count(*)::int as count from management_incident_events
      where incident_id = ${incidentId} and to_status = 'under_review'
    `;
    assert.equal(eventCount?.count, 1);
  });

  it("pages every incident beyond the legacy 500-row boundary without duplicates", async (context) => {
    if (!app || !ownerConnection) return context.skip("PLATFORM_HTTP_DATABASE_URL not configured");
    const generatedKeyPrefix = `platform-pagination-${suffix}`;
    const owner = ownerConnection.client;
    await owner.unsafe(
      `insert into management_incidents (
        id, organization_id, unit_id, incident_type, neutral_summary, amount_cents,
        idempotency_key, request_hash, reporter_identity_id, occurred_at
      )
      select
        gen_random_uuid(), $2::uuid, $3::uuid, 'inventory_variance',
        'Incidente paginado para teste.', series,
        $1 || '-' || series::text, md5($1 || '-hash-' || series::text), $4::uuid,
        timestamptz '2026-08-12 12:00:00+00' - make_interval(secs => series)
      from generate_series(1, 505) series`,
      [generatedKeyPrefix, organizationId, unitId, reporterIdentityId],
    );

    try {
      const ids = new Set<string>();
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ unitId, limit: "100" });
        if (cursor) query.set("cursor", cursor);
        const response: {
          statusCode: number;
          body: string;
          json(): { items: { id: string }[]; nextCursor: string | null };
        } = await app.inject({
          method: "GET",
          url: `/api/v1/platform/tenants/${organizationId}/resources/incidents?${query}`,
          headers: { authorization: `Bearer ${tokenA}` },
        });
        assert.equal(response.statusCode, 200, response.body);
        const page = response.json();
        for (const item of page.items) {
          assert.equal(ids.has(item.id), false, `duplicate incident ${item.id}`);
          ids.add(item.id);
        }
        cursor = page.nextCursor;
      } while (cursor);

      assert.equal(ids.size, 506);
      assert.equal(ids.has(incidentId), true);
    } finally {
      await owner`set session_replication_role = replica`;
      try {
        await owner`delete from management_incidents where idempotency_key like ${`${generatedKeyPrefix}-%`}`;
      } finally {
        await owner`set session_replication_role = origin`;
      }
    }
  });

  it("keeps incident table mutations and unsafe columns unavailable to platform", async (context) => {
    if (!ownerConnection) return context.skip("PLATFORM_HTTP_DATABASE_URL not configured");
    const [privileges] = await ownerConnection.client<
      {
        tableUpdate: boolean;
        statusUpdate: boolean;
        evidenceRead: boolean;
        safeRead: boolean;
      }[]
    >`
      select
        has_table_privilege('giromesa_platform', 'public.management_incidents', 'UPDATE') as "tableUpdate",
        has_column_privilege('giromesa_platform', 'public.management_incidents', 'status', 'UPDATE') as "statusUpdate",
        has_column_privilege('giromesa_platform', 'public.management_incidents', 'evidence', 'SELECT') as "evidenceRead",
        has_column_privilege('giromesa_platform', 'public.management_incidents', 'neutral_summary', 'SELECT') as "safeRead"
    `;
    assert.deepEqual(privileges, {
      tableUpdate: false,
      statusUpdate: false,
      evidenceRead: false,
      safeRead: true,
    });
  });

  it("maps only allowlisted domain failures to stable client errors", async (context) => {
    if (!app || !ownerConnection) return context.skip("PLATFORM_HTTP_DATABASE_URL not configured");
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

  it("rejects an invalid organization id as a stable client error on both aliases", async (context) => {
    if (!app) return context.skip("PLATFORM_HTTP_DATABASE_URL not configured");
    for (const prefix of ["/v1", "/api/v1"]) {
      const response: {
        statusCode: number;
        body: string;
        json(): { code?: string };
      } = await app.inject({
        method: "GET",
        url: `${prefix}/platform/tenants/not-a-uuid/context`,
        headers: { authorization: `Bearer ${tokenA}` },
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.equal(response.json().code, "INVALID_PLATFORM_ORGANIZATION_ID");
    }
  });

  it("durably records a failed outcome after the HTTP transaction rolls back the effect", async (context) => {
    if (!app || !ownerConnection) return context.skip("PLATFORM_HTTP_DATABASE_URL not configured");
    const proposal = await app.inject({
      method: "POST",
      url: `/v1/platform/tenants/${organizationId}/actions`,
      headers: {
        authorization: `Bearer ${tokenA}`,
        "idempotency-key": "http-failed-proposal-0001",
      },
      payload: {
        action: "tenant.suspend",
        targetId: organizationId,
        justification: "Precondicao concorrente usada para validar o outcome duravel.",
        payload: { expectedState: "active" },
      },
    });
    assert.equal(proposal.statusCode, 201, proposal.body);
    const proposalId = proposal.json().id as string;
    await ownerConnection.client`
      update organizations set billing_state = 'grace' where id = ${organizationId}
    `;
    try {
      const approval = await app.inject({
        method: "POST",
        url: `/api/v1/platform/tenants/${organizationId}/actions/${proposalId}/approve`,
        headers: {
          authorization: `Bearer ${tokenB}`,
          "idempotency-key": "http-failed-approval-0001",
        },
        payload: { expectedVersion: 1 },
      });
      assert.equal(approval.statusCode, 409, approval.body);
      assert.equal(approval.json().message, "PLATFORM_ACTION_PRECONDITION_FAILED");

      const events = await ownerConnection.client<{ action: string; status: string }[]>`
        select action, metadata->>'status' as status
        from audit_events
        where organization_id = ${organizationId}
          and entity_id = ${proposalId}
        order by (metadata->>'version')::int, id
      `;
      assert.deepEqual(
        events.map((event) => ({ ...event })),
        [
          { action: "platform.action.proposed", status: "pending" },
          { action: "platform.action.failed", status: "failed" },
        ],
      );
    } finally {
      await ownerConnection.client`
        update organizations set billing_state = 'active' where id = ${organizationId}
      `;
    }
  });
});
