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

describe("0026 DoseClub receiver upgrade", () => {
  it("preserves the existing tenant and installs forced-RLS least-privilege storage", async (context) => {
    if (!integrationUrl) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }
    const databaseName = `giromesa_doseclub_upgrade_${randomUUID().replaceAll("-", "")}`;
    const admin = createDatabase(integrationUrl).client;
    const databaseUrl = new URL(integrationUrl);
    databaseUrl.pathname = `/${databaseName}`;
    let upgrade: ReturnType<typeof createDatabase> | undefined;
    try {
      await admin.unsafe(`create database "${databaseName}"`);
      upgrade = createDatabase(databaseUrl.toString(), { max: 1 });
      const baselineMigrations = (await readdir(migrationsDirectory))
        .filter((file) => /^00(?:0[0-9]|1[0-9]|2[0-5])_.*\.sql$/.test(file))
        .sort();
      assert.equal(baselineMigrations.at(-1)?.startsWith("0025_"), true);
      for (const file of baselineMigrations) await applyMigration(upgrade.client, file);

      const organizationId = randomUUID();
      const unitId = randomUUID();
      await upgrade.client`
        insert into organizations (id, legal_name, trade_name, document)
        values (${organizationId}, 'Upgrade Test Ltda', 'Upgrade Test', '11222333000181')
      `;
      await upgrade.client`
        insert into units (id, organization_id, name)
        values (${unitId}, ${organizationId}, 'Existing Unit')
      `;

      await applyMigration(upgrade.client, "0026_doseclub_integration.sql");
      const [result] = await upgrade.client<
        {
          existing_units: number;
          receiver_tables: number;
          forced_tables: number;
          app_can_update_operations: boolean;
          app_can_delete_operations: boolean;
          internal_can_execute_scope: boolean;
          public_can_execute_scope: boolean;
        }[]
      >`
        select
          (select count(*)::int from units where id = ${unitId}) as existing_units,
          (select count(*)::int from pg_class where oid in (
            'doseclub_product_mappings'::regclass,
            'doseclub_states'::regclass,
            'doseclub_operations'::regclass
          )) as receiver_tables,
          (select count(*)::int from pg_class where oid in (
            'doseclub_product_mappings'::regclass,
            'doseclub_states'::regclass,
            'doseclub_operations'::regclass
          ) and relrowsecurity and relforcerowsecurity) as forced_tables,
          has_table_privilege('giromesa_app', 'doseclub_operations', 'UPDATE')
            as app_can_update_operations,
          has_table_privilege('giromesa_app', 'doseclub_operations', 'DELETE')
            as app_can_delete_operations,
          has_function_privilege(
            'giromesa_internal',
            'giromesa_doseclub_scope(text,text,text)',
            'EXECUTE'
          ) as internal_can_execute_scope,
          has_function_privilege(
            'public',
            'giromesa_doseclub_scope(text,text,text)',
            'EXECUTE'
          ) as public_can_execute_scope
      `;
      assert.deepEqual(result, {
        existing_units: 1,
        receiver_tables: 3,
        forced_tables: 3,
        app_can_update_operations: false,
        app_can_delete_operations: false,
        internal_can_execute_scope: true,
        public_can_execute_scope: false,
      });
    } finally {
      await upgrade?.client.end();
      await admin.unsafe(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
      );
      await admin.unsafe(`drop database if exists "${databaseName}"`);
      await admin.end();
    }
  });
});
