import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { createDatabase, posCatalogCategories } from "@giromesa/db";
import { from, lastValueFrom } from "rxjs";
import { DatabaseService } from "../database/database.module.js";
import { TenantContextInterceptor } from "../database/tenant-context.interceptor.js";

const integrationUrl = process.env.TENANT_ISOLATION_DATABASE_URL;

function isRlsViolation(error: unknown) {
  const candidate = error as { cause?: { code?: string; message?: string } };
  return (
    candidate.cause?.code === "42501" &&
    candidate.cause.message?.includes("row-level security policy") === true
  );
}

function applicationUrl(ownerUrl: string, user: string, password: string) {
  const url = new URL(ownerUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

describe("tenant context boundary", () => {
  it("fails closed, alternates tenants on one pooled connection, and rejects cross-tenant writes", async (context) => {
    if (!integrationUrl) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }

    const suffix = randomUUID().replaceAll("-", "");
    const loginRole = `giromesa_test_app_${suffix}`;
    const legacyRole = `giromesa_test_legacy_${suffix}`;
    const password = `tenant-test-${suffix}`;
    const owner = createDatabase(integrationUrl).client;
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

    const [applicationRole] = await owner<
      { rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean }[]
    >`
      select rolcanlogin, rolsuper, rolbypassrls
      from pg_roles
      where rolname = 'giromesa_app'
    `;
    assert.deepEqual(applicationRole, {
      rolcanlogin: false,
      rolsuper: false,
      rolbypassrls: false,
    });
    const unprotectedTenantTables = await owner<{ relname: string }[]>`
      select tables.relname
      from pg_class as tables
      join pg_namespace as namespaces on namespaces.oid = tables.relnamespace
      where namespaces.nspname = 'public'
        and tables.relkind = 'r'
        and (
          exists (
            select 1 from pg_attribute as columns
            where columns.attrelid = tables.oid
              and columns.attname = 'organization_id'
              and not columns.attisdropped
          )
          or tables.relname in ('organizations', 'role_bindings', 'charges')
        )
        and (not tables.relrowsecurity or not tables.relforcerowsecurity)
    `;
    assert.equal(unprotectedTenantTables.length, 0);

    await owner.unsafe(
      `create role "${loginRole}" login password '${password}' noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
    );
    await owner.unsafe(
      `create role "${legacyRole}" login password '${password}' noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
    );
    await owner.unsafe(`grant giromesa_app to "${loginRole}"`);
    await owner.unsafe(`grant usage on schema public to "${legacyRole}"`);
    await owner.unsafe(`grant select on pos_catalog_categories to "${legacyRole}"`);
    await owner`
      insert into organizations (id, legal_name, trade_name, document)
      values
        (${organizationA}, 'Tenant A Ltda', 'Tenant A', ${suffix.slice(0, 14)}),
        (${organizationB}, 'Tenant B Ltda', 'Tenant B', ${suffix.slice(14, 28)})
    `;
    await owner`
      insert into units (id, organization_id, name)
      values
        (${unitA}, ${organizationA}, 'Unit A'),
        (${unitB}, ${organizationB}, 'Unit B')
    `;
    await owner`
      insert into identities (id, email, display_name)
      values
        (${identityA}, ${`tenant-a-${suffix}@example.test`}, 'Tenant A Worker'),
        (${identityB}, ${`tenant-b-${suffix}@example.test`}, 'Tenant B Worker')
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
    const legacyApplication = createDatabase(
      applicationUrl(integrationUrl, legacyRole, password),
    ).client;
    const rawApplication = createDatabase(appUrl).client;
    const database = new DatabaseService(createDatabase(appUrl, { max: 1 }));
    try {
      context.diagnostic("tenant isolation: missing context checks");
      await rawApplication.begin(async (transaction) => {
        await transaction.unsafe("set local role giromesa_app");
        const missingContextRows = await transaction.unsafe(
          "select id from pos_catalog_categories",
        );
        assert.equal(missingContextRows.length, 0, "missing context must not see tenant rows");
      });

      await assert.rejects(
        () =>
          rawApplication.begin(async (transaction) => {
            await transaction.unsafe("set local role giromesa_app");
            await transaction.unsafe(
              `insert into pos_catalog_categories (id, organization_id, name, slug)
             values ('${randomUUID()}', '${organizationA}', 'No context', 'no-context')`,
            );
          }),
        /row-level security policy/i,
      );

      await database.withTenantContext(
        {
          source: "job",
          organizationId: organizationA,
          unitId: unitA,
          actorIdentityId: identityA,
        },
        async (db) => {
          await db.insert(posCatalogCategories).values({
            id: categoryA,
            organizationId: organizationA,
            name: "Category A",
            slug: `category-a-${suffix}`,
          });
        },
      );

      context.diagnostic("tenant isolation: cross-tenant write");
      await assert.rejects(
        () =>
          database.withTenantContext(
            {
              source: "job",
              organizationId: organizationA,
              unitId: unitA,
              actorIdentityId: identityA,
            },
            (db) =>
              db.insert(posCatalogCategories).values({
                organizationId: organizationB,
                name: "Cross tenant write",
                slug: `cross-tenant-${suffix}`,
              }),
          ),
        isRlsViolation,
      );

      await database.withTenantContext(
        {
          source: "job",
          organizationId: organizationB,
          unitId: unitB,
          actorIdentityId: identityB,
        },
        async (db) => {
          const rows = await db.select().from(posCatalogCategories);
          assert.deepEqual(rows, []);
          await db.insert(posCatalogCategories).values({
            id: categoryB,
            organizationId: organizationB,
            name: "Category B",
            slug: `category-b-${suffix}`,
          });
        },
      );

      const legacyRows = await legacyApplication.unsafe(
        "select id from pos_catalog_categories order by id",
      );
      assert.deepEqual(
        [...legacyRows.map((row) => row.id)].sort(),
        [categoryA, categoryB].sort(),
        "a pre-existing role outside giromesa_app stays usable during the N/N-1 rollout",
      );

      context.diagnostic("tenant isolation: alternate tenant on reused connection");
      const rowsAfterPoolReuse = await database.withTenantContext(
        {
          source: "job",
          organizationId: organizationA,
          unitId: unitA,
          actorIdentityId: identityA,
        },
        (db) => db.select().from(posCatalogCategories),
      );
      assert.deepEqual(
        rowsAfterPoolReuse.map((row) => row.id),
        [categoryA],
      );

      const interceptor = new TenantContextInterceptor(database);
      context.diagnostic("tenant isolation: HTTP context");
      const executionContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            auth: { identityId: identityB },
            params: { organizationId: organizationB, unitId: unitB },
            body: { organizationId: organizationA, unitId: unitA },
          }),
        }),
      };
      const httpRows = (await lastValueFrom(
        interceptor.intercept(
          executionContext as never,
          {
            handle: () => from(database.db.select().from(posCatalogCategories)),
          } as never,
        ),
      )) as { id: string }[];
      assert.deepEqual(
        httpRows.map((row) => row.id),
        [categoryB],
        "HTTP context must come from trusted route params, never the public body",
      );

      const unauthorizedHttpRows = (await lastValueFrom(
        interceptor.intercept(
          {
            switchToHttp: () => ({
              getRequest: () => ({
                auth: { identityId: identityA },
                params: { organizationId: organizationB, unitId: unitB },
              }),
            }),
          } as never,
          { handle: () => from(database.db.select().from(posCatalogCategories)) } as never,
        ),
      )) as { id: string }[];
      assert.deepEqual(
        unauthorizedHttpRows,
        [],
        "a route tenant is not trusted without an active membership for the actor",
      );

      context.diagnostic("tenant isolation: context cleanup");
      const rowsAfterContextCleanup = await database.client.begin(async (transaction) => {
        await transaction.unsafe("set local role giromesa_app");
        return transaction.unsafe("select id from pos_catalog_categories");
      });
      assert.equal(
        rowsAfterContextCleanup.length,
        0,
        "transaction-local context must be cleared before the one connection returns to the pool",
      );
      context.diagnostic("tenant isolation: completed");
    } finally {
      await database.onModuleDestroy();
      await rawApplication.end();
      await legacyApplication.end();
      await owner`delete from organizations where id in (${organizationA}, ${organizationB})`;
      await owner`delete from identities where id in (${identityA}, ${identityB})`;
      await owner.unsafe(`drop role "${loginRole}"`);
      await owner.unsafe(`drop owned by "${legacyRole}"`);
      await owner.unsafe(`drop role "${legacyRole}"`);
      await owner.end();
    }
  });
});
