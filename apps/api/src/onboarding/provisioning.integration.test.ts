import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
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
import { eq } from "drizzle-orm";
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
      await invoke(
        ownerIdentityId,
        organizationId,
        () =>
          service?.update(ownerIdentityId, organizationId, {
            items: {
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
    return { organizationId, unitId, ownerIdentityId };
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

  before(async () => {
    if (!integrationUrl || !admin) return;
    const migrations = (await readdir(migrationsDirectory))
      .filter((file) => /^\d{4}_.+\.sql$/.test(file))
      .sort();
    const provisioningMigration = migrations.find((file) => file.startsWith("0014_"));
    assert.equal(provisioningMigration, "0014_onboarding_provisioning.sql");

    const freshUrl = new URL(integrationUrl);
    freshUrl.pathname = `/${freshDatabaseName}`;
    await admin.client.unsafe(`create database "${freshDatabaseName}"`);
    const fresh = createDatabase(freshUrl.toString(), { max: 1 });
    try {
      for (const file of migrations) await applyMigration(fresh.client, file);
      const [metadata] = await fresh.client<{ force_rls: boolean; migration_tables: number }[]>`
        select
          (select relforcerowsecurity from pg_class where oid = 'provisioning_runs'::regclass) force_rls,
          (select count(*)::int from information_schema.tables
           where table_schema = 'public'
             and table_name in ('provisioning_runs','provisioning_steps','onboarding_checklist_items','subscription_entitlements')) migration_tables
      `;
      assert.deepEqual(metadata, { force_rls: true, migration_tables: 4 });
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
      for (const file of migrations.filter((file) => file !== provisioningMigration)) {
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

  it("serializes distinct concurrent keys to one trial and one effect", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Concurrent");
    const results = await Promise.allSettled([
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
    ]);
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

  it("resumes after a crash-equivalent failure at validation checkpoint", async (context) => {
    if (!owner || !service) return context.skip("PROVISIONING_DATABASE_URL not configured");
    const subject = await fixture("Checkpoint");
    const trigger = `task7_subscription_fail_${suffix.slice(0, 10)}`;
    await installFailureTrigger("subscriptions", subject.organizationId, trigger);
    try {
      await assert.rejects(
        invoke(
          subject.ownerIdentityId,
          subject.organizationId,
          () =>
            service?.activate(
              subject.ownerIdentityId,
              subject.organizationId,
              "checkpoint-key-0001",
              {
                planSlug: "operacao",
              },
            ) ?? Promise.reject(new Error("service unavailable")),
        ),
        errorContains("PROVISIONING_TRANSIENT_FAILURE"),
      );
    } finally {
      await removeFailureTrigger("subscriptions", trigger);
    }
    const [interrupted] = await owner.db
      .select()
      .from(provisioningRuns)
      .where(eq(provisioningRuns.organizationId, subject.organizationId));
    assert.equal(interrupted?.checkpoint, "validated");
    assert.equal(interrupted?.state, "retryable_failed");
    const resumed = await invoke(
      subject.ownerIdentityId,
      subject.organizationId,
      () =>
        service?.activate(subject.ownerIdentityId, subject.organizationId, "checkpoint-key-0001", {
          planSlug: "operacao",
        }) ?? Promise.reject(new Error("service unavailable")),
    );
    assert.equal(resumed.state, "completed");
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
    await owner.db.insert(onboardingChecklistItems).values({
      organizationId: tenantB.organizationId,
      item: "training",
      status: "in_progress",
      source: "legacy_import",
    });
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
        has_column_privilege('giromesa_app', 'subscriptions', 'provisioning_run_id', 'insert') app_subscription_run_column_insert
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
    });
  });
});
