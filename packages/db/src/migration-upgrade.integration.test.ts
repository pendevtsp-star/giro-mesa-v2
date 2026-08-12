import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./index.js";

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

describe("0009 tenant RLS upgrade", () => {
  it("backfills only relationally valid historical outbox scopes", async (context) => {
    if (!integrationUrl) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }
    const databaseName = `giromesa_upgrade_${randomUUID().replaceAll("-", "")}`;
    const admin = createDatabase(integrationUrl).client;
    const databaseUrl = new URL(integrationUrl);
    databaseUrl.pathname = `/${databaseName}`;
    let database: ReturnType<typeof createDatabase> | undefined;
    try {
      await admin.unsafe(`create database "${databaseName}"`);
      database = createDatabase(databaseUrl.toString(), { max: 1 });
      const migrationFiles = (await readdir(migrationsDirectory))
        .filter((file) => /^000[0-8]_.*\.sql$/.test(file))
        .sort();
      assert.equal(migrationFiles.length, 9);
      for (const file of migrationFiles) await applyMigration(database.client, file);

      const organizationA = randomUUID();
      const organizationB = randomUUID();
      const unitA = randomUUID();
      const unitB = randomUUID();
      const staleOrganization = randomUUID();
      const staleUnit = randomUUID();
      const ids = {
        malformed: randomUUID(),
        mismatched: randomUUID(),
        staleOrganization: randomUUID(),
        staleUnit: randomUUID(),
        valid: randomUUID(),
      };
      await database.client`
        insert into organizations (id, legal_name, trade_name, document)
        values
          (${organizationA}, 'Upgrade A Ltda', 'Upgrade A', '10000000000001'),
          (${organizationB}, 'Upgrade B Ltda', 'Upgrade B', '10000000000002')
      `;
      await database.client`
        insert into units (id, organization_id, name)
        values (${unitA}, ${organizationA}, 'Unit A'), (${unitB}, ${organizationB}, 'Unit B')
      `;
      const historical = [
        { id: ids.valid, payload: { organizationId: organizationA, unitId: unitA } },
        {
          id: ids.staleOrganization,
          payload: { organizationId: staleOrganization, unitId: staleUnit },
        },
        { id: ids.staleUnit, payload: { organizationId: organizationA, unitId: staleUnit } },
        { id: ids.mismatched, payload: { organizationId: organizationA, unitId: unitB } },
        { id: ids.malformed, payload: { organizationId: "external", unitId: "not-a-uuid" } },
      ];
      for (const event of historical) {
        await database.client`
          insert into outbox_events (id, topic, aggregate_type, aggregate_id, payload)
          values (
            ${event.id}, 'historical.test', 'test', ${event.id},
            ${JSON.stringify(event.payload)}::jsonb
          )
        `;
      }

      await applyMigration(database.client, "0009_tenant_rls_and_event_foundation.sql");
      const rows = await database.client<
        { id: string; organization_id: string | null; unit_id: string | null }[]
      >`
        select id, organization_id, unit_id from outbox_events order by id
      `;
      const byId = new Map(rows.map((row) => [row.id, row]));
      assert.deepEqual(byId.get(ids.valid), {
        id: ids.valid,
        organization_id: organizationA,
        unit_id: unitA,
      });
      assert.equal(byId.get(ids.staleOrganization)?.organization_id, null);
      assert.equal(byId.get(ids.staleOrganization)?.unit_id, null);
      assert.equal(byId.get(ids.staleUnit)?.organization_id, organizationA);
      assert.equal(byId.get(ids.staleUnit)?.unit_id, null);
      assert.equal(byId.get(ids.mismatched)?.organization_id, organizationA);
      assert.equal(byId.get(ids.mismatched)?.unit_id, null);
      assert.equal(byId.get(ids.malformed)?.organization_id, null);
      assert.equal(byId.get(ids.malformed)?.unit_id, null);

      const [metadata] = await database.client<
        { constraints: number; relforcerowsecurity: boolean; relrowsecurity: boolean }[]
      >`
        select tables.relrowsecurity, tables.relforcerowsecurity,
          (select count(*)::int from pg_constraint
           where conrelid = 'outbox_events'::regclass and contype = 'f') as constraints
        from pg_class as tables where tables.oid = 'outbox_events'::regclass
      `;
      assert.deepEqual(metadata, {
        constraints: 3,
        relforcerowsecurity: true,
        relrowsecurity: true,
      });
    } finally {
      if (database) await database.client.end();
      await admin.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
      );
      await admin.unsafe(`drop database if exists "${databaseName}"`);
      await admin.end();
    }
  });
});

describe("0018-0019 operations upgrade", () => {
  it("upgrades a 0017 database with RLS, column grants and state-machine guards", async (context) => {
    if (!integrationUrl) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }
    const databaseName = `giromesa_operations_upgrade_${randomUUID().replaceAll("-", "")}`;
    const admin = createDatabase(integrationUrl).client;
    const databaseUrl = new URL(integrationUrl);
    databaseUrl.pathname = `/${databaseName}`;
    let database: ReturnType<typeof createDatabase> | undefined;
    try {
      await admin.unsafe(`create database "${databaseName}"`);
      database = createDatabase(databaseUrl.toString(), { max: 1 });
      const baselineFiles = (await readdir(migrationsDirectory))
        .filter((file) => /^(?:000\d|001[0-7])_.*\.sql$/.test(file))
        .sort();
      assert.equal(baselineFiles.at(-1), "0017_public_menu_branding.sql");
      for (const file of baselineFiles) await applyMigration(database.client, file);

      await applyMigration(database.client, "0018_operational_map.sql");
      await applyMigration(database.client, "0019_dispatch_ledger.sql");

      const [metadata] = await database.client<
        {
          forced_rls: number;
          state_machine_triggers: number;
          table_update_grants: number;
          transition_column_grants: number;
        }[]
      >`
        select
          (select count(*)::int from pg_class
           where oid in (
             'table_occupancies'::regclass,
             'public_table_sessions'::regclass,
             'table_service_calls'::regclass,
             'dispatch_effects'::regclass,
             'dispatch_dead_letters'::regclass
           ) and relrowsecurity and relforcerowsecurity) forced_rls,
          (select count(*)::int from information_schema.triggers
           where trigger_name in (
             'table_occupancies_state_machine',
             'public_table_sessions_state_machine',
             'table_service_calls_state_machine',
             'dispatch_effects_state_machine',
             'dispatch_dead_letters_state_machine'
           )) state_machine_triggers,
          (select count(*)::int from (values
            (has_table_privilege('giromesa_app', 'table_occupancies', 'update')),
            (has_table_privilege('giromesa_app', 'public_table_sessions', 'update')),
            (has_table_privilege('giromesa_app', 'table_service_calls', 'update')),
            (has_table_privilege('giromesa_app', 'dispatch_effects', 'update')),
            (has_table_privilege('giromesa_app', 'dispatch_dead_letters', 'update'))
          ) as grants(allowed) where allowed) table_update_grants,
          (select count(*)::int from (values
            (has_column_privilege('giromesa_app', 'table_occupancies', 'state', 'update')),
            (has_column_privilege('giromesa_app', 'public_table_sessions', 'revoked_at', 'update')),
            (has_column_privilege('giromesa_app', 'table_service_calls', 'state', 'update')),
            (has_column_privilege('giromesa_app', 'dispatch_effects', 'state', 'update')),
            (has_column_privilege('giromesa_app', 'dispatch_dead_letters', 'resolved_at', 'update'))
          ) as grants(allowed) where allowed) transition_column_grants
      `;
      assert.deepEqual(metadata, {
        forced_rls: 5,
        state_machine_triggers: 5,
        table_update_grants: 0,
        transition_column_grants: 5,
      });
    } finally {
      if (database) await database.client.end();
      await admin.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
      );
      await admin.unsafe(`drop database if exists "${databaseName}"`);
      await admin.end();
    }
  });
});
