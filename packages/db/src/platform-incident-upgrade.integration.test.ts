import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { createDatabase } from "./index.js";

const integrationUrl = process.env.TENANT_ISOLATION_DATABASE_URL;
const migrationsDirectory = new URL("../../drizzle/", import.meta.url);

async function applyMigration(
  client: ReturnType<typeof createDatabase>["client"],
  file: string,
) {
  const source = await readFile(new URL(file, migrationsDirectory), "utf8");
  const statements = source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await client.begin(async (transaction) => {
    for (const statement of statements) await transaction.unsafe(statement);
  });
}

describe("0029 platform incident projection upgrade", () => {
  it("preserves intake/incidents and installs forced-RLS least-privilege boundaries", async (context) => {
    if (!integrationUrl) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }
    const databaseName = `giromesa_platform_0029_${randomUUID().replaceAll("-", "")}`;
    const admin = createDatabase(integrationUrl).client;
    const databaseUrl = new URL(integrationUrl);
    databaseUrl.pathname = `/${databaseName}`;
    let database: ReturnType<typeof createDatabase> | undefined;
    try {
      await admin.unsafe(`create database "${databaseName}"`);
      database = createDatabase(databaseUrl.toString(), { max: 2 });
      const baseline = (await readdir(migrationsDirectory))
        .filter((file) => /^00(?:0[0-9]|1[0-9]|2[0-8])_.*\.sql$/.test(file))
        .sort();
      assert.equal(baseline.at(-1), "0028_privacy_domain_processors.sql");
      for (const file of baseline) await applyMigration(database.client, file);

      const organizationId = randomUUID();
      const unitId = randomUUID();
      const reporterIdentityId = randomUUID();
      const incidentId = randomUUID();
      const leadId = randomUUID();
      const supportId = randomUUID();
      await database.client`
        insert into organizations (id, legal_name, trade_name, document)
        values (${organizationId}, 'Upgrade Platform Ltda', 'Upgrade Platform', ${organizationId.replaceAll("-", "").slice(0, 14)})
      `;
      await database.client`
        insert into units (id, organization_id, name) values (${unitId}, ${organizationId}, 'Matriz')
      `;
      await database.client`
        insert into identities (id, email, display_name, email_verified_at)
        values (${reporterIdentityId}, ${`reporter-${reporterIdentityId}@example.test`}, 'Reporter', now())
      `;
      await database.client`
        insert into trial_applications (
          id, name, email, phone, business_name, plan_slug, consented_at
        ) values (
          ${leadId}, 'Lead Preservado', 'lead@example.test', '+5511999999999',
          'Bar Upgrade', 'operacao', now()
        )
      `;
      await database.client`
        insert into contact_requests (id, name, email, phone, message, consented_at)
        values (
          ${supportId}, 'Suporte Preservado', 'support@example.test', '+5511888888888',
          'Mensagem preservada, mas nunca projetada.', now()
        )
      `;
      await database.client`
        insert into management_incidents (
          id, organization_id, unit_id, incident_type, neutral_summary,
          idempotency_key, request_hash, reporter_identity_id, occurred_at
        ) values (
          ${incidentId}, ${organizationId}, ${unitId}, 'inventory_variance',
          'Incidente preservado durante o upgrade.', 'platform-upgrade-incident',
          ${"a".repeat(64)}, ${reporterIdentityId}, now()
        )
      `;

      await applyMigration(database.client, "0029_platform_incident_projection_actions.sql");

      const [preserved] = await database.client<
        { leads: number; support: number; incidents: number }[]
      >`
        select
          (select count(*)::int from trial_applications where id = ${leadId}) leads,
          (select count(*)::int from contact_requests where id = ${supportId}) support,
          (select count(*)::int from management_incidents where id = ${incidentId}) incidents
      `;
      assert.deepEqual(preserved, { leads: 1, support: 1, incidents: 1 });
      const [security] = await database.client<
        {
          forcedTables: number;
          tableUpdate: boolean;
          safeRead: boolean;
          evidenceRead: boolean;
          commandExecute: boolean;
        }[]
      >`
        select
          (select count(*)::int from pg_class where oid in (
            'trial_applications'::regclass, 'contact_requests'::regclass
          ) and relrowsecurity and relforcerowsecurity) "forcedTables",
          has_table_privilege('giromesa_platform', 'management_incidents', 'UPDATE') "tableUpdate",
          has_column_privilege('giromesa_platform', 'management_incidents', 'neutral_summary', 'SELECT') "safeRead",
          has_column_privilege('giromesa_platform', 'management_incidents', 'evidence', 'SELECT') "evidenceRead",
          has_function_privilege(
            'giromesa_platform',
            'giromesa_platform_transition_incident(uuid,uuid,uuid,text,text,text,text,uuid)',
            'EXECUTE'
          ) "commandExecute"
      `;
      assert.deepEqual(security, {
        forcedTables: 2,
        tableUpdate: false,
        safeRead: true,
        evidenceRead: false,
        commandExecute: true,
      });
    } finally {
      if (database) await database.client.end();
      await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
      await admin.end();
    }
  });
});
