import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import {
  createDatabase,
  doseClubReconciliationFindings,
  doseClubReconciliationRuns,
  withTenantContext,
  withWorkerContext,
} from "./index.js";

const integrationUrl = process.env.TENANT_ISOLATION_DATABASE_URL;
const migrationsDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));

async function applyMigration(client: ReturnType<typeof createDatabase>["client"], file: string) {
  const source = await readFile(`${migrationsDirectory}${file}`, "utf8");
  const statements = source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await client.begin(async (transaction) => {
    for (const statement of statements) await transaction.unsafe(statement);
  });
}

describe("0027 DoseClub reconciliation upgrade", () => {
  it("adds forced-RLS durable runs/findings with worker-only mutation and CAS transitions", async (context) => {
    if (!integrationUrl) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }
    const databaseName = `giromesa_doseclub_reconciliation_${randomUUID().replaceAll("-", "")}`;
    const loginRole = `gm_t32_${randomUUID().replaceAll("-", "")}`;
    const loginPassword = `T32-${randomUUID()}`;
    const admin = createDatabase(integrationUrl).client;
    const databaseUrl = new URL(integrationUrl);
    databaseUrl.pathname = `/${databaseName}`;
    let database: ReturnType<typeof createDatabase> | undefined;
    let application: ReturnType<typeof createDatabase> | undefined;
    try {
      await admin.unsafe(`create database "${databaseName}"`);
      database = createDatabase(databaseUrl.toString(), { max: 3 });
      const baseline = (await readdir(migrationsDirectory))
        .filter((file) => /^00(?:0[0-9]|1[0-9]|2[0-6])_.*\.sql$/.test(file))
        .sort();
      assert.equal(baseline.at(-1), "0026_doseclub_integration.sql");
      for (const file of baseline) await applyMigration(database.client, file);

      const organizationId = randomUUID();
      const unitId = randomUUID();
      const organizationBId = randomUUID();
      const unitBId = randomUUID();
      const identityId = randomUUID();
      await database.client`
        insert into organizations (id, legal_name, trade_name, document)
        values (${organizationId}, 'Reconciliation Ltda', 'Reconciliation', '22333444000191')
      `;
      await database.client`
        insert into units (id, organization_id, name)
        values (${unitId}, ${organizationId}, 'Unit')
      `;
      await database.client`
        insert into organizations (id, legal_name, trade_name, document)
        values (${organizationBId}, 'Other Reconciliation Ltda', 'Other Reconciliation', '22333444000192')
      `;
      await database.client`
        insert into units (id, organization_id, name)
        values (${unitBId}, ${organizationBId}, 'Other Unit')
      `;
      await database.client`
        insert into identities (id, email, display_name, email_verified_at)
        values (${identityId}, ${`t32-${identityId}@example.test`}, 'T32 Owner', now())
      `;
      const [membership] = await database.client<{ id: string }[]>`
        insert into memberships (identity_id, organization_id, status)
        values (${identityId}, ${organizationId}, 'active')
        returning id
      `;
      assert.ok(membership);
      await database.client`
        insert into role_bindings (membership_id, role)
        values (${membership.id}, 'owner')
      `;
      await applyMigration(database.client, "0027_doseclub_reconciliation.sql");

      await admin.unsafe(
        `create role "${loginRole}" login password '${loginPassword}' noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`,
      );
      await admin.unsafe(`grant giromesa_app, giromesa_worker to "${loginRole}"`);

      const appUrl = new URL(databaseUrl);
      appUrl.username = loginRole;
      appUrl.password = loginPassword;
      application = createDatabase(appUrl.toString(), { max: 3 });

      const [security] = await database.client<
        {
          forced_tables: number;
          app_can_insert_findings: boolean;
          app_can_update_findings: boolean;
          worker_can_update_findings: boolean;
        }[]
      >`
        select
          (select count(*)::int from pg_class where oid in (
            'doseclub_reconciliation_runs'::regclass,
            'doseclub_reconciliation_findings'::regclass
          ) and relrowsecurity and relforcerowsecurity) forced_tables,
          has_table_privilege('giromesa_app', 'doseclub_reconciliation_findings', 'INSERT')
            app_can_insert_findings,
          has_table_privilege('giromesa_app', 'doseclub_reconciliation_findings', 'UPDATE')
            app_can_update_findings,
          has_table_privilege('giromesa_worker', 'doseclub_reconciliation_findings', 'UPDATE')
            worker_can_update_findings
      `;
      assert.deepEqual(security, {
        forced_tables: 2,
        app_can_insert_findings: false,
        app_can_update_findings: false,
        worker_can_update_findings: true,
      });

      const runId = randomUUID();
      await database.client`
        insert into doseclub_reconciliation_runs (
          id, organization_id, unit_id, run_date, trigger, status
        ) values (${runId}, ${organizationId}, ${unitId}, current_date, 'scheduled', 'pending')
      `;
      await database.client`
        insert into doseclub_reconciliation_runs (
          organization_id, unit_id, run_date, trigger, status
        ) values (${organizationBId}, ${unitBId}, current_date, 'manual', 'pending')
      `;
      const tenantRows = await withTenantContext(
        application,
        {
          source: "http",
          organizationId,
          unitId,
          actorIdentityId: identityId,
        },
        (tx) => tx.select().from(doseClubReconciliationRuns),
      );
      assert.equal(tenantRows.length, 1);
      assert.equal(tenantRows[0]?.organizationId, organizationId);

      const manualRunId = randomUUID();
      await withTenantContext(
        application,
        {
          source: "http",
          organizationId,
          unitId,
          actorIdentityId: identityId,
        },
        (tx) =>
          tx.insert(doseClubReconciliationRuns).values({
            id: manualRunId,
            organizationId,
            unitId,
            runDate: new Date().toISOString().slice(0, 10),
            trigger: "manual",
            status: "pending",
            idempotencyKey: "migration-manual-run",
            requestFingerprint: "b".repeat(64),
            requestedByIdentityId: identityId,
          }),
      );
      await assert.rejects(
        withTenantContext(
          application,
          {
            source: "http",
            organizationId,
            unitId,
            actorIdentityId: identityId,
          },
          (tx) =>
            tx
              .update(doseClubReconciliationRuns)
              .set({ status: "running", version: 2, startedAt: new Date() })
              .where(eq(doseClubReconciliationRuns.id, manualRunId)),
        ),
        (error: unknown) =>
          (error as { cause?: { message?: string } }).cause?.message ===
          "DOSECLUB_RECONCILIATION_RUN_APP_TRANSITION_INVALID",
      );
      await withWorkerContext(application, (tx) =>
        tx
          .update(doseClubReconciliationRuns)
          .set({
            status: "failed",
            failureCode: "SCAN_FAILED",
            completedAt: new Date(),
            version: 2,
          })
          .where(eq(doseClubReconciliationRuns.id, manualRunId)),
      );
      const retried = await withTenantContext(
        application,
        {
          source: "http",
          organizationId,
          unitId,
          actorIdentityId: identityId,
        },
        (tx) =>
          tx
            .update(doseClubReconciliationRuns)
            .set({
              status: "pending",
              failureCode: null,
              startedAt: null,
              completedAt: null,
              version: 3,
            })
            .where(eq(doseClubReconciliationRuns.id, manualRunId))
            .returning({ status: doseClubReconciliationRuns.status }),
      );
      assert.equal(retried[0]?.status, "pending");
      await assert.rejects(
        withTenantContext(
          application,
          {
            source: "http",
            organizationId,
            unitId,
            actorIdentityId: identityId,
          },
          (tx) =>
            tx.insert(doseClubReconciliationFindings).values({
              organizationId,
              unitId,
              lastRunId: runId,
              fingerprint: "a".repeat(64),
              kind: "missing_mapping",
              severity: "critical",
              entityType: "product",
              entityId: "product",
              summary: "not allowed from app",
            }),
        ),
        (error: unknown) => {
          const cause = (error as { cause?: { code?: string } }).cause;
          return cause?.code === "42501";
        },
      );
      const workerRows = await withWorkerContext(application, (tx) =>
        tx
          .select()
          .from(doseClubReconciliationRuns)
          .where(eq(doseClubReconciliationRuns.status, "pending")),
      );
      assert.equal(workerRows.length, 3);
      const races = await Promise.allSettled([
        database.client`
          insert into doseclub_reconciliation_runs (
            organization_id, unit_id, run_date, trigger, status
          ) values (${organizationId}, ${unitId}, current_date, 'scheduled', 'pending')
        `,
        database.client`
          insert into doseclub_reconciliation_runs (
            organization_id, unit_id, run_date, trigger, status
          ) values (${organizationId}, ${unitId}, current_date, 'scheduled', 'pending')
        `,
      ]);
      assert.equal(
        races.every((result) => result.status === "rejected"),
        true,
      );
      await assert.rejects(
        database.client`
          update doseclub_reconciliation_runs
          set status = 'running', version = version + 2
          where id = ${runId}
        `,
        /DOSECLUB_RECONCILIATION_RUN_VERSION_INVALID/,
      );
    } finally {
      await application?.client.end();
      await database?.client.end();
      await admin.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
      );
      await admin.unsafe(`drop database if exists "${databaseName}"`);
      await admin.unsafe(`drop role if exists "${loginRole}"`);
      await admin.end();
    }
  });
});
