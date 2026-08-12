import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createDatabase } from "./index.js";
import { DEMO_RESET_CONFIRMATION, resetDemoTenant } from "./seed.js";

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

async function readSnapshot(client: ReturnType<typeof createDatabase>["client"]) {
  const tables = [
    "service_areas",
    "service_shifts",
    "management_returnable_assets",
    "management_returnable_serials",
    "management_returnable_movements",
    "management_incidents",
    "management_incident_events",
    "financial_ledger_transactions",
    "financial_ledger_entries",
    "payment_terminals",
    "payment_intents",
    "payment_attempts",
    "payment_provider_events",
    "doseclub_product_mappings",
    "doseclub_states",
    "doseclub_operations",
  ] as const;
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const [row] = await client.unsafe<{ count: number }[]>(
      `select count(*)::int as count from ${table} where organization_id = '35000000-0001-4000-8000-000000000001'`,
    );
    counts[table] = row?.count ?? -1;
  }
  const states = await client<
    { kind: string; value: string; version: number }[]
  >`select 'shift' as kind, state::text as value, resource_version as version
      from service_shifts where organization_id = '35000000-0001-4000-8000-000000000001'
      union all
      select 'intent', status, version from payment_intents
      where organization_id = '35000000-0001-4000-8000-000000000001'
      union all
      select 'attempt', status, version from payment_attempts
      where organization_id = '35000000-0001-4000-8000-000000000001'
      order by kind, value, version`;
  return { counts, states };
}

test("final-schema demo reset is deterministic across two real PostgreSQL resets", async (context) => {
  if (!integrationUrl) {
    context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
    return;
  }
  const databaseName = `giromesa_task35_${randomUUID().replaceAll("-", "")}_demo`;
  const authority = createDatabase(integrationUrl, { max: 1 });
  const admin = authority.client;
  const databaseUrl = new URL(integrationUrl);
  databaseUrl.pathname = `/${databaseName}`;
  let database: ReturnType<typeof createDatabase> | undefined;
  try {
    const spoofedDemoUrl = new URL(integrationUrl);
    spoofedDemoUrl.pathname = "/giromesa_spoofed_demo";
    await assert.rejects(
      resetDemoTenant(authority.db, spoofedDemoUrl.toString(), DEMO_RESET_CONFIRMATION),
      /connected database must end with _demo/,
    );
    await admin.unsafe(`create database "${databaseName}"`);
    database = createDatabase(databaseUrl.toString(), { max: 1 });
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => /^\d{4}_.*\.sql$/.test(file))
      .sort();
    for (const file of migrationFiles) await applyMigration(database.client, file);

    await resetDemoTenant(database.db, databaseUrl.toString(), DEMO_RESET_CONFIRMATION);
    const first = await readSnapshot(database.client);
    await resetDemoTenant(database.db, databaseUrl.toString(), DEMO_RESET_CONFIRMATION);
    const second = await readSnapshot(database.client);

    assert.deepEqual(first, second);
    assert.deepEqual(first.counts, {
      service_areas: 3,
      service_shifts: 4,
      management_returnable_assets: 3,
      management_returnable_serials: 2,
      management_returnable_movements: 6,
      management_incidents: 2,
      management_incident_events: 2,
      financial_ledger_transactions: 3,
      financial_ledger_entries: 6,
      payment_terminals: 1,
      payment_intents: 3,
      payment_attempts: 3,
      payment_provider_events: 2,
      doseclub_product_mappings: 3,
      doseclub_states: 2,
      doseclub_operations: 0,
    });
    assert.deepEqual(
      first.states.filter((state) => state.kind === "intent"),
      [
        { kind: "intent", value: "paid", version: 2 },
        { kind: "intent", value: "pending", version: 1 },
        { kind: "intent", value: "pending", version: 1 },
      ],
    );
    const [disabledTrigger] = await database.client<{ count: number }[]>`
      select count(*)::int as count from pg_trigger
      where tgname in (
        'financial_ledger_transactions_immutable',
        'financial_ledger_entries_immutable',
        'payment_terminals_state_machine',
        'payment_intents_state_machine',
        'payment_attempts_state_machine',
        'management_returnable_movements_immutable',
        'management_incident_events_immutable',
        'doseclub_operations_immutable'
      ) and tgenabled <> 'O'
    `;
    assert.equal(disabledTrigger?.count, 0);
    const [integration] = await database.client<
      { credential_reference: string | null; status: string }[]
    >`select credential_reference, status from growth_integrations
      where organization_id = '35000000-0001-4000-8000-000000000001' and provider = 'doseclub'`;
    assert.deepEqual(integration, { credential_reference: null, status: "disabled" });
  } finally {
    if (database) await database.client.end();
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
    );
    await admin.unsafe(`drop database if exists "${databaseName}"`);
    await admin.end();
  }
});
