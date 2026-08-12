import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@giromesa/db";
import { DoseClubReconciliationWorker } from "./doseclub-reconciliation.js";

const integrationUrl =
  process.env.DOSECLUB_RECONCILIATION_DATABASE_URL ?? process.env.TENANT_ISOLATION_DATABASE_URL;
const migrationsDirectory = fileURLToPath(
  new URL("../../../packages/db/drizzle/", import.meta.url),
);

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

describe("DoseClub reconciliation worker concurrency", () => {
  it("treats migration 0026 as an explicit pre-reconciliation schema", async (context) => {
    if (!integrationUrl) {
      context.skip("DOSECLUB_RECONCILIATION_DATABASE_URL not configured");
      return;
    }
    const databaseName = `gm_recovery_doseclub_0026_${randomUUID().replaceAll("-", "")}`;
    const admin = createDatabase(integrationUrl).client;
    const databaseUrl = new URL(integrationUrl);
    databaseUrl.pathname = `/${databaseName}`;
    let database: ReturnType<typeof createDatabase> | undefined;
    try {
      await admin.unsafe(`create database "${databaseName}"`);
      database = createDatabase(databaseUrl.toString(), { max: 4 });
      const migrations = (await readdir(migrationsDirectory))
        .filter((file) => /^\d{4}_.*\.sql$/.test(file) && file <= "0026_doseclub_integration.sql")
        .sort();
      assert.equal(migrations.at(-1), "0026_doseclub_integration.sql");
      for (const file of migrations) await applyMigration(database.client, file);

      const worker = new DoseClubReconciliationWorker(database, "worker-0026");
      assert.equal(await worker.runOnce(), 0);
    } finally {
      await database?.client.end();
      await admin.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
      );
      await admin.unsafe(`drop database if exists "${databaseName}"`);
      await admin.end();
    }
  });

  it("schedules once, claims with SKIP LOCKED and reclaims an expired lease", async (context) => {
    if (!integrationUrl) {
      context.skip("DOSECLUB_RECONCILIATION_DATABASE_URL not configured");
      return;
    }
    const databaseName = `gm_recovery_doseclub_${randomUUID().replaceAll("-", "")}`;
    const admin = createDatabase(integrationUrl).client;
    const databaseUrl = new URL(integrationUrl);
    databaseUrl.pathname = `/${databaseName}`;
    let database: ReturnType<typeof createDatabase> | undefined;
    try {
      await admin.unsafe(`create database "${databaseName}"`);
      database = createDatabase(databaseUrl.toString(), { max: 8 });
      const migrations = (await readdir(migrationsDirectory))
        .filter((file) => /^\d{4}_.*\.sql$/.test(file))
        .sort();
      assert.equal(migrations.at(-1), "0029_platform_incident_projection_actions.sql");
      for (const file of migrations) await applyMigration(database.client, file);

      const organizationId = randomUUID();
      const unitId = randomUUID();
      await database.client`
        insert into organizations (id, legal_name, trade_name, document)
        values (${organizationId}, 'Recovery Reconciliation Ltda', 'Recovery Reconciliation', '33444555000181')
      `;
      await database.client`
        insert into units (id, organization_id, name)
        values (${unitId}, ${organizationId}, 'Recovery Unit')
      `;
      await database.client`
        insert into growth_integrations (organization_id, unit_id, provider, status, config)
        values (${organizationId}, ${unitId}, 'doseclub', 'active', ${JSON.stringify({ branchId: "recovery-unit" })}::jsonb)
      `;

      const now = new Date("2026-08-12T12:00:00.000Z");
      const workerA = new DoseClubReconciliationWorker(database, "worker-a", () => now);
      const workerB = new DoseClubReconciliationWorker(database, "worker-b", () => now);
      const concurrent = await Promise.all([workerA.runOnce(), workerB.runOnce()]);
      assert.equal(
        concurrent.reduce((total, value) => total + value, 0),
        1,
      );
      const [scheduled] = await database.client<{ status: string; finding_count: number }[]>`
        select status, finding_count from doseclub_reconciliation_runs
        where organization_id = ${organizationId} and unit_id = ${unitId}
      `;
      assert.deepEqual(scheduled, { status: "completed", finding_count: 0 });

      const expiredRunId = randomUUID();
      await database.client`
        insert into doseclub_reconciliation_runs (
          id, organization_id, unit_id, run_date, trigger, status,
          lease_owner, lease_until, version, started_at
        ) values (
          ${expiredRunId}, ${organizationId}, ${unitId}, current_date, 'manual', 'running',
          'crashed-worker', ${new Date(now.getTime() - 60_000).toISOString()}::timestamptz,
          2, ${new Date(now.getTime() - 120_000).toISOString()}::timestamptz
        )
      `;
      assert.equal(await workerB.runOnce(), 1);
      const [reclaimed] = await database.client<
        { status: string; lease_owner: string | null; version: number }[]
      >`
        select status, lease_owner, version from doseclub_reconciliation_runs
        where id = ${expiredRunId}
      `;
      assert.deepEqual(reclaimed, { status: "completed", lease_owner: null, version: 4 });

      const failedRunId = randomUUID();
      await database.client`
        insert into doseclub_reconciliation_runs (
          id, organization_id, unit_id, run_date, trigger, status
        ) values (
          ${failedRunId}, ${organizationId}, ${unitId}, current_date, 'manual', 'pending'
        )
      `;
      await database.client.unsafe("drop table public.doseclub_states cascade");
      await assert.rejects(workerA.runOnce(), /doseclub_states/);
      const [failed] = await database.client<{ status: string; failure_code: string }[]>`
        select status, failure_code from doseclub_reconciliation_runs where id = ${failedRunId}
      `;
      assert.deepEqual(failed, { status: "failed", failure_code: "SCAN_FAILED" });
    } finally {
      await database?.client.end();
      await admin.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
      );
      await admin.unsafe(`drop database if exists "${databaseName}"`);
      await admin.end();
    }
  });
});
