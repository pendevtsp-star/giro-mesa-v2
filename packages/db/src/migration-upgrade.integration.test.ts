import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./index.js";

const integrationUrl = process.env.TENANT_ISOLATION_DATABASE_URL;
const migrationsDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));

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
