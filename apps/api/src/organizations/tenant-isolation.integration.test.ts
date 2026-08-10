import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  auditEvents,
  createDatabase,
  type DatabaseConnection,
  memberships,
  outboxEvents,
  posCatalogCategories,
} from "@giromesa/db";
import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  Injectable,
  Module,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { APP_INTERCEPTOR, NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";
import { DatabaseService } from "../database/database.module.js";
import { TenantContextInterceptor } from "../database/tenant-context.interceptor.js";

const integrationUrl = process.env.TENANT_ISOLATION_DATABASE_URL;
let probeConnection: DatabaseConnection | undefined;

@Injectable()
class ProbeAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { auth?: { identityId: string } }>();
    const identityId = request.headers["x-test-identity"];
    if (typeof identityId !== "string") return false;
    request.auth = { identityId };
    return true;
  }
}

@Controller("organizations/:organizationId/units/:unitId")
@UseGuards(ProbeAuthGuard)
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
    ProbeAuthGuard,
    {
      provide: DatabaseService,
      useFactory: () => {
        if (!probeConnection) throw new Error("probe connection was not configured");
        return new DatabaseService(probeConnection);
      },
    },
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
      insert into identities (id, email, display_name)
      values
        (${identityA}, ${`tenant-a-${suffix}@example.test`}, 'Tenant A'),
        (${identityB}, ${`tenant-b-${suffix}@example.test`}, 'Tenant B')
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
        headers: { "x-test-identity": identityB },
        payload: { organizationId: organizationA, unitId: unitA },
      });
      assert.equal(httpB.statusCode, 201);
      assert.deepEqual(httpB.json(), [categoryB]);
      const unauthorized = await app.inject({
        method: "POST",
        url: `/organizations/${organizationB}/units/${unitB}/probe`,
        headers: { "x-test-identity": identityA },
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
