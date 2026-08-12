import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { createDatabase } from "./index.js";

const integrationUrl = process.env.ROLLBACK_0029_DATABASE_URL;
const migrationsDirectory = resolve(process.cwd(), "drizzle");

type Client = ReturnType<typeof createDatabase>["client"];

async function applyMigration(client: Client, file: string) {
  const source = await readFile(join(migrationsDirectory, file), "utf8");
  const statements = source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  try {
    await client.begin(async (transaction) => {
      for (const statement of statements) await transaction.unsafe(statement);
    });
  } catch (error) {
    throw new Error(`Migration ${file} failed`, { cause: error });
  }
}

async function migrationFiles() {
  return (await readdir(migrationsDirectory)).filter((file) => /^\d{4}_.*\.sql$/.test(file)).sort();
}

async function withEphemeralDatabase(prefix: string, work: (client: Client) => Promise<void>) {
  if (!integrationUrl) throw new Error("ROLLBACK_0029_DATABASE_URL is required");
  const databaseName = `giromesa_${prefix}_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(integrationUrl).client;
  const databaseUrl = new URL(integrationUrl);
  databaseUrl.pathname = `/${databaseName}`;
  let database: ReturnType<typeof createDatabase> | undefined;
  try {
    await admin.unsafe(`create database "${databaseName}"`);
    database = createDatabase(databaseUrl.toString(), { max: 1 });
    await work(database.client);
  } finally {
    if (database) await database.client.end();
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
    );
    await admin.unsafe(`drop database if exists "${databaseName}"`);
    await admin.end();
  }
}

async function assertLatestMigrationContract(client: Client) {
  const [metadata] = await client<
    {
      contact_forced_rls: boolean;
      incident_function: boolean;
      reconciliation_table: boolean;
      trial_forced_rls: boolean;
    }[]
  >`
    select
      (select relforcerowsecurity from pg_class where oid = 'public.trial_applications'::regclass)
        as trial_forced_rls,
      (select relforcerowsecurity from pg_class where oid = 'public.contact_requests'::regclass)
        as contact_forced_rls,
      to_regclass('public.doseclub_reconciliation_runs') is not null
        as reconciliation_table,
      to_regprocedure(
        'public.giromesa_platform_transition_incident(uuid,uuid,uuid,text,text,text,text,uuid)'
      ) is not null as incident_function
  `;
  assert.deepEqual(metadata, {
    contact_forced_rls: true,
    incident_function: true,
    reconciliation_table: true,
    trial_forced_rls: true,
  });
}

async function assertSchemaLevel(client: Client, level: 26 | 27 | 28 | 29) {
  const [metadata] = await client<
    {
      contact_forced_rls: boolean;
      incident_function: boolean;
      privacy_function: boolean;
      reconciliation_table: boolean;
      trial_forced_rls: boolean;
    }[]
  >`
    select
      (select relforcerowsecurity from pg_class where oid = 'public.trial_applications'::regclass)
        as trial_forced_rls,
      (select relforcerowsecurity from pg_class where oid = 'public.contact_requests'::regclass)
        as contact_forced_rls,
      to_regclass('public.doseclub_reconciliation_runs') is not null
        as reconciliation_table,
      to_regprocedure(
        'public.giromesa_privacy_export_domain(uuid,uuid,integer,character varying)'
      ) is not null as privacy_function,
      to_regprocedure(
        'public.giromesa_platform_transition_incident(uuid,uuid,uuid,text,text,text,text,uuid)'
      ) is not null as incident_function
  `;
  assert.deepEqual(
    metadata,
    {
      contact_forced_rls: level >= 29,
      incident_function: level >= 29,
      privacy_function: level >= 28,
      reconciliation_table: level >= 27,
      trial_forced_rls: level >= 29,
    },
    `schema level ${level} is not exact`,
  );
}

async function seedPublicCatalog(client: Client) {
  const catalogId = randomUUID();
  await client`
    insert into public.commercial_catalog_versions (
      id, version, status, published_at, created_at
    ) values (
      ${catalogId}, 20260812, 'published', now(), now()
    )
  `;
  await client`
    insert into public.commercial_plans (
      id, catalog_version_id, slug, name, monthly_price_cents,
      annual_price_cents, included_units, entitlements, created_at
    ) values (
      ${randomUUID()}, ${catalogId}, 'operacao', 'Operação', 14900,
      149000, 1, '["pilot"]'::jsonb, now()
    )
  `;
}

async function assertPublicCatalogReadable(client: Client) {
  const rows = await client.begin(async (transaction) => {
    await transaction.unsafe("set local role giromesa_public");
    return transaction.unsafe<{ plan_slug: string; version: number }[]>(`
      select plan.slug as plan_slug, catalog.version
      from public.commercial_catalog_versions catalog
      join public.commercial_plans plan on plan.catalog_version_id = catalog.id
      where catalog.status = 'published'
      order by catalog.version desc, plan.monthly_price_cents
    `);
  });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { plan_slug: "operacao", version: 20260812 });
}

async function assertPublicIntakeLeastPrivilege(client: Client) {
  const trialId = randomUUID();
  const contactId = randomUUID();
  const trialEventId = randomUUID();
  const contactEventId = randomUUID();
  const createdAt = new Date("2026-08-12T12:00:00.000Z");
  const createdAtIso = createdAt.toISOString();

  await assert.rejects(
    client.begin(async (transaction) => {
      await transaction.unsafe("set local role giromesa_public");
      await transaction.unsafe(
        `
        insert into public.trial_applications (
          id, name, email, phone, business_name, segment, plan_slug, consented_at, created_at
        ) values (
          $1, 'Legacy Returning', 'legacy@example.com', '11999999999',
          'Legacy Bar', 'Bar', 'operacao', $2, $2
        ) returning id
        `,
        [randomUUID(), createdAtIso],
      );
    }),
    /permission denied|row-level security/i,
  );

  await client.begin(async (transaction) => {
    await transaction.unsafe("set local role giromesa_public");
    await transaction.unsafe(
      `
      insert into public.trial_applications (
        id, name, email, phone, business_name, segment, plan_slug, consented_at, created_at
      ) values (
        $1, 'Rollback Trial', 'trial@example.com', '11999999999',
        'Rollback Bar', 'Bar', 'operacao', $2, $2
      )
      `,
      [trialId, createdAtIso],
    );
    await transaction.unsafe(
      `
      insert into public.outbox_events (
        id, topic, aggregate_type, aggregate_id, payload
      ) values (
        $1, 'trial.application_created', 'trial_application', $2, $3::jsonb
      )
      `,
      [trialEventId, trialId, JSON.stringify({ applicationId: trialId })],
    );
    await transaction.unsafe(
      `
      insert into public.contact_requests (
        id, name, email, phone, message, consented_at, created_at
      ) values (
        $1, 'Rollback Contact', 'contact@example.com', '11999999999',
        'Contato de compatibilidade', $2, $2
      )
      `,
      [contactId, createdAtIso],
    );
    await transaction.unsafe(
      `
      insert into public.outbox_events (
        id, topic, aggregate_type, aggregate_id, payload
      ) values (
        $1, 'contact.request_created', 'contact_request', $2, $3::jsonb
      )
      `,
      [contactEventId, contactId, JSON.stringify({ contactRequestId: contactId })],
    );
  });

  const [privileges] = await client<
    {
      contact_insert: boolean;
      contact_select: boolean;
      trial_insert: boolean;
      trial_select: boolean;
    }[]
  >`
    select
      has_table_privilege('giromesa_public', 'public.trial_applications', 'insert')
        as trial_insert,
      has_table_privilege('giromesa_public', 'public.trial_applications', 'select')
        as trial_select,
      has_table_privilege('giromesa_public', 'public.contact_requests', 'insert')
        as contact_insert,
      has_table_privilege('giromesa_public', 'public.contact_requests', 'select')
        as contact_select
  `;
  assert.deepEqual(privileges, {
    contact_insert: true,
    contact_select: false,
    trial_insert: true,
    trial_select: false,
  });

  const [persisted] = await client<{ contacts: number; events: number; trials: number }[]>`
    select
      (select count(*)::int from public.trial_applications where id = ${trialId}) as trials,
      (select count(*)::int from public.contact_requests where id = ${contactId}) as contacts,
      (select count(*)::int from public.outbox_events
        where id in (${trialEventId}, ${contactEventId})) as events
  `;
  assert.deepEqual(persisted, { contacts: 1, events: 2, trials: 1 });

  const processed = await client.begin(async (transaction) => {
    await transaction.unsafe("set local role giromesa_worker");
    const claimed = await transaction.unsafe<{ id: string }[]>(
      `
      update public.outbox_events
      set locked_at = now(), attempts = attempts + 1
      where id = any($1::uuid[]) and processed_at is null
      returning id
      `,
      [[trialEventId, contactEventId]],
    );
    await transaction.unsafe(
      `
      update public.outbox_events
      set processed_at = now(), locked_at = null, last_error = null
      where id = any($1::uuid[])
      `,
      [[trialEventId, contactEventId]],
    );
    return claimed.length;
  });
  assert.equal(processed, 2);
  const [outbox] = await client<{ processed: number }[]>`
    select count(*)::int as processed
    from public.outbox_events
    where id in (${trialEventId}, ${contactEventId})
      and processed_at is not null
      and locked_at is null
      and attempts = 1
  `;
  assert.deepEqual(outbox, { processed: 2 });
}

describe("rollback release compatible with schema 0029", () => {
  it("keeps pilot catalog and worker contracts valid at every partial recovery level", async (context) => {
    if (!integrationUrl) {
      context.skip("ROLLBACK_0029_DATABASE_URL not configured");
      return;
    }
    await withEphemeralDatabase("rollback_matrix", async (client) => {
      const files = await migrationFiles();
      for (const level of [26, 27, 28, 29] as const) {
        const pending = files.filter(
          (file) =>
            Number.parseInt(file.slice(0, 4), 10) <= level &&
            Number.parseInt(file.slice(0, 4), 10) > level - 1,
        );
        if (level === 26) {
          for (const file of files.filter((file) => Number.parseInt(file.slice(0, 4), 10) <= 26)) {
            await applyMigration(client, file);
          }
          await seedPublicCatalog(client);
        } else {
          assert.equal(pending.length, 1);
          await applyMigration(client, pending[0] as string);
        }
        await assertSchemaLevel(client, level);
        await assertPublicCatalogReadable(client);
        await assertPublicIntakeLeastPrivilege(client);
      }
    });
  });

  it("installs fresh through 0029 and preserves least-privilege public intake", async (context) => {
    if (!integrationUrl) {
      context.skip("ROLLBACK_0029_DATABASE_URL not configured");
      return;
    }
    await withEphemeralDatabase("rollback_fresh", async (client) => {
      const files = await migrationFiles();
      assert.equal(files.at(-1), "0029_platform_incident_projection_actions.sql");
      assert.equal(files.length, 29);
      for (const file of files) await applyMigration(client, file);
      await assertLatestMigrationContract(client);
      await assertPublicIntakeLeastPrivilege(client);
    });
  });

  it("upgrades a populated 0026 database to 0029 without losing pilot intake", async (context) => {
    if (!integrationUrl) {
      context.skip("ROLLBACK_0029_DATABASE_URL not configured");
      return;
    }
    await withEphemeralDatabase("rollback_upgrade", async (client) => {
      const files = await migrationFiles();
      const baseline = files.filter((file) => Number.parseInt(file.slice(0, 4), 10) <= 26);
      const compatibility = files.filter((file) => Number.parseInt(file.slice(0, 4), 10) >= 27);
      assert.equal(baseline.at(-1), "0026_doseclub_integration.sql");
      assert.deepEqual(compatibility, [
        "0027_doseclub_reconciliation.sql",
        "0028_privacy_domain_processors.sql",
        "0029_platform_incident_projection_actions.sql",
      ]);
      for (const file of baseline) await applyMigration(client, file);

      const historicalTrial = randomUUID();
      const historicalContact = randomUUID();
      await client`
        insert into public.trial_applications (
          id, name, email, phone, business_name, segment, plan_slug, consented_at
        ) values (
          ${historicalTrial}, 'Historical Trial', 'historical-trial@example.com',
          '11999999999', 'Historical Bar', 'Bar', 'operacao', now()
        )
      `;
      await client`
        insert into public.contact_requests (
          id, name, email, phone, message, consented_at
        ) values (
          ${historicalContact}, 'Historical Contact', 'historical-contact@example.com',
          '11999999999', 'Contato anterior ao upgrade', now()
        )
      `;

      for (const file of compatibility) await applyMigration(client, file);
      await assertLatestMigrationContract(client);
      const [historical] = await client<{ contacts: number; trials: number }[]>`
        select
          (select count(*)::int from public.trial_applications where id = ${historicalTrial})
            as trials,
          (select count(*)::int from public.contact_requests where id = ${historicalContact})
            as contacts
      `;
      assert.deepEqual(historical, { contacts: 1, trials: 1 });
      await assertPublicIntakeLeastPrivilege(client);
    });
  });
});
