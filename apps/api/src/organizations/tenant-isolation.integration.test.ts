import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  auditEvents,
  createDatabase,
  type DatabaseConnection,
  memberships,
  outboxEvents,
  posCatalogCategories,
} from "@giromesa/db";
import { Body, Controller, Module, Param, Post, Req, UseGuards } from "@nestjs/common";
import { APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";
import { AuthService } from "../auth/auth.service.js";
import { SessionGuard } from "../auth/session.guard.js";
import { DatabaseService } from "../database/database.module.js";
import { TenantContextInterceptor } from "../database/tenant-context.interceptor.js";

const integrationUrl = process.env.TENANT_ISOLATION_DATABASE_URL;
let probeConnection: DatabaseConnection | undefined;

@Controller("organizations/:organizationId/units/:unitId")
@UseGuards(SessionGuard)
class TenantProbeController {
  constructor(private readonly database: DatabaseService) {}

  @Post("probe")
  async probe(
    @Param("organizationId") _organizationId: string,
    @Param("unitId") _unitId: string,
    @Body() _body: Record<string, unknown>,
    @Req() _request: FastifyRequest,
  ) {
    const rows = await this.database.db
      .select({ id: posCatalogCategories.id })
      .from(posCatalogCategories);
    return rows.map((row) => row.id);
  }
}

@Module({
  controllers: [TenantProbeController],
  providers: [
    {
      provide: DatabaseService,
      useFactory: () => {
        if (!probeConnection) throw new Error("probe connection was not configured");
        return new DatabaseService(probeConnection);
      },
    },
    AuthService,
    SessionGuard,
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
class TenantProbeModule {}

function applicationUrl(ownerUrl: string, user: string, password: string) {
  const url = new URL(ownerUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

function postgresError(code: string, message: string) {
  return (error: unknown) => {
    const candidate = error as {
      code?: string;
      message?: string;
      cause?: { code?: string; message?: string };
    };
    const postgres = candidate.cause ?? candidate;
    return postgres.code === code && postgres.message?.includes(message) === true;
  };
}

describe("tenant context boundary", () => {
  it("fails closed across SQL, real Nest HTTP, role transition, and a reused connection", async (context) => {
    if (!integrationUrl) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }

    const suffix = randomUUID().replaceAll("-", "");
    const loginRole = `giromesa_test_app_${suffix}`;
    const arbitraryRole = `giromesa_test_arbitrary_${suffix}`;
    const legacyLoginRole = `giromesa_test_legacy_${suffix}`;
    const password = `tenant-test-${suffix}`;
    const ownerConnection = createDatabase(integrationUrl);
    const owner = ownerConnection.client;
    const organizationA = randomUUID();
    const organizationB = randomUUID();
    const unitA = randomUUID();
    const unitB = randomUUID();
    const identityA = randomUUID();
    const identityB = randomUUID();
    const membershipA = randomUUID();
    const membershipB = randomUUID();
    const categoryA = randomUUID();
    const categoryB = randomUUID();
    const outboxA = randomUUID();
    const outboxB = randomUUID();
    const publicMenuA = randomUUID();
    const tokenA = `session-a-${suffix}`;
    const tokenB = `session-b-${suffix}`;
    let app: NestFastifyApplication | undefined;

    for (const role of [loginRole, arbitraryRole, legacyLoginRole]) {
      await owner.unsafe(
        `create role "${role}" login password '${password}' noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
      );
    }
    await owner.unsafe(
      `grant giromesa_app, giromesa_worker, giromesa_identity, giromesa_public, giromesa_internal to "${loginRole}"`,
    );
    await owner.unsafe(`grant usage on schema public to "${arbitraryRole}", "${legacyLoginRole}"`);
    await owner.unsafe(
      `grant select, insert on pos_catalog_categories to "${arbitraryRole}", "${legacyLoginRole}"`,
    );

    await owner`
      insert into organizations (id, legal_name, trade_name, document)
      values
        (${organizationA}, 'Tenant A Ltda', 'Tenant A', ${suffix.slice(0, 14)}),
        (${organizationB}, 'Tenant B Ltda', 'Tenant B', ${suffix.slice(14, 28)})
    `;
    await owner`
      insert into units (id, organization_id, name)
      values (${unitA}, ${organizationA}, 'Unit A'), (${unitB}, ${organizationB}, 'Unit B')
    `;
    await owner`
      insert into identities (id, email, display_name, email_verified_at)
      values
        (${identityA}, ${`tenant-a-${suffix}@example.test`}, 'Tenant A', now()),
        (${identityB}, ${`tenant-b-${suffix}@example.test`}, 'Tenant B', now())
    `;
    await owner`
      insert into memberships (id, identity_id, organization_id, status)
      values
        (${membershipA}, ${identityA}, ${organizationA}, 'active'),
        (${membershipB}, ${identityB}, ${organizationB}, 'active')
    `;
    await owner`
      insert into role_bindings (membership_id, role)
      values (${membershipA}, 'owner'), (${membershipB}, 'owner')
    `;
    await owner`
      insert into auth_sessions (identity_id, token_hash, expires_at)
      values
        (${identityA}, ${createHash("sha256").update(tokenA).digest("hex")}, now() + interval '1 hour'),
        (${identityB}, ${createHash("sha256").update(tokenB).digest("hex")}, now() + interval '1 hour')
    `;

    const appUrl = applicationUrl(integrationUrl, loginRole, password);
    const database = new DatabaseService(createDatabase(appUrl, { max: 1 }));
    const arbitrary = createDatabase(applicationUrl(integrationUrl, arbitraryRole, password), {
      max: 1,
    });
    const legacy = createDatabase(applicationUrl(integrationUrl, legacyLoginRole, password), {
      max: 1,
    });
    try {
      const roleRows = await owner<
        { rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }[]
      >`
        select rolname, rolcanlogin, rolsuper, rolbypassrls
        from pg_roles
        where rolname in ('giromesa_app', 'giromesa_worker', 'giromesa_legacy_transition')
        order by rolname
      `;
      assert.equal(roleRows.length, 3);
      assert.ok(
        roleRows.every((role) => !role.rolcanlogin && !role.rolsuper && !role.rolbypassrls),
      );
      const publicBypass = await owner<{ count: number }[]>`
        select count(*)::int as count from pg_policies
        where schemaname = 'public'
          and ('public' = any(roles) or policyname = 'giromesa_legacy_unscoped')
      `;
      assert.equal(publicBypass[0]?.count, 0);
      const [privileges] = await owner<
        {
          app_audit_insert: boolean;
          app_audit_select: boolean;
          app_audit_update: boolean;
          app_billing_checkout_insert: boolean;
          app_billing_checkout_select: boolean;
          app_charge_delete: boolean;
          app_charge_insert: boolean;
          app_charge_select: boolean;
          app_charge_update: boolean;
          app_invitation_insert: boolean;
          app_invitation_id_select: boolean;
          app_invitation_select: boolean;
          app_invitation_update: boolean;
          app_legal_entity_insert: boolean;
          app_legal_entity_select: boolean;
          app_ledger_update: boolean;
          app_membership_insert: boolean;
          app_membership_select: boolean;
          app_membership_update: boolean;
          app_onboarding_insert: boolean;
          app_onboarding_select: boolean;
          app_onboarding_update: boolean;
          app_order_delete: boolean;
          app_order_update: boolean;
          app_organization_delete: boolean;
          app_organization_insert: boolean;
          app_organization_select: boolean;
          app_organization_update: boolean;
          app_outbox_insert: boolean;
          app_outbox_select: boolean;
          app_provider_customer_insert: boolean;
          app_provider_customer_select: boolean;
          app_public_menu_insert: boolean;
          app_public_menu_select: boolean;
          app_role_binding_insert: boolean;
          app_role_binding_select: boolean;
          app_role_binding_update: boolean;
          app_subscription_insert: boolean;
          app_subscription_select: boolean;
          app_trial_insert: boolean;
          app_trial_select: boolean;
          app_trial_update: boolean;
          app_unit_insert: boolean;
          app_unit_select: boolean;
          identity_invitation_insert: boolean;
          identity_invitation_update: boolean;
          identity_legal_entity_insert: boolean;
          identity_membership_insert: boolean;
          identity_membership_update: boolean;
          identity_onboarding_insert: boolean;
          identity_organization_insert: boolean;
          identity_outbox_insert: boolean;
          identity_outbox_select: boolean;
          identity_role_binding_insert: boolean;
          identity_unit_insert: boolean;
          worker_outbox_insert: boolean;
          worker_outbox_select: boolean;
          worker_outbox_update: boolean;
        }[]
      >`
        select
          has_table_privilege('giromesa_app', 'audit_events', 'insert') app_audit_insert,
          has_table_privilege('giromesa_app', 'audit_events', 'select') app_audit_select,
          has_table_privilege('giromesa_app', 'audit_events', 'update') app_audit_update,
          has_table_privilege('giromesa_app', 'billing_checkouts', 'insert') app_billing_checkout_insert,
          has_table_privilege('giromesa_app', 'billing_checkouts', 'select') app_billing_checkout_select,
          has_table_privilege('giromesa_app', 'charges', 'delete') app_charge_delete,
          has_table_privilege('giromesa_app', 'charges', 'insert') app_charge_insert,
          has_table_privilege('giromesa_app', 'charges', 'select') app_charge_select,
          has_table_privilege('giromesa_app', 'charges', 'update') app_charge_update,
          has_table_privilege('giromesa_app', 'membership_invitations', 'insert') app_invitation_insert,
          has_column_privilege('giromesa_app', 'membership_invitations', 'id', 'select') app_invitation_id_select,
          has_table_privilege('giromesa_app', 'membership_invitations', 'select') app_invitation_select,
          has_table_privilege('giromesa_app', 'membership_invitations', 'update') app_invitation_update,
          has_table_privilege('giromesa_app', 'legal_entities', 'insert') app_legal_entity_insert,
          has_table_privilege('giromesa_app', 'legal_entities', 'select') app_legal_entity_select,
          has_table_privilege('giromesa_app', 'growth_loyalty_ledger', 'update') app_ledger_update,
          has_table_privilege('giromesa_app', 'memberships', 'insert') app_membership_insert,
          has_table_privilege('giromesa_app', 'memberships', 'select') app_membership_select,
          has_table_privilege('giromesa_app', 'memberships', 'update') app_membership_update,
          has_table_privilege('giromesa_app', 'onboarding_records', 'insert') app_onboarding_insert,
          has_table_privilege('giromesa_app', 'onboarding_records', 'select') app_onboarding_select,
          has_table_privilege('giromesa_app', 'onboarding_records', 'update') app_onboarding_update,
          has_table_privilege('giromesa_app', 'pos_orders', 'delete') app_order_delete,
          has_table_privilege('giromesa_app', 'pos_orders', 'update') app_order_update,
          has_table_privilege('giromesa_app', 'organizations', 'delete') app_organization_delete,
          has_table_privilege('giromesa_app', 'organizations', 'insert') app_organization_insert,
          has_table_privilege('giromesa_app', 'organizations', 'select') app_organization_select,
          has_table_privilege('giromesa_app', 'organizations', 'update') app_organization_update,
          has_table_privilege('giromesa_app', 'outbox_events', 'insert') app_outbox_insert,
          has_table_privilege('giromesa_app', 'outbox_events', 'select') app_outbox_select,
          has_table_privilege('giromesa_app', 'provider_customers', 'insert') app_provider_customer_insert,
          has_table_privilege('giromesa_app', 'provider_customers', 'select') app_provider_customer_select,
          has_table_privilege('giromesa_app', 'public_menus', 'insert') app_public_menu_insert,
          has_table_privilege('giromesa_app', 'public_menus', 'select') app_public_menu_select,
          has_table_privilege('giromesa_app', 'role_bindings', 'insert') app_role_binding_insert,
          has_table_privilege('giromesa_app', 'role_bindings', 'select') app_role_binding_select,
          has_table_privilege('giromesa_app', 'role_bindings', 'update') app_role_binding_update,
          has_table_privilege('giromesa_app', 'subscriptions', 'insert') app_subscription_insert,
          has_table_privilege('giromesa_app', 'subscriptions', 'select') app_subscription_select,
          has_table_privilege('giromesa_app', 'trials', 'insert') app_trial_insert,
          has_table_privilege('giromesa_app', 'trials', 'select') app_trial_select,
          has_table_privilege('giromesa_app', 'trials', 'update') app_trial_update,
          has_table_privilege('giromesa_app', 'units', 'insert') app_unit_insert,
          has_table_privilege('giromesa_app', 'units', 'select') app_unit_select,
          has_table_privilege('giromesa_identity', 'membership_invitations', 'insert') identity_invitation_insert,
          has_table_privilege('giromesa_identity', 'membership_invitations', 'update') identity_invitation_update,
          has_table_privilege('giromesa_identity', 'legal_entities', 'insert') identity_legal_entity_insert,
          has_table_privilege('giromesa_identity', 'memberships', 'insert') identity_membership_insert,
          has_table_privilege('giromesa_identity', 'memberships', 'update') identity_membership_update,
          has_table_privilege('giromesa_identity', 'onboarding_records', 'insert') identity_onboarding_insert,
          has_table_privilege('giromesa_identity', 'organizations', 'insert') identity_organization_insert,
          has_table_privilege('giromesa_identity', 'outbox_events', 'insert') identity_outbox_insert,
          has_table_privilege('giromesa_identity', 'outbox_events', 'select') identity_outbox_select,
          has_table_privilege('giromesa_identity', 'role_bindings', 'insert') identity_role_binding_insert,
          has_table_privilege('giromesa_identity', 'units', 'insert') identity_unit_insert,
          has_table_privilege('giromesa_worker', 'outbox_events', 'insert') worker_outbox_insert,
          has_table_privilege('giromesa_worker', 'outbox_events', 'select') worker_outbox_select,
          has_table_privilege('giromesa_worker', 'outbox_events', 'update') worker_outbox_update
      `;
      assert.deepEqual(privileges, {
        app_audit_insert: true,
        app_audit_select: false,
        app_audit_update: false,
        app_billing_checkout_insert: false,
        app_billing_checkout_select: false,
        app_charge_delete: false,
        app_charge_insert: false,
        app_charge_select: false,
        app_charge_update: false,
        app_invitation_insert: true,
        app_invitation_id_select: true,
        app_invitation_select: false,
        app_invitation_update: false,
        app_legal_entity_insert: false,
        app_legal_entity_select: false,
        app_ledger_update: false,
        app_membership_insert: false,
        app_membership_select: true,
        app_membership_update: false,
        app_onboarding_insert: false,
        app_onboarding_select: true,
        app_onboarding_update: true,
        app_order_delete: false,
        app_order_update: true,
        app_organization_delete: false,
        app_organization_insert: false,
        app_organization_select: true,
        app_organization_update: true,
        app_outbox_insert: true,
        app_outbox_select: false,
        app_provider_customer_insert: false,
        app_provider_customer_select: false,
        app_public_menu_insert: false,
        app_public_menu_select: true,
        app_role_binding_insert: false,
        app_role_binding_select: true,
        app_role_binding_update: false,
        app_subscription_insert: false,
        app_subscription_select: false,
        app_trial_insert: true,
        app_trial_select: true,
        app_trial_update: false,
        app_unit_insert: false,
        app_unit_select: true,
        identity_invitation_insert: false,
        identity_invitation_update: true,
        identity_legal_entity_insert: true,
        identity_membership_insert: true,
        identity_membership_update: true,
        identity_onboarding_insert: true,
        identity_organization_insert: true,
        identity_outbox_insert: true,
        identity_outbox_select: false,
        identity_role_binding_insert: true,
        identity_unit_insert: true,
        worker_outbox_insert: false,
        worker_outbox_select: true,
        worker_outbox_update: true,
      });
      const futureTable = `tenant_future_${suffix}`;
      await owner.unsafe(`create table "${futureTable}" (id uuid primary key)`);
      const [futurePrivileges] = await owner<{ app_can_select: boolean }[]>`
        select has_table_privilege('giromesa_app', ${futureTable}, 'select') as app_can_select
      `;
      await owner.unsafe(`drop table "${futureTable}"`);
      assert.equal(futurePrivileges?.app_can_select, false);

      const arbitraryRows = await arbitrary.client.unsafe("select id from pos_catalog_categories");
      assert.equal(arbitraryRows.length, 0);
      await assert.rejects(
        () =>
          arbitrary.client.unsafe(
            `insert into pos_catalog_categories (organization_id, name, slug)
             values ('${organizationA}', 'Arbitrary', 'arbitrary')`,
          ),
        postgresError("42501", "row-level security policy"),
      );
      await assert.rejects(
        () => legacy.client.unsafe("set role giromesa_legacy_transition"),
        /permission denied/i,
      );

      await database.withTenantContext(
        { source: "job", organizationId: organizationA, unitId: unitA },
        async (db) => {
          await db.insert(posCatalogCategories).values({
            id: categoryA,
            organizationId: organizationA,
            name: "Category A",
            slug: `category-a-${suffix}`,
          });
          await db.insert(outboxEvents).values({
            id: outboxA,
            organizationId: organizationA,
            unitId: unitA,
            topic: "test.tenant_a",
            aggregateType: "test",
            aggregateId: categoryA,
            payload: { secret: "tenant-a-payload" },
          });
        },
      );

      await owner`
        insert into public_menus (id, organization_id, unit_id, slug, active, published_at)
        values (${publicMenuA}, ${organizationA}, ${unitA}, ${`public-${suffix}`}, true, now())
      `;
      const publicRows = await database.withPublicMenuContext(`public-${suffix}`, (db) =>
        db.select({ id: posCatalogCategories.id }).from(posCatalogCategories),
      );
      assert.deepEqual(
        publicRows.map((row) => row.id),
        [categoryA],
      );
      const identityRows = await database.withRoleContext("identity", identityA, (db) =>
        db.select({ organizationId: memberships.organizationId }).from(memberships),
      );
      assert.deepEqual(
        identityRows.map((row) => row.organizationId),
        [organizationA],
      );
      await database.withTenantContext(
        { source: "job", organizationId: organizationB, unitId: unitB },
        async (db) => {
          assert.deepEqual(await db.select().from(posCatalogCategories), []);
          await db.insert(posCatalogCategories).values({
            id: categoryB,
            organizationId: organizationB,
            name: "Category B",
            slug: `category-b-${suffix}`,
          });
          await db.insert(outboxEvents).values({
            id: outboxB,
            organizationId: organizationB,
            unitId: unitB,
            topic: "test.tenant_b",
            aggregateType: "test",
            aggregateId: categoryB,
            payload: { secret: "tenant-b-payload" },
          });
        },
      );

      await assert.rejects(
        () =>
          database.withTenantContext(
            {
              source: "http",
              organizationId: organizationA,
              unitId: unitB,
              actorIdentityId: identityA,
            },
            (db) =>
              db.insert(auditEvents).values({
                organizationId: organizationA,
                unitId: unitB,
                action: "cross-unit",
                entityType: "test",
              }),
          ),
        postgresError("42501", "row-level security policy"),
      );
      await assert.rejects(
        () =>
          database.withTenantContext(
            {
              source: "http",
              organizationId: organizationA,
              unitId: unitA,
              actorIdentityId: identityA,
            },
            (db) => db.select().from(outboxEvents),
          ),
        postgresError("42501", "permission denied for table outbox_events"),
      );

      await owner.unsafe(`grant giromesa_legacy_transition to "${legacyLoginRole}"`);
      const legacyRows = await legacy.client.begin(async (tx) => {
        await tx.unsafe("set local role giromesa_legacy_transition");
        return tx.unsafe("select id from pos_catalog_categories order by id");
      });
      assert.deepEqual([...legacyRows.map((row) => row.id)].sort(), [categoryA, categoryB].sort());

      probeConnection = createDatabase(appUrl, { max: 1 });
      app = await NestFactory.create<NestFastifyApplication>(
        TenantProbeModule,
        new FastifyAdapter({ logger: false }),
        { logger: false },
      );
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      const httpB = await app.inject({
        method: "POST",
        url: `/organizations/${organizationB}/units/${unitB}/probe`,
        headers: { authorization: `Bearer ${tokenB}` },
        payload: { organizationId: organizationA, unitId: unitA },
      });
      assert.equal(httpB.statusCode, 201);
      assert.deepEqual(httpB.json(), [categoryB]);
      const unauthorized = await app.inject({
        method: "POST",
        url: `/organizations/${organizationB}/units/${unitB}/probe`,
        headers: { authorization: `Bearer ${tokenA}` },
        payload: {},
      });
      assert.equal(unauthorized.statusCode, 201);
      assert.deepEqual(unauthorized.json(), []);

      const rowsAfterReuse = await database.withTenantContext(
        {
          source: "http",
          organizationId: organizationA,
          unitId: unitA,
          actorIdentityId: identityA,
        },
        (db) => db.select({ id: posCatalogCategories.id }).from(posCatalogCategories),
      );
      assert.deepEqual(
        rowsAfterReuse.map((row) => row.id),
        [categoryA],
      );
      const rowsAfterCleanup = await database.client.begin(async (tx) => {
        await tx.unsafe("set local role giromesa_app");
        return tx.unsafe("select id from pos_catalog_categories");
      });
      assert.equal(rowsAfterCleanup.length, 0);
    } finally {
      if (app) await app.close();
      probeConnection = undefined;
      await database.onModuleDestroy();
      await arbitrary.client.end();
      await legacy.client.end();
      await owner`delete from organizations where id in (${organizationA}, ${organizationB})`;
      await owner`delete from identities where id in (${identityA}, ${identityB})`;
      for (const role of [loginRole, arbitraryRole, legacyLoginRole]) {
        await owner.unsafe(`drop owned by "${role}"`);
        await owner.unsafe(`drop role "${role}"`);
      }
      await owner.end();
    }
  });
});
