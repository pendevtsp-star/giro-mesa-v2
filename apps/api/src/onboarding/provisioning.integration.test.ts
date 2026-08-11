import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readdir, readFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  auditEvents,
  commercialCatalogVersions,
  commercialPlans,
  createDatabase,
  type DatabaseConnection,
  identities,
  memberships,
  onboardingChecklistItems,
  onboardingRecords,
  organizations,
  posCatalogCategories,
  posDiningRooms,
  posDiningTables,
  posProductPrices,
  posProducts,
  provisioningRuns,
  publicMenus,
  roleBindings,
  subscriptionEntitlements,
  subscriptions,
  trials,
  units,
} from "@giromesa/db";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.module.js";
import { ScopeService } from "../organizations/scope.service.js";
import { OnboardingService } from "./onboarding.service.js";

const integrationUrl =
  process.env.PROVISIONING_DATABASE_URL ?? process.env.TENANT_ISOLATION_DATABASE_URL;
const migrationsDirectory = fileURLToPath(
  new URL("../../../../packages/db/drizzle/", import.meta.url),
);

async function applyMigration(client: DatabaseConnection["client"], file: string) {
  const source = await readFile(`${migrationsDirectory}${file}`, "utf8");
  const statements = source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await client.begin(async (transaction) => {
    for (const statement of statements) await transaction.unsafe(statement);
  });
}

function applicationUrl(ownerUrl: string, user: string, password: string) {
  const url = new URL(ownerUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

function errorContains(code: string) {
  return (error: unknown) => JSON.stringify(error).includes(code);
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMilliseconds: number,
  label: string,
) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function withTimeout<T>(promise: Promise<T>, timeoutMilliseconds: number, label: string) {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), timeoutMilliseconds);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("durable onboarding provisioning", () => {
  const suffix = randomUUID().replaceAll("-", "");
  const upgradeDatabaseName = `giromesa_provisioning_${suffix}`;
  const freshDatabaseName = `giromesa_provisioning_fresh_${suffix}`;
  const loginRole = `giromesa_provisioning_app_${suffix}`;
  const password = `provisioning-test-${suffix}`;
  const admin = integrationUrl ? createDatabase(integrationUrl, { max: 2 }) : undefined;
  let owner: DatabaseConnection | undefined;
  let appConnection: DatabaseConnection | undefined;
  let database: DatabaseService | undefined;
  let service: OnboardingService | undefined;
  let databaseUrl: URL | undefined;
  let planId: string;
  let catalogVersionId: string;
  let documentCounter = 10;

  async function invoke<T>(identityId: string, organizationId: string, work: () => Promise<T>) {
    if (!database) throw new Error("database is not configured");
    return database.withTenantContext(
      { source: "http", organizationId, actorIdentityId: identityId },
      work,
    );
  }

  async function ownerLockMetadata(client: DatabaseConnection["client"]) {
    const [metadata] = await client<
      {
        owner: string;
        security_definer: boolean;
        configuration: string[] | null;
        public_execute: boolean;
        public_runtime_execute: boolean;
        app_execute: boolean;
        identity_execute: boolean;
        worker_execute: boolean;
        internal_execute: boolean;
        legacy_execute: boolean;
        migrator_execute: boolean;
        app_grant_option: boolean;
        non_owner_execute_grantees: string[];
        migrator_login: boolean;
        migrator_bypass_rls: boolean;
        runtime_bypass_rls: boolean;
        runtime_migrator_membership: boolean;
        migrator_destructive_table_privilege: boolean;
      }[]
    >`
      select
        owner_role.rolname owner,
        procedure.prosecdef security_definer,
        procedure.proconfig configuration,
        has_function_privilege('public', procedure.oid, 'execute') public_execute,
        has_function_privilege('giromesa_public', procedure.oid, 'execute') public_runtime_execute,
        has_function_privilege('giromesa_app', procedure.oid, 'execute') app_execute,
        has_function_privilege('giromesa_identity', procedure.oid, 'execute') identity_execute,
        has_function_privilege('giromesa_worker', procedure.oid, 'execute') worker_execute,
        has_function_privilege('giromesa_internal', procedure.oid, 'execute') internal_execute,
        has_function_privilege('giromesa_legacy_transition', procedure.oid, 'execute') legacy_execute,
        has_function_privilege('giromesa_migrator', procedure.oid, 'execute') migrator_execute,
        coalesce(
          (
            select bool_or(acl.is_grantable)
            from aclexplode(procedure.proacl) acl
            inner join pg_roles grantee on grantee.oid = acl.grantee
            where grantee.rolname = 'giromesa_app' and acl.privilege_type = 'EXECUTE'
          ),
          false
        ) app_grant_option,
        coalesce(
          (
            select array_agg(
              coalesce(grantee.rolname::text, 'PUBLIC')
              order by coalesce(grantee.rolname::text, 'PUBLIC')
            )
            from aclexplode(procedure.proacl) acl
            left join pg_roles grantee on grantee.oid = acl.grantee
            where acl.privilege_type = 'EXECUTE' and acl.grantee <> procedure.proowner
          ),
          array[]::text[]
        ) non_owner_execute_grantees,
        owner_role.rolcanlogin migrator_login,
        owner_role.rolbypassrls migrator_bypass_rls,
        exists (
          select 1
          from pg_roles runtime_role
          where runtime_role.rolname in (
            'giromesa_app', 'giromesa_identity', 'giromesa_worker', 'giromesa_internal',
            'giromesa_public', 'giromesa_legacy_transition'
          ) and runtime_role.rolbypassrls
        ) runtime_bypass_rls,
        exists (
          select 1
          from pg_auth_members membership
          inner join pg_roles runtime_role on runtime_role.oid = membership.member
          where membership.roleid = owner_role.oid
            and runtime_role.rolname in (
              'giromesa_app', 'giromesa_identity', 'giromesa_worker', 'giromesa_internal',
              'giromesa_public', 'giromesa_legacy_transition'
            )
        ) runtime_migrator_membership,
        has_table_privilege('giromesa_migrator', 'memberships', 'insert')
          or has_table_privilege('giromesa_migrator', 'memberships', 'delete')
          or has_table_privilege('giromesa_migrator', 'memberships', 'truncate')
          or has_table_privilege('giromesa_migrator', 'role_bindings', 'insert')
          or has_table_privilege('giromesa_migrator', 'role_bindings', 'delete')
          or has_table_privilege('giromesa_migrator', 'role_bindings', 'truncate')
          migrator_destructive_table_privilege
      from pg_proc procedure
      inner join pg_namespace namespace on namespace.oid = procedure.pronamespace
      inner join pg_roles owner_role on owner_role.oid = procedure.proowner
      where namespace.nspname = 'public'
        and procedure.proname = 'giromesa_lock_onboarding_owner'
        and pg_get_function_identity_arguments(procedure.oid) = 'p_organization_id uuid, p_identity_id uuid'
    `;
    assert.deepEqual(metadata, {
      owner: "giromesa_migrator",
      security_definer: true,
      configuration: ["search_path=pg_catalog, public"],
      public_execute: false,
      public_runtime_execute: false,
      app_execute: true,
      identity_execute: false,
      worker_execute: false,
      internal_execute: false,
      legacy_execute: false,
      migrator_execute: true,
      app_grant_option: false,
      non_owner_execute_grantees: ["giromesa_app"],
      migrator_login: false,
      migrator_bypass_rls: true,
      runtime_bypass_rls: false,
      runtime_migrator_membership: false,
      migrator_destructive_table_privilege: false,
    });
  }

  async function callOwnerLockWithRawContext(
    organizationSetting: string,
    actorSetting: string,
    organizationId: string,
    identityId: string,
  ) {
    if (!appConnection) throw new Error("application database is not configured");
    return appConnection.client.begin(async (transaction) => {
      await transaction.unsafe("set local role giromesa_app");
      await transaction.unsafe(
        `select
          set_config('app.current_organization_id', $1, true),
          set_config('app.current_actor_identity_id', $2, true)`,
        [organizationSetting, actorSetting],
      );
      const [result] = await transaction.unsafe<{ authorized: boolean }[]>(
        `
        select public.giromesa_lock_onboarding_owner(
          $1::uuid,
          $2::uuid
        ) authorized
        `,
        [organizationId, identityId],
      );
      return result?.authorized ?? false;
    });
  }

  async function fixture(label: string, ready = true) {
    if (!owner || !service) throw new Error("fixture database is not configured");
    documentCounter += 1;
    const organizationId = randomUUID();
    const unitId = randomUUID();
    const ownerIdentityId = randomUUID();
    const cashierIdentityId = randomUUID();
    const ownerMembershipId = randomUUID();
    const cashierMembershipId = randomUUID();
    await owner.db.insert(organizations).values({
      id: organizationId,
      legalName: `${label} Ltda`,
      tradeName: label,
      document: String(documentCounter).padStart(14, "0"),
      billingState: "onboarding",
    });
    await owner.db.insert(units).values({ id: unitId, organizationId, name: `${label} Matriz` });
    await owner.db.insert(identities).values([
      {
        id: ownerIdentityId,
        email: `${label.toLowerCase().replaceAll(" ", "-")}-owner-${suffix}@example.test`,
        displayName: `${label} Owner`,
        emailVerifiedAt: new Date(),
      },
      {
        id: cashierIdentityId,
        email: `${label.toLowerCase().replaceAll(" ", "-")}-cashier-${suffix}@example.test`,
        displayName: `${label} Cashier`,
        emailVerifiedAt: new Date(),
      },
    ]);
    await owner.db.insert(memberships).values([
      {
        id: ownerMembershipId,
        identityId: ownerIdentityId,
        organizationId,
        status: "active",
      },
      {
        id: cashierMembershipId,
        identityId: cashierIdentityId,
        organizationId,
        status: "active",
      },
    ]);
    await owner.db.insert(roleBindings).values([
      { membershipId: ownerMembershipId, unitId: null, role: "owner" },
      { membershipId: cashierMembershipId, unitId, role: "cashier" },
    ]);
    await owner.db.insert(onboardingRecords).values({ organizationId });
    if (ready) {
      const categoryId = randomUUID();
      const productId = randomUUID();
      const roomId = randomUUID();
      await owner.db.insert(posCatalogCategories).values({
        id: categoryId,
        organizationId,
        name: "Principal",
        slug: `principal-${label.toLowerCase().replaceAll(" ", "-")}`,
      });
      await owner.db.insert(posProducts).values({
        id: productId,
        organizationId,
        categoryId,
        name: "Produto verificado",
      });
      await owner.db.insert(posProductPrices).values({
        organizationId,
        unitId,
        productId,
        priceCents: 1_000,
      });
      await owner.db.insert(posDiningRooms).values({
        id: roomId,
        organizationId,
        unitId,
        name: "Salão",
      });
      await owner.db.insert(posDiningTables).values({
        organizationId,
        unitId,
        roomId,
        label: "Mesa 1",
      });
      await owner.db.insert(publicMenus).values({
        organizationId,
        unitId,
        slug: `menu-${label.toLowerCase().replaceAll(" ", "-")}-${suffix.slice(0, 6)}`,
        active: true,
        publishedAt: new Date(),
      });
    }
    await invoke(
      ownerIdentityId,
      organizationId,
      () =>
        service?.select(ownerIdentityId, organizationId, {
          planSlug: "operacao",
          selectedUnitId: unitId,
          reselect: false,
        }) ?? Promise.reject(new Error("service unavailable")),
    );
    if (ready) {
      await invoke(
        ownerIdentityId,
        organizationId,
        () =>
          service?.update(ownerIdentityId, organizationId, {
            items: {
              qr: {
                status: "not_applicable",
                waiverReason: "QR dispensado pelo proprietário até a configuração operacional.",
                evidenceReference: `qr-waiver:${label}`,
                evidence: { reason: "pilot_without_qr" },
              },
              fiscalChoice: {
                status: "verified",
                evidenceReference: `fiscal-choice:${label}`,
                evidence: { choice: "disabled" },
              },
              production: {
                status: "verified",
                evidenceReference: `production-route:${label}`,
                evidence: { mode: "off" },
              },
              training: {
                status: "verified",
                evidenceReference: `training:${label}`,
                evidence: { completed: true },
              },
              rehearsal: {
                status: "verified",
                evidenceReference: `rehearsal:${label}`,
                evidence: { completed: true },
              },
            },
          }) ?? Promise.reject(new Error("service unavailable")),
      );
    }
    return {
      organizationId,
      unitId,
      ownerIdentityId,
      cashierIdentityId,
      ownerMembershipId,
      cashierMembershipId,
    };
  }

  async function installFailureTrigger(
    table: "trials" | "subscriptions",
    organizationId: string,
    name: string,
  ) {
    if (!owner) throw new Error("owner unavailable");
    await owner.client.unsafe(`
      create function ${name}() returns trigger language plpgsql as $$
      begin
        if new.organization_id = '${organizationId}'::uuid then
          raise exception 'task7 injected transient failure' using errcode = '40001';
        end if;
        return new;
      end
      $$
    `);
    await owner.client.unsafe(`
      create trigger ${name} before insert on ${table}
      for each row execute function ${name}()
    `);
  }

  async function removeFailureTrigger(table: string, name: string) {
    if (!owner) return;
    await owner.client.unsafe(`drop trigger if exists ${name} on ${table}`);
    await owner.client.unsafe(`drop function if exists ${name}()`);
  }

  async function installSleepTrigger(
    table: "provisioning_runs" | "subscriptions",
    organizationId: string,
    name: string,
    seconds: number,
  ) {
    if (!owner) throw new Error("owner unavailable");
    await owner.client.unsafe(`
      create function ${name}() returns trigger language plpgsql as $$
      begin
        if new.organization_id = '${organizationId}'::uuid then
          perform pg_sleep(${seconds});
        end if;
        return new;
      end
      $$
    `);
    await owner.client.unsafe(`
      create trigger ${name} before insert on ${table}
      for each row execute function ${name}()
    `);
  }

  async function installAdvisoryGateTrigger(
    table: "trials" | "subscriptions" | "onboarding_records" | "onboarding_checklist_items",
    organizationId: string,
    name: string,
    salt: number,
    operation: "insert" | "update",
    extraGuard = "true",
  ) {
    if (!owner) throw new Error("owner unavailable");
    await owner.client.unsafe(`
      create function ${name}() returns trigger language plpgsql as $$
      begin
        if new.organization_id = '${organizationId}'::uuid and (${extraGuard}) then
          perform pg_advisory_xact_lock(hashtextextended(new.organization_id::text, ${salt}));
        end if;
        return new;
      end
      $$
    `);
    await owner.client.unsafe(`
      create trigger ${name} before ${operation} on ${table}
      for each row execute function ${name}()
    `);
  }

  async function holdAdvisoryGate(organizationId: string, salt: number) {
    if (!owner) throw new Error("owner unavailable");
    const acquired = deferred<void>();
    const release = deferred<void>();
    const completed = owner.client.begin(async (transaction) => {
      await transaction.unsafe(
        `select pg_advisory_xact_lock(hashtextextended('${organizationId}', ${salt}))`,
      );
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;
    return {
      async release() {
        release.resolve();
        await completed;
      },
    };
  }

  async function assertAdvisoryWaits(minimum: number, timeoutMilliseconds = 4_000) {
    if (!owner) throw new Error("owner unavailable");
    const ownerConnection = owner;
    await waitUntil(
      async () => {
        const [activity] = await ownerConnection.client<{ waits: number }[]>`
          select count(*)::int waits
          from pg_stat_activity
          where datname = current_database()
            and pid <> pg_backend_pid()
            and lower(coalesce(wait_event, '')) = 'advisory'
        `;
        return (activity?.waits ?? 0) >= minimum;
      },
      timeoutMilliseconds,
      `${minimum} advisory waiter(s)`,
    );
  }

  async function assertRowLockWaits(minimum: number, timeoutMilliseconds = 4_000) {
    if (!owner) throw new Error("owner unavailable");
    const ownerConnection = owner;
    await waitUntil(
      async () => {
        const [activity] = await ownerConnection.client<{ waits: number }[]>`
          select count(*)::int waits
          from pg_stat_activity
          where datname = current_database()
            and pid <> pg_backend_pid()
            and wait_event_type = 'Lock'
            and lower(coalesce(wait_event, '')) <> 'advisory'
        `;
        return (activity?.waits ?? 0) >= minimum;
      },
      timeoutMilliseconds,
      `${minimum} row-lock waiter(s)`,
    );
  }

  async function holdOwnerDemotion(membershipId: string) {
    if (!owner) throw new Error("owner unavailable");
    const changed = deferred<void>();
    const release = deferred<void>();
    const completed = owner.client.begin(async (transaction) => {
      await transaction.unsafe(`
        update role_bindings
        set role = 'manager'
        where membership_id = '${membershipId}'::uuid and role = 'owner'
      `);
      changed.resolve();
      await release.promise;
    });
    await changed.promise;
    return {
      async release() {
        release.resolve();
        await completed;
      },
    };
  }

  async function assertForcedOverlap(timeoutMilliseconds = 4_000) {
    if (!owner) throw new Error("owner unavailable");
    const ownerConnection = owner;
    await waitUntil(
      async () => {
        const [activity] = await ownerConnection.client<
          { active: number; advisory_waits: number }[]
        >`
          select
            count(*) filter (where state = 'active')::int active,
            count(*) filter (where lower(coalesce(wait_event, '')) = 'advisory')::int advisory_waits
          from pg_stat_activity
          where datname = current_database()
            and pid <> pg_backend_pid()
            and (query like '%provisioning_runs%' or query like '%pg_advisory_xact_lock%')
        `;
        return Boolean(activity && activity.active >= 2 && activity.advisory_waits >= 1);
      },
      timeoutMilliseconds,
      "forced onboarding overlap in pg_stat_activity",
    );
  }

  before(async () => {
    if (!integrationUrl || !admin) return;
    const migrations = (await readdir(migrationsDirectory))
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .sort();
    const provisioningMigration = migrations.find((file) => file.startsWith("0014_"));
    assert.equal(provisioningMigration, "0014_onboarding_provisioning.sql");
    const selectionMigration = migrations.find((file) => file.startsWith("0015_"));
    assert.equal(selectionMigration, "0015_onboarding_selection.sql");
    const ownerLockMigration = migrations.find((file) => file.startsWith("0016_"));
    assert.equal(ownerLockMigration, "0016_onboarding_owner_lock.sql");

    const freshUrl = new URL(integrationUrl);
    freshUrl.pathname = `/${freshDatabaseName}`;
    await admin.client.unsafe(`create database "${freshDatabaseName}"`);
    const fresh = createDatabase(freshUrl.toString(), { max: 1 });
    try {
      for (const file of migrations) await applyMigration(fresh.client, file);
      await applyMigration(fresh.client, ownerLockMigration);
      const [metadata] = await fresh.client<{ force_rls: boolean; migration_tables: number }[]>`
        select
          (select relforcerowsecurity from pg_class where oid = 'provisioning_runs'::regclass) force_rls,
          (select count(*)::int from information_schema.tables
           where table_schema = 'public'
             and table_name in ('provisioning_runs','provisioning_steps','onboarding_checklist_items','subscription_entitlements')) migration_tables
      `;
      assert.deepEqual(metadata, { force_rls: true, migration_tables: 4 });
      await ownerLockMetadata(fresh.client);
    } finally {
      await fresh.client.end();
      await admin.client.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${freshDatabaseName}'`,
      );
      await admin.client.unsafe(`drop database if exists "${freshDatabaseName}"`);
    }

    databaseUrl = new URL(integrationUrl);
    databaseUrl.pathname = `/${upgradeDatabaseName}`;
    await admin.client.unsafe(`create database "${upgradeDatabaseName}"`);
    const migrator = createDatabase(databaseUrl.toString(), { max: 1 });
    try {
      for (const file of migrations.filter(
        (file) =>
          file !== provisioningMigration &&
          file !== selectionMigration &&
          file !== ownerLockMigration,
      )) {
        await applyMigration(migrator.client, file);
      }
      const legacyOrganizationId = randomUUID();
      await migrator.client`
        insert into organizations (id, legal_name, trade_name, document, billing_state)
        values (${legacyOrganizationId}, 'Legacy Upgrade Ltda', 'Legacy Upgrade', '90000000000001', 'onboarding')
      `;
      await migrator.client`
        insert into onboarding_records (organization_id, checklist)
        values (${legacyOrganizationId}, '{"business":true,"unit":true}'::jsonb)
      `;
      await applyMigration(migrator.client, provisioningMigration);
      await applyMigration(migrator.client, selectionMigration);
      await applyMigration(migrator.client, ownerLockMigration);
      await applyMigration(migrator.client, ownerLockMigration);
      await ownerLockMetadata(migrator.client);
      const backfill = await migrator.client<{ item: string; status: string; source: string }[]>`
        select item, status::text, source::text
        from onboarding_checklist_items
        where organization_id = ${legacyOrganizationId}
        order by item
      `;
      assert.equal(backfill.length, 12);
      assert.deepEqual(
        backfill.find((row) => row.item === "business"),
        {
          item: "business",
          status: "in_progress",
          source: "legacy_import",
        },
      );
      assert.equal(
        (
          await migrator.client`select id from trials where organization_id = ${legacyOrganizationId}`
        ).length,
        0,
      );
      await migrator.client.unsafe(
        `create role "${loginRole}" login password '${password}' noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
      );
      await migrator.client.unsafe(`grant giromesa_app to "${loginRole}"`);
    } finally {
      await migrator.client.end();
    }

    owner = createDatabase(databaseUrl.toString(), { max: 6 });
    appConnection = createDatabase(applicationUrl(databaseUrl.toString(), loginRole, password), {
      max: 12,
    });
    database = new DatabaseService(appConnection);
    service = new OnboardingService(database, new ScopeService(database));

    const [catalog] = await owner.db
      .insert(commercialCatalogVersions)
      .values({ version: 700, status: "published", publishedAt: new Date() })
      .returning({ id: commercialCatalogVersions.id });
    assert.ok(catalog);
    catalogVersionId = catalog.id;
    const [plan] = await owner.db
      .insert(commercialPlans)
      .values({
        catalogVersionId,
        slug: "operacao",
        name: "Operação Task 7",
        monthlyPriceCents: 14_900,
        annualPriceCents: 149_000,
        includedUnits: 1,
        entitlements: ["salon", "cashier", "reports"],
      })
      .returning({ id: commercialPlans.id });
    assert.ok(plan);
    planId = plan.id;
    await owner.db.insert(commercialPlans).values({
      catalogVersionId,
      slug: "crescimento",
      name: "Crescimento Task 7",
      monthlyPriceCents: 29_900,
      annualPriceCents: 299_000,
      includedUnits: 1,
      entitlements: ["salon", "cashier", "reports", "growth"],
    });
  });

  after(async () => {
    if (database) await database.onModuleDestroy();
    if (owner) await owner.client.end();
    if (admin && databaseUrl) {
      await admin.client.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${upgradeDatabaseName}'`,
      );
      await admin.client.unsafe(`drop database if exists "${upgradeDatabaseName}"`);
      await admin.client.unsafe(`drop role if exists "${loginRole}"`);
      await admin.client.end();
    }
  });

  it("ignores adulterated legacy booleans and never starts a trial before verified evidence", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Incomplete", false);
    await owner.db
      .update(onboardingRecords)
      .set({
        checklist: Object.fromEntries(
          [
            "business",
            "unit",
            "catalog",
            "team",
            "production",
            "cashier",
            "fiscalChoice",
            "training",
            "rehearsal",
          ].map((item) => [item, true]),
        ),
      })
      .where(eq(onboardingRecords.organizationId, subject.organizationId));
    await assert.rejects(
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.activate(
            subject.ownerIdentityId,
            subject.organizationId,
            "incomplete-key-0001",
            {
              planSlug: "operacao",
            },
          ) ?? Promise.reject(new Error("service unavailable")),
      ),
      errorContains("ONBOARDING_INCOMPLETE"),
    );
    assert.equal(
      (
        await owner.db
          .select()
          .from(trials)
          .where(eq(trials.organizationId, subject.organizationId))
      ).length,
      0,
    );
    const [run] = await owner.db
      .select()
      .from(provisioningRuns)
      .where(eq(provisioningRuns.organizationId, subject.organizationId));
    assert.equal(run?.state, "retryable_failed");
    assert.equal(run?.checkpoint, "requested");
  });

  it("rejects browser-only KDS/print readiness and blocks QR without server evidence or owner waiver", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Readiness Proof");
    await assert.rejects(
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.update(subject.ownerIdentityId, subject.organizationId, {
            items: {
              production: {
                status: "verified",
                evidenceReference: "browser-kds-check",
                evidence: { mode: "kds", browserTested: true },
              },
            },
          } as never) ?? Promise.reject(new Error("service unavailable")),
      ),
      errorContains("PRODUCTION_READINESS_NOT_VERIFIED"),
    );
    await owner.db
      .update(onboardingChecklistItems)
      .set({
        status: "pending",
        source: "system",
        evidenceReference: null,
        evidence: {},
        actorIdentityId: null,
        waiverReason: null,
        verifiedAt: null,
      })
      .where(eq(onboardingChecklistItems.organizationId, subject.organizationId));
    await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.update(subject.ownerIdentityId, subject.organizationId, {
          items: {
            qr: {
              status: "verified",
              evidenceReference: "browser-qr-check",
              evidence: { browserTested: true },
            },
          },
        } as never) ?? Promise.reject(new Error("service unavailable")),
    );
    const onboarding = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.get(subject.ownerIdentityId, subject.organizationId) ??
        Promise.reject(new Error("service unavailable")),
    );
    assert.equal(onboarding.items.qr?.status, "blocked");
    assert.equal(onboarding.items.qr?.source, "system");
    assert.deepEqual(onboarding.items.qr?.evidence, {
      menuPublished: true,
      tablesConfigured: true,
      capabilitiesConfigured: false,
      serverTestPassed: false,
    });
  });

  it("round-trips pending exactly and keeps blocked and in-progress distinct", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Pending Roundtrip");
    const patch = (status: "pending" | "blocked" | "in_progress") =>
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.update(subject.ownerIdentityId, subject.organizationId, {
            items: {
              training:
                status === "pending"
                  ? { status }
                  : { status, evidenceReference: `training-${status}`, evidence: { note: status } },
            },
          }) ?? Promise.reject(new Error("service unavailable")),
      );
    const pending = await patch("pending");
    assert.equal(pending.items.training?.status, "pending");
    assert.deepEqual(pending.items.training?.evidence, {});
    const [pendingRow] = await owner.db
      .select()
      .from(onboardingChecklistItems)
      .where(
        and(
          eq(onboardingChecklistItems.organizationId, subject.organizationId),
          eq(onboardingChecklistItems.item, "training"),
        ),
      );
    assert.deepEqual(
      {
        status: pendingRow?.status,
        evidenceReference: pendingRow?.evidenceReference,
        evidence: pendingRow?.evidence,
        actorIdentityId: pendingRow?.actorIdentityId,
        verifiedAt: pendingRow?.verifiedAt,
        waiverReason: pendingRow?.waiverReason,
      },
      {
        status: "pending",
        evidenceReference: null,
        evidence: {},
        actorIdentityId: null,
        verifiedAt: null,
        waiverReason: null,
      },
    );
    assert.equal((await patch("blocked")).items.training?.status, "blocked");
    assert.equal((await patch("in_progress")).items.training?.status, "in_progress");
  });

  it("persists strict KDS and print intent without treating it as readiness", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Production Intent");
    const kdsStationId = randomUUID();
    const printerProfileId = randomUUID();
    const routes = [
      { mode: "kds" as const, kdsStationIds: [kdsStationId] },
      { mode: "print" as const, printerProfileIds: [printerProfileId] },
      {
        mode: "both" as const,
        kdsStationIds: [kdsStationId],
        printerProfileIds: [printerProfileId],
        configurationReference: "pilot-production-route",
      },
    ];
    for (const evidence of routes) {
      const onboarding = await invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.update(subject.ownerIdentityId, subject.organizationId, {
            items: {
              production: {
                status: "in_progress",
                evidenceReference: `production-${evidence.mode}`,
                evidence,
              },
            },
          }) ?? Promise.reject(new Error("service unavailable")),
      );
      assert.equal(onboarding.items.production?.status, "in_progress");
      assert.equal(onboarding.items.production?.verifiedAt, null);
      assert.equal(onboarding.ready, false);
      assert.ok(onboarding.missingItems.includes("production"));
      assert.deepEqual(onboarding.items.production?.evidence, evidence);
    }
    const off = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.update(subject.ownerIdentityId, subject.organizationId, {
          items: {
            production: {
              status: "verified",
              evidenceReference: "production-off",
              evidence: { mode: "off" },
            },
          },
        }) ?? Promise.reject(new Error("service unavailable")),
    );
    assert.equal(off.items.production?.status, "verified");
    assert.equal(off.ready, true);
  });

  it("freezes the activated checklist and audit when operational resources later drift", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Activated Freeze");
    await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.activate(
          subject.ownerIdentityId,
          subject.organizationId,
          "activated-freeze-key-0001",
          {},
        ) ?? Promise.reject(new Error("service unavailable")),
    );
    const before = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.get(subject.ownerIdentityId, subject.organizationId) ??
        Promise.reject(new Error("service unavailable")),
    );
    const checklistBefore = await owner.db
      .select()
      .from(onboardingChecklistItems)
      .where(eq(onboardingChecklistItems.organizationId, subject.organizationId));
    const auditBefore = await owner.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, subject.organizationId));
    await owner.db
      .delete(posProductPrices)
      .where(eq(posProductPrices.organizationId, subject.organizationId));
    await owner.db
      .update(posDiningTables)
      .set({ active: false })
      .where(eq(posDiningTables.organizationId, subject.organizationId));
    await owner.db
      .update(memberships)
      .set({ status: "disabled" })
      .where(eq(memberships.id, subject.cashierMembershipId));
    const after = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.get(subject.ownerIdentityId, subject.organizationId) ??
        Promise.reject(new Error("service unavailable")),
    );
    assert.equal(after.ready, true);
    assert.deepEqual(after.missingItems, []);
    assert.deepEqual(after.items, before.items);
    assert.deepEqual(after.selection, before.selection);
    assert.deepEqual(
      await owner.db
        .select()
        .from(onboardingChecklistItems)
        .where(eq(onboardingChecklistItems.organizationId, subject.organizationId)),
      checklistBefore,
    );
    assert.deepEqual(
      await owner.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organizationId, subject.organizationId)),
      auditBefore,
    );
  });

  it("pins plan/unit before the saga, exposes all 12 items and returns only allowlisted DTOs", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Projection");
    const onboarding = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.get(subject.ownerIdentityId, subject.organizationId) ??
        Promise.reject(new Error("service unavailable")),
    );
    assert.equal(Object.keys(onboarding.items).length, 12);
    assert.equal(onboarding.items.plan?.status, "verified");
    assert.equal(onboarding.selection?.selectedUnitId, subject.unitId);
    const beforeRun = JSON.stringify(onboarding);
    for (const forbidden of [
      "leaseOwner",
      "leaseExpiresAt",
      "planFingerprint",
      "planSnapshot",
      "requestFingerprint",
      '"response"',
    ]) {
      assert.equal(beforeRun.includes(forbidden), false);
    }

    const activated = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.activate(
          subject.ownerIdentityId,
          subject.organizationId,
          "projection-key-0001",
          {},
        ) ?? Promise.reject(new Error("service unavailable")),
    );
    const [stored] = await owner.db
      .select()
      .from(provisioningRuns)
      .where(eq(provisioningRuns.organizationId, subject.organizationId));
    assert.equal(stored?.selectedUnitId, subject.unitId);
    assert.equal(stored?.pinnedPlanId, onboarding.selection?.plan.id);
    assert.equal(stored?.pinnedCatalogVersion, onboarding.selection?.plan.catalogVersion);
    const status = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.provisioningStatus(
          subject.ownerIdentityId,
          subject.organizationId,
          String(activated.provisioningRunId),
        ) ?? Promise.reject(new Error("service unavailable")),
    );
    const serialized = JSON.stringify(status);
    for (const forbidden of [
      "leaseOwner",
      "leaseExpiresAt",
      "planFingerprint",
      "planSnapshot",
      "requestFingerprint",
      '"response"',
      "resourceId",
      'checkpoint":{',
    ]) {
      assert.equal(serialized.includes(forbidden), false);
    }
  });

  it("requires explicit reselection and keeps immutable before/after audit history", async (context) => {
    if (!owner || !service || !database)
      return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Audit");
    const secondUnitId = randomUUID();
    await owner.db.insert(units).values({
      id: secondUnitId,
      organizationId: subject.organizationId,
      name: "Audit Filial",
    });
    await owner.db
      .update(onboardingRecords)
      .set({ selectedPlanFingerprint: "f".repeat(64) })
      .where(eq(onboardingRecords.organizationId, subject.organizationId));
    await assert.rejects(
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.select(subject.ownerIdentityId, subject.organizationId, {
            planSlug: "operacao",
            selectedUnitId: secondUnitId,
            reselect: false,
          }) ?? Promise.reject(new Error("service unavailable")),
      ),
      errorContains("ONBOARDING_RESELECT_REQUIRED"),
    );
    await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.select(subject.ownerIdentityId, subject.organizationId, {
          planSlug: "operacao",
          selectedUnitId: secondUnitId,
          reselect: true,
        }) ?? Promise.reject(new Error("service unavailable")),
    );
    const selectedSecondUnit = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.get(subject.ownerIdentityId, subject.organizationId) ??
        Promise.reject(new Error("service unavailable")),
    );
    assert.equal(selectedSecondUnit.selection?.selectedUnitId, secondUnitId);
    assert.equal(selectedSecondUnit.items.unit?.status, "verified");
    assert.equal(selectedSecondUnit.items.catalog?.status, "blocked");
    assert.equal(selectedSecondUnit.items.tables?.status, "blocked");
    assert.equal(selectedSecondUnit.items.cashier?.status, "blocked");
    await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.update(subject.ownerIdentityId, subject.organizationId, {
          items: {
            training: {
              status: "verified",
              evidenceReference: "audit-training-repeat",
              evidence: { completed: true },
            },
          },
        }) ?? Promise.reject(new Error("service unavailable")),
    );
    const history = await owner.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, subject.organizationId));
    assert.ok(history.length >= 4);
    const updateEvent = history.find(
      (event) =>
        event.action === "onboarding.updated" &&
        (event.metadata.after as Record<string, unknown> | undefined)?.training !== undefined,
    );
    assert.ok(updateEvent);
    assert.ok(updateEvent.metadata.before);
    assert.ok(updateEvent.metadata.after);
    assert.equal(updateEvent.metadata.actorIdentityId, subject.ownerIdentityId);
    assert.ok(updateEvent.metadata.occurredAt);
    const reselectionEvent = history.find(
      (event) => event.action === "onboarding.selection_reselected",
    );
    assert.equal(
      (reselectionEvent?.metadata.before as { selectedUnitId?: string } | undefined)
        ?.selectedUnitId,
      subject.unitId,
    );
    await assert.rejects(
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          database?.db
            .update(auditEvents)
            .set({ metadata: { overwritten: true } })
            .where(eq(auditEvents.organizationId, subject.organizationId)) ??
          Promise.reject(new Error("database unavailable")),
      ),
    );
    const preserved = await owner.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, subject.organizationId));
    assert.equal(preserved.length, history.length);
    assert.ok(preserved.every((event) => event.metadata.overwritten !== true));
  });

  it("audits every automatic readiness drift in the same refresh without duplicate noise", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("System Audit");
    const waiterIdentityId = randomUUID();
    const waiterMembershipId = randomUUID();
    await owner.db.insert(identities).values({
      id: waiterIdentityId,
      email: `system-audit-waiter-${suffix}@example.test`,
      displayName: "System Audit Waiter",
      emailVerifiedAt: new Date(),
    });
    await owner.db.insert(memberships).values({
      id: waiterMembershipId,
      identityId: waiterIdentityId,
      organizationId: subject.organizationId,
      status: "active",
    });
    await owner.db.insert(roleBindings).values({
      membershipId: waiterMembershipId,
      unitId: subject.unitId,
      role: "waiter",
    });

    const refresh = () =>
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.get(subject.ownerIdentityId, subject.organizationId) ??
          Promise.reject(new Error("service unavailable")),
      );
    await refresh();
    await owner.db
      .delete(posProductPrices)
      .where(eq(posProductPrices.organizationId, subject.organizationId));
    await refresh();
    await owner.db
      .update(posDiningTables)
      .set({ active: false })
      .where(eq(posDiningTables.organizationId, subject.organizationId));
    await refresh();
    await owner.db
      .update(memberships)
      .set({ status: "disabled" })
      .where(eq(memberships.id, subject.cashierMembershipId));
    await refresh();
    await owner.db
      .update(memberships)
      .set({ status: "disabled" })
      .where(eq(memberships.id, waiterMembershipId));
    await refresh();

    const history = (
      await owner.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organizationId, subject.organizationId))
        .orderBy(auditEvents.occurredAt)
    ).filter((event) => event.action === "onboarding.system_evidence_changed");
    for (const item of ["catalog", "tables", "cashier", "team"]) {
      const transitions = history.filter((event) => event.metadata.item === item);
      assert.ok(transitions.length >= 1, `missing ${item} system audit`);
      const last = transitions.at(-1);
      assert.equal((last?.metadata.after as { status?: string } | undefined)?.status, "blocked");
      assert.ok(last?.metadata.before);
      assert.equal(last?.actorIdentityId, null);
      assert.equal(last?.metadata.actorIdentityId, null);
      assert.equal(last?.metadata.reason, "onboarding_get_refresh");
    }
    const countBeforeNoopRefresh = history.length;
    await refresh();
    const countAfterNoopRefresh = (
      await owner.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.organizationId, subject.organizationId))
    ).filter((event) => event.action === "onboarding.system_evidence_changed").length;
    assert.equal(countAfterNoopRefresh, countBeforeNoopRefresh);
  });

  it("rechecks owner after the organization lock and preserves the selection after demotion", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Owner TOCTOU");
    const before = await owner.db
      .select()
      .from(onboardingRecords)
      .where(eq(onboardingRecords.organizationId, subject.organizationId));
    const blocker = await holdAdvisoryGate(subject.organizationId, 7107);
    const selection = invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.select(subject.ownerIdentityId, subject.organizationId, {
          planSlug: "crescimento",
          selectedUnitId: subject.unitId,
          reselect: true,
        }) ?? Promise.reject(new Error("service unavailable")),
    );
    selection.catch(() => undefined);
    try {
      await assertAdvisoryWaits(1);
      await owner.db
        .update(roleBindings)
        .set({ role: "manager" })
        .where(eq(roleBindings.membershipId, subject.ownerMembershipId));
    } finally {
      await blocker.release();
    }
    await assert.rejects(selection, errorContains("ONBOARDING_ROLE_CHANGED"));
    const after = await owner.db
      .select()
      .from(onboardingRecords)
      .where(eq(onboardingRecords.organizationId, subject.organizationId));
    assert.equal(after[0]?.selectedPlanId, before[0]?.selectedPlanId);
    assert.equal(after[0]?.selectionRevision, before[0]?.selectionRevision);
  });

  it("linearizes selection against owner revocation in both commit orders", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");

    const selectionWins = await fixture("Selection Lock Wins");
    const trigger = `task7_selection_owner_${suffix.slice(0, 7)}`;
    const salt = 7131;
    await installAdvisoryGateTrigger(
      "onboarding_records",
      selectionWins.organizationId,
      trigger,
      salt,
      "update",
    );
    const gate = await holdAdvisoryGate(selectionWins.organizationId, salt);
    const selection = invoke(
      selectionWins.ownerIdentityId,
      selectionWins.organizationId,
      () =>
        service?.select(selectionWins.ownerIdentityId, selectionWins.organizationId, {
          planSlug: "crescimento",
          selectedUnitId: selectionWins.unitId,
          reselect: true,
        }) ?? Promise.reject(new Error("service unavailable")),
    );
    selection.catch(() => undefined);
    let lateDemotion: Promise<unknown> | undefined;
    try {
      await assertAdvisoryWaits(1);
      lateDemotion = owner.db
        .update(roleBindings)
        .set({ role: "manager" })
        .where(eq(roleBindings.membershipId, selectionWins.ownerMembershipId));
      lateDemotion.catch(() => undefined);
      await assertRowLockWaits(1);
    } finally {
      await gate.release();
    }
    try {
      assert.equal((await selection)?.plan.slug, "crescimento");
      await lateDemotion;
    } finally {
      await removeFailureTrigger("onboarding_records", trigger);
    }
    await owner.db
      .update(roleBindings)
      .set({ role: "owner" })
      .where(eq(roleBindings.membershipId, selectionWins.ownerMembershipId));

    const revocationWins = await fixture("Selection Revocation Wins");
    const heldDemotion = await holdOwnerDemotion(revocationWins.ownerMembershipId);
    const rejectedSelection = invoke(
      revocationWins.ownerIdentityId,
      revocationWins.organizationId,
      () =>
        service?.select(revocationWins.ownerIdentityId, revocationWins.organizationId, {
          planSlug: "crescimento",
          selectedUnitId: revocationWins.unitId,
          reselect: true,
        }) ?? Promise.reject(new Error("service unavailable")),
    );
    rejectedSelection.catch(() => undefined);
    await assertRowLockWaits(1);
    await heldDemotion.release();
    await assert.rejects(rejectedSelection, errorContains("ONBOARDING_ROLE_CHANGED"));
    const [preserved] = await owner.db
      .select()
      .from(onboardingRecords)
      .where(eq(onboardingRecords.organizationId, revocationWins.organizationId));
    assert.equal(preserved?.selectedPlanId, planId);
  });

  it("linearizes final activation against owner revocation in both commit orders", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");

    const activationWins = await fixture("Activation Owner Lock Wins");
    const trialTrigger = `task7_activation_owner_${suffix.slice(0, 7)}`;
    const trialSalt = 7132;
    await installAdvisoryGateTrigger(
      "trials",
      activationWins.organizationId,
      trialTrigger,
      trialSalt,
      "insert",
    );
    const trialGate = await holdAdvisoryGate(activationWins.organizationId, trialSalt);
    const activation = invoke(
      activationWins.ownerIdentityId,
      activationWins.organizationId,
      () =>
        service?.activate(
          activationWins.ownerIdentityId,
          activationWins.organizationId,
          "activation-owner-lock-key-0001",
          {},
        ) ?? Promise.reject(new Error("service unavailable")),
    );
    activation.catch(() => undefined);
    let lateDemotion: Promise<unknown> | undefined;
    try {
      await assertAdvisoryWaits(1);
      lateDemotion = owner.db
        .update(roleBindings)
        .set({ role: "manager" })
        .where(eq(roleBindings.membershipId, activationWins.ownerMembershipId));
      lateDemotion.catch(() => undefined);
      await assertRowLockWaits(1);
    } finally {
      await trialGate.release();
    }
    try {
      assert.equal((await activation).state, "completed");
      await lateDemotion;
    } finally {
      await removeFailureTrigger("trials", trialTrigger);
    }

    const revocationWins = await fixture("Activation Revocation Wins");
    const subscriptionTrigger = `task7_pre_final_owner_${suffix.slice(0, 7)}`;
    const subscriptionSalt = 7133;
    await installAdvisoryGateTrigger(
      "subscriptions",
      revocationWins.organizationId,
      subscriptionTrigger,
      subscriptionSalt,
      "insert",
    );
    const subscriptionGate = await holdAdvisoryGate(
      revocationWins.organizationId,
      subscriptionSalt,
    );
    const rejectedActivation = invoke(
      revocationWins.ownerIdentityId,
      revocationWins.organizationId,
      () =>
        service?.activate(
          revocationWins.ownerIdentityId,
          revocationWins.organizationId,
          "activation-revocation-key-0001",
          {},
        ) ?? Promise.reject(new Error("service unavailable")),
    );
    rejectedActivation.catch(() => undefined);
    try {
      await assertAdvisoryWaits(1);
      await owner.db
        .update(roleBindings)
        .set({ role: "manager" })
        .where(eq(roleBindings.membershipId, revocationWins.ownerMembershipId));
    } finally {
      await subscriptionGate.release();
    }
    try {
      await assert.rejects(rejectedActivation, errorContains("PROVISIONING_OWNER_CHANGED"));
    } finally {
      await removeFailureTrigger("subscriptions", subscriptionTrigger);
    }
    assert.equal(
      (
        await owner.db
          .select()
          .from(trials)
          .where(eq(trials.organizationId, revocationWins.organizationId))
      ).length,
      0,
    );
  });

  it("serializes final activation before PATCH and rejects the late mutation without changing evidence", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Activation Wins");
    const trigger = `task7_final_gate_${suffix.slice(0, 8)}`;
    const salt = 7121;
    await installAdvisoryGateTrigger("trials", subject.organizationId, trigger, salt, "insert");
    const blocker = await holdAdvisoryGate(subject.organizationId, salt);
    const activation = invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.activate(
          subject.ownerIdentityId,
          subject.organizationId,
          "activation-wins-key-0001",
          {},
        ) ?? Promise.reject(new Error("service unavailable")),
    );
    activation.catch(() => undefined);
    let patch: Promise<unknown> | undefined;
    try {
      await assertAdvisoryWaits(1);
      patch = invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.update(subject.ownerIdentityId, subject.organizationId, {
            items: { training: { status: "blocked", evidence: { note: "late mutation" } } },
          }) ?? Promise.reject(new Error("service unavailable")),
      );
      patch.catch(() => undefined);
      await assertAdvisoryWaits(2);
    } finally {
      await blocker.release();
    }
    try {
      assert.equal((await activation).state, "completed");
      await assert.rejects(
        patch ?? Promise.resolve(),
        errorContains("ONBOARDING_ALREADY_ACTIVATED"),
      );
    } finally {
      await removeFailureTrigger("trials", trigger);
    }
    const [training] = await owner.db
      .select()
      .from(onboardingChecklistItems)
      .where(
        and(
          eq(onboardingChecklistItems.organizationId, subject.organizationId),
          eq(onboardingChecklistItems.item, "training"),
        ),
      );
    assert.notEqual(training?.evidenceReference, null);
    assert.equal(
      (
        await owner.db
          .select()
          .from(trials)
          .where(eq(trials.organizationId, subject.organizationId))
      ).length,
      1,
    );
  });

  it("commits a readiness-invalidating PATCH first and makes the waiting activation revalidate", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Patch Wins");
    const trigger = `task7_patch_gate_${suffix.slice(0, 8)}`;
    const salt = 7122;
    await installAdvisoryGateTrigger(
      "onboarding_checklist_items",
      subject.organizationId,
      trigger,
      salt,
      "update",
      "new.item = 'training'",
    );
    const blocker = await holdAdvisoryGate(subject.organizationId, salt);
    const patch = invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.update(subject.ownerIdentityId, subject.organizationId, {
          items: { training: { status: "blocked", evidence: { note: "readiness removed" } } },
        }) ?? Promise.reject(new Error("service unavailable")),
    );
    patch.catch(() => undefined);
    let activation: Promise<unknown> | undefined;
    try {
      await assertAdvisoryWaits(1);
      activation = invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.activate(
            subject.ownerIdentityId,
            subject.organizationId,
            "patch-wins-key-0001",
            {},
          ) ?? Promise.reject(new Error("service unavailable")),
      );
      activation.catch(() => undefined);
      await assertAdvisoryWaits(2);
    } finally {
      await blocker.release();
    }
    try {
      await patch;
      await assert.rejects(activation ?? Promise.resolve(), errorContains("ONBOARDING_INCOMPLETE"));
    } finally {
      await removeFailureTrigger("onboarding_checklist_items", trigger);
    }
    assert.equal(
      (
        await owner.db
          .select()
          .from(trials)
          .where(eq(trials.organizationId, subject.organizationId))
      ).length,
      0,
    );
  });

  it("recovers after a committed checkpoint, starts the trial only in the final commit, and replays the response", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Recovery");
    const trigger = `task7_trial_fail_${suffix.slice(0, 10)}`;
    await installFailureTrigger("trials", subject.organizationId, trigger);
    try {
      await assert.rejects(
        invoke(
          subject.ownerIdentityId,
          subject.organizationId,
          () =>
            service?.activate(
              subject.ownerIdentityId,
              subject.organizationId,
              "recovery-key-0001",
              {
                planSlug: "operacao",
              },
            ) ?? Promise.reject(new Error("service unavailable")),
        ),
        errorContains("PROVISIONING_TRANSIENT_FAILURE"),
      );
    } finally {
      await removeFailureTrigger("trials", trigger);
    }
    const finalCommitLowerBound = new Date();
    const [interrupted] = await owner.db
      .select()
      .from(provisioningRuns)
      .where(eq(provisioningRuns.organizationId, subject.organizationId));
    assert.equal(interrupted?.state, "retryable_failed");
    assert.equal(interrupted?.checkpoint, "internal_provisioned");
    assert.equal(
      (
        await owner.db
          .select()
          .from(trials)
          .where(eq(trials.organizationId, subject.organizationId))
      ).length,
      0,
    );
    const [draft] = await owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, subject.organizationId));
    assert.equal(draft?.state, "onboarding");

    const activated = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.activate(subject.ownerIdentityId, subject.organizationId, "recovery-key-0001", {
          planSlug: "operacao",
        }) ?? Promise.reject(new Error("service unavailable")),
    );
    const replay = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.activate(subject.ownerIdentityId, subject.organizationId, "recovery-key-0001", {
          planSlug: "operacao",
        }) ?? Promise.reject(new Error("service unavailable")),
    );
    assert.deepEqual(replay, activated);
    assert.equal(activated.state, "completed");
    assert.ok(new Date(String(activated.startsAt)) >= finalCommitLowerBound);
    const [counts] = await owner.client<
      {
        trials: number;
        subscriptions: number;
        outbox: number;
        audit: number;
        active_entitlements: number;
      }[]
    >`
      select
        (select count(*)::int from trials where organization_id = ${subject.organizationId}) trials,
        (select count(*)::int from subscriptions where organization_id = ${subject.organizationId}) subscriptions,
        (select count(*)::int from outbox_events where organization_id = ${subject.organizationId} and topic = 'trial.activated') outbox,
        (select count(*)::int from audit_events where organization_id = ${subject.organizationId} and action = 'trial.activated') audit,
        (select count(*)::int from subscription_entitlements where organization_id = ${subject.organizationId} and state = 'active') active_entitlements
    `;
    assert.deepEqual(counts, {
      trials: 1,
      subscriptions: 1,
      outbox: 1,
      audit: 1,
      active_entitlements: 3,
    });
    await assert.rejects(
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.activate(subject.ownerIdentityId, subject.organizationId, "recovery-key-0001", {
            planSlug: "crescimento",
          }) ?? Promise.reject(new Error("service unavailable")),
      ),
      errorContains("IDEMPOTENCY_INPUT_MISMATCH"),
    );
  });

  it("continues the commit after an HTTP socket abort and replays the stored response", {
    timeout: 15_000,
  }, async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Socket Abort");
    const started = deferred<void>();
    const finished = deferred<Record<string, unknown>>();
    const server = createServer(async (_request, response) => {
      started.resolve(undefined);
      try {
        const result = await invoke(
          subject.ownerIdentityId,
          subject.organizationId,
          () =>
            service?.activate(
              subject.ownerIdentityId,
              subject.organizationId,
              "socket-abort-key-0001",
              {},
            ) ?? Promise.reject(new Error("service unavailable")),
        );
        finished.resolve(result);
        if (!response.destroyed) {
          response.writeHead(201, { "Content-Type": "application/json" });
          response.end(JSON.stringify(result));
        }
      } catch (error) {
        finished.reject(error);
        if (!response.destroyed) response.destroy(error as Error);
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const client = httpRequest({
      hostname: "127.0.0.1",
      port: address.port,
      path: "/activate",
      method: "POST",
    });
    client.on("error", () => undefined);
    client.end("{}");
    await withTimeout(started.promise, 2_000, "HTTP handler start");
    client.destroy();
    const committed = await withTimeout(finished.promise, 10_000, "commit after socket abort");
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    const replay = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.activate(
          subject.ownerIdentityId,
          subject.organizationId,
          "socket-abort-key-0001",
          {},
        ) ?? Promise.reject(new Error("service unavailable")),
    );
    assert.deepEqual(replay, committed);
    const [counts] = await owner.client<
      { trials: number; subscriptions: number; outbox: number }[]
    >`
        select
          (select count(*)::int from trials where organization_id = ${subject.organizationId}) trials,
          (select count(*)::int from subscriptions where organization_id = ${subject.organizationId}) subscriptions,
          (select count(*)::int from outbox_events where organization_id = ${subject.organizationId} and topic = 'trial.activated') outbox
      `;
    assert.deepEqual(counts, { trials: 1, subscriptions: 1, outbox: 1 });
  });

  it("forces overlapping same-key requests and replays one exact effect", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Same Key Concurrent");
    const trigger = `task7_same_key_sleep_${suffix.slice(0, 8)}`;
    await installSleepTrigger("provisioning_runs", subject.organizationId, trigger, 2);
    const calls = [
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.activate(subject.ownerIdentityId, subject.organizationId, "same-key-0001", {}) ??
          Promise.reject(new Error("service unavailable")),
      ),
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.activate(subject.ownerIdentityId, subject.organizationId, "same-key-0001", {}) ??
          Promise.reject(new Error("service unavailable")),
      ),
    ];
    try {
      await assertForcedOverlap();
      const [left, right] = await withTimeout(Promise.all(calls), 12_000, "same-key overlap");
      assert.deepEqual(left, right);
    } finally {
      await Promise.allSettled(calls);
      await removeFailureTrigger("provisioning_runs", trigger);
    }
    const [counts] = await owner.client<
      { trials: number; subscriptions: number; outbox: number }[]
    >`
      select
        (select count(*)::int from trials where organization_id = ${subject.organizationId}) trials,
        (select count(*)::int from subscriptions where organization_id = ${subject.organizationId}) subscriptions,
        (select count(*)::int from outbox_events where organization_id = ${subject.organizationId} and topic = 'trial.activated') outbox
    `;
    assert.deepEqual(counts, { trials: 1, subscriptions: 1, outbox: 1 });
  });

  it("forces overlapping distinct keys to one trial and one effect", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Concurrent");
    const trigger = `task7_distinct_sleep_${suffix.slice(0, 8)}`;
    await installSleepTrigger("provisioning_runs", subject.organizationId, trigger, 2);
    const calls = [
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.activate(
            subject.ownerIdentityId,
            subject.organizationId,
            "concurrent-key-0001",
            {
              planSlug: "operacao",
            },
          ) ?? Promise.reject(new Error("service unavailable")),
      ),
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.activate(
            subject.ownerIdentityId,
            subject.organizationId,
            "concurrent-key-0002",
            {
              planSlug: "operacao",
            },
          ) ?? Promise.reject(new Error("service unavailable")),
      ),
    ];
    let results: PromiseSettledResult<unknown>[] = [];
    try {
      await assertForcedOverlap();
      results = await withTimeout(Promise.allSettled(calls), 12_000, "distinct-key overlap");
    } finally {
      await Promise.allSettled(calls);
      await removeFailureTrigger("provisioning_runs", trigger);
    }
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const [counts] = await owner.client<
      { trials: number; subscriptions: number; outbox: number }[]
    >`
      select
        (select count(*)::int from trials where organization_id = ${subject.organizationId}) trials,
        (select count(*)::int from subscriptions where organization_id = ${subject.organizationId}) subscriptions,
        (select count(*)::int from outbox_events where organization_id = ${subject.organizationId} and topic = 'trial.activated') outbox
    `;
    assert.deepEqual(counts, { trials: 1, subscriptions: 1, outbox: 1 });
  });

  it("survives real backend termination, preserves the lease, then reclaims after expiry", {
    timeout: 60_000,
  }, async (context) => {
    if (!owner || !service || !databaseUrl)
      return context.skip("PROVISIONING_DATABASE_URL not configured");
    const ownerConnection = owner;
    const subject = await fixture("Crash Worker");
    const trigger = `task7_crash_sleep_${suffix.slice(0, 8)}`;
    await installSleepTrigger("subscriptions", subject.organizationId, trigger, 8);
    const workerUrl = fileURLToPath(new URL("./provisioning-crash-worker.js", import.meta.url));
    const child = spawn(
      process.execPath,
      [
        workerUrl,
        databaseUrl.toString(),
        subject.ownerIdentityId,
        subject.organizationId,
        "crash-worker-key-0001",
      ],
      { stdio: "ignore" },
    );
    try {
      await waitUntil(
        async () => {
          const [run] = await ownerConnection.db
            .select()
            .from(provisioningRuns)
            .where(eq(provisioningRuns.organizationId, subject.organizationId));
          return Boolean(run?.checkpoint === "validated" && run.leaseOwner && run.leaseExpiresAt);
        },
        8_000,
        "child checkpoint and lease",
      );
      const exited = once(child, "exit");
      assert.equal(child.kill(), true);
      await withTimeout(
        exited.then(() => undefined),
        5_000,
        "crash worker exit",
      );
    } finally {
      if (child.exitCode === null) child.kill();
      await removeFailureTrigger("subscriptions", trigger);
    }

    const [orphaned] = await owner.db
      .select()
      .from(provisioningRuns)
      .where(eq(provisioningRuns.organizationId, subject.organizationId));
    assert.equal(orphaned?.checkpoint, "validated");
    assert.equal(orphaned?.state, "provisioning");
    assert.ok(orphaned?.leaseOwner);
    assert.ok(orphaned?.leaseExpiresAt && orphaned.leaseExpiresAt > new Date());
    const leaseOwner = orphaned?.leaseOwner;
    const attempts = orphaned?.attempts;
    await assert.rejects(
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.activate(
            subject.ownerIdentityId,
            subject.organizationId,
            "crash-worker-key-0001",
            {},
          ) ?? Promise.reject(new Error("service unavailable")),
      ),
      errorContains("PROVISIONING_IN_PROGRESS"),
    );
    const [notStolen] = await owner.db
      .select()
      .from(provisioningRuns)
      .where(eq(provisioningRuns.organizationId, subject.organizationId));
    assert.equal(notStolen?.leaseOwner, leaseOwner);
    assert.equal(notStolen?.attempts, attempts);

    const remaining = Math.max(
      0,
      (notStolen?.leaseExpiresAt?.getTime() ?? Date.now()) - Date.now() + 100,
    );
    await new Promise((resolve) => setTimeout(resolve, remaining));
    const resumed = await withTimeout(
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.activate(
            subject.ownerIdentityId,
            subject.organizationId,
            "crash-worker-key-0001",
            {},
          ) ?? Promise.reject(new Error("service unavailable")),
      ),
      10_000,
      "post-expiry reclaim",
    );
    assert.equal(resumed.state, "completed");
    const [counts] = await owner.client<
      { trials: number; subscriptions: number; outbox: number }[]
    >`
        select
          (select count(*)::int from trials where organization_id = ${subject.organizationId}) trials,
          (select count(*)::int from subscriptions where organization_id = ${subject.organizationId}) subscriptions,
          (select count(*)::int from outbox_events where organization_id = ${subject.organizationId} and topic = 'trial.activated') outbox
      `;
    assert.deepEqual(counts, { trials: 1, subscriptions: 1, outbox: 1 });
  });

  it("pins the plan and compensates provisional resources when that exact plan drifts", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Plan Drift");
    const trigger = `task7_plan_fail_${suffix.slice(0, 10)}`;
    await installFailureTrigger("trials", subject.organizationId, trigger);
    try {
      await assert.rejects(
        invoke(
          subject.ownerIdentityId,
          subject.organizationId,
          () =>
            service?.activate(
              subject.ownerIdentityId,
              subject.organizationId,
              "plan-drift-key-0001",
              {
                planSlug: "operacao",
              },
            ) ?? Promise.reject(new Error("service unavailable")),
        ),
        errorContains("PROVISIONING_TRANSIENT_FAILURE"),
      );
    } finally {
      await removeFailureTrigger("trials", trigger);
    }
    await owner.db
      .update(commercialPlans)
      .set({ monthlyPriceCents: 15_900 })
      .where(eq(commercialPlans.id, planId));
    await assert.rejects(
      invoke(
        subject.ownerIdentityId,
        subject.organizationId,
        () =>
          service?.activate(
            subject.ownerIdentityId,
            subject.organizationId,
            "plan-drift-key-0001",
            {
              planSlug: "operacao",
            },
          ) ?? Promise.reject(new Error("service unavailable")),
      ),
      errorContains("PLAN_DRIFT"),
    );
    const [run] = await owner.db
      .select()
      .from(provisioningRuns)
      .where(eq(provisioningRuns.organizationId, subject.organizationId));
    const [subscription] = await owner.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.organizationId, subject.organizationId));
    const entitlements = await owner.db
      .select()
      .from(subscriptionEntitlements)
      .where(eq(subscriptionEntitlements.organizationId, subject.organizationId));
    assert.equal(run?.state, "compensated");
    assert.equal(run?.lastErrorCode, "PLAN_DRIFT");
    assert.equal((run?.planSnapshot as Record<string, unknown> | null)?.monthlyPriceCents, 14_900);
    assert.deepEqual((run?.planSnapshot as Record<string, unknown> | null)?.entitlements, [
      "cashier",
      "reports",
      "salon",
    ]);
    assert.equal(subscription?.state, "canceled");
    assert.ok(entitlements.length > 0 && entitlements.every((entry) => entry.state === "revoked"));
    assert.equal(
      (
        await owner.db
          .select()
          .from(trials)
          .where(eq(trials.organizationId, subject.organizationId))
      ).length,
      0,
    );
  });

  it("enforces FORCE RLS and least privilege for every new tenant table", async (context) => {
    if (!owner || !database) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const tenantA = await fixture("RLS A", false);
    const tenantB = await fixture("RLS B", false);
    await owner.db.insert(provisioningRuns).values({
      organizationId: tenantA.organizationId,
      idempotencyKey: "rls-a-key-0001",
      requestFingerprint: "a".repeat(64),
      planSlug: "operacao",
    });
    const invisible = await invoke(
      tenantB.ownerIdentityId,
      tenantB.organizationId,
      () =>
        database?.db
          .select({ id: provisioningRuns.id })
          .from(provisioningRuns)
          .where(eq(provisioningRuns.organizationId, tenantA.organizationId)) ??
        Promise.reject(new Error("database unavailable")),
    );
    assert.deepEqual(invisible, []);
    await assert.rejects(
      invoke(
        tenantB.ownerIdentityId,
        tenantB.organizationId,
        () =>
          database?.db.insert(provisioningRuns).values({
            organizationId: tenantA.organizationId,
            idempotencyKey: "rls-cross-key-0001",
            requestFingerprint: "b".repeat(64),
            planSlug: "operacao",
          }) ?? Promise.reject(new Error("database unavailable")),
      ),
    );
    const [spoofedLock] = await invoke(
      tenantB.ownerIdentityId,
      tenantB.organizationId,
      () =>
        database?.db.execute<{ authorized: boolean }>(sql`
          select giromesa_lock_onboarding_owner(
            ${tenantB.organizationId}::uuid,
            ${tenantA.ownerIdentityId}::uuid
          ) as authorized
        `) ?? Promise.reject(new Error("database unavailable")),
    );
    assert.equal(spoofedLock?.authorized, false);
    assert.equal(
      await callOwnerLockWithRawContext(
        tenantB.organizationId.toUpperCase(),
        tenantB.ownerIdentityId.toUpperCase(),
        tenantB.organizationId,
        tenantB.ownerIdentityId,
      ),
      true,
    );
    assert.equal(
      await callOwnerLockWithRawContext(
        "not-a-uuid",
        tenantB.ownerIdentityId,
        tenantB.organizationId,
        tenantB.ownerIdentityId,
      ),
      false,
    );
    assert.equal(
      await callOwnerLockWithRawContext("", "", tenantB.organizationId, tenantB.ownerIdentityId),
      false,
    );
    await owner.db
      .update(onboardingChecklistItems)
      .set({ status: "in_progress", source: "legacy_import" })
      .where(eq(onboardingChecklistItems.organizationId, tenantB.organizationId));
    await assert.rejects(
      invoke(
        tenantB.ownerIdentityId,
        tenantB.organizationId,
        () =>
          database?.db
            .update(onboardingChecklistItems)
            .set({
              status: "verified",
              source: "actor_attestation",
              evidenceReference: "forged-browser-checklist",
              actorIdentityId: null,
              verifiedAt: null,
            })
            .where(eq(onboardingChecklistItems.organizationId, tenantB.organizationId)) ??
          Promise.reject(new Error("database unavailable")),
      ),
    );
    const [privileges] = await owner.client<
      {
        force_runs: boolean;
        force_steps: boolean;
        force_checklist: boolean;
        force_entitlements: boolean;
        app_runs: boolean;
        worker_runs: boolean;
        app_subscription_table_insert: boolean;
        app_subscription_run_column_insert: boolean;
        app_selection_update: boolean;
        worker_selection_update: boolean;
        app_audit_update: boolean;
        app_membership_update: boolean;
        app_role_binding_update: boolean;
        app_owner_lock_execute: boolean;
      }[]
    >`
      select
        (select relforcerowsecurity from pg_class where oid = 'provisioning_runs'::regclass) force_runs,
        (select relforcerowsecurity from pg_class where oid = 'provisioning_steps'::regclass) force_steps,
        (select relforcerowsecurity from pg_class where oid = 'onboarding_checklist_items'::regclass) force_checklist,
        (select relforcerowsecurity from pg_class where oid = 'subscription_entitlements'::regclass) force_entitlements,
        has_table_privilege('giromesa_app', 'provisioning_runs', 'select,insert,update') app_runs,
        has_table_privilege('giromesa_worker', 'provisioning_runs', 'select') worker_runs,
        has_table_privilege('giromesa_app', 'subscriptions', 'insert') app_subscription_table_insert,
        has_column_privilege('giromesa_app', 'subscriptions', 'provisioning_run_id', 'insert') app_subscription_run_column_insert,
        has_column_privilege('giromesa_app', 'onboarding_records', 'selected_plan_snapshot', 'update') app_selection_update,
        has_column_privilege('giromesa_worker', 'onboarding_records', 'selected_plan_snapshot', 'update') worker_selection_update,
        has_table_privilege('giromesa_app', 'audit_events', 'update') app_audit_update,
        has_table_privilege('giromesa_app', 'memberships', 'update') app_membership_update,
        has_table_privilege('giromesa_app', 'role_bindings', 'update') app_role_binding_update,
        has_function_privilege('giromesa_app', 'giromesa_lock_onboarding_owner(uuid,uuid)', 'execute') app_owner_lock_execute
    `;
    assert.deepEqual(privileges, {
      force_runs: true,
      force_steps: true,
      force_checklist: true,
      force_entitlements: true,
      app_runs: true,
      worker_runs: false,
      app_subscription_table_insert: false,
      app_subscription_run_column_insert: true,
      app_selection_update: true,
      worker_selection_update: false,
      app_audit_update: false,
      app_membership_update: false,
      app_role_binding_update: false,
      app_owner_lock_execute: true,
    });
  });
});
