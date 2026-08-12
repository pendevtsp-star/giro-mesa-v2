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

describe("0028 privacy domain processors", () => {
  it("exports only through the worker role and validates the durable request context", async (context) => {
    if (!integrationUrl) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }
    const databaseName = `giromesa_privacy_processors_${randomUUID().replaceAll("-", "")}`;
    const admin = createDatabase(integrationUrl).client;
    const databaseUrl = new URL(integrationUrl);
    databaseUrl.pathname = `/${databaseName}`;
    let database: ReturnType<typeof createDatabase> | undefined;
    try {
      await admin.unsafe(`create database "${databaseName}"`);
      database = createDatabase(databaseUrl.toString(), { max: 1 });
      const migrations = (await readdir(migrationsDirectory))
        .filter((file) => /^(00(?:0[0-9]|1[0-9]|2[0-6])|0028)_.*\.sql$/.test(file))
        .sort();
      for (const file of migrations) await applyMigration(database.client, file);

      const organizationId = randomUUID();
      const identityId = randomUUID();
      const requestId = randomUUID();
      await database.client`
        insert into organizations (id, legal_name, trade_name, document)
        values (${organizationId}, 'Privacy Processor Ltda', 'Privacy Processor', '99123456000190')
      `;
      await database.client`
        insert into identities (id, email, display_name, email_verified_at)
        values (${identityId}, ${`${identityId}@example.test`}, 'Privacy Processor Subject', now())
      `;
      await database.client`
        insert into privacy_requests (
          id, organization_id, subject_identity_id, requester_identity_id, type, state,
          idempotency_key, request_fingerprint, required_domains, attempts
        ) values (
          ${requestId}, ${organizationId}, ${identityId}, ${identityId}, 'access_export',
          'processing', ${`privacy-${requestId}`}, ${"a".repeat(64)},
          '["identity","organization_membership","operations","management_finance","growth_crm","objects_media","offline_edge","backups"]'::jsonb,
          1
        )
      `;

      const [privileges] = await database.client<
        { worker_execute: boolean; app_execute: boolean; helper_execute: boolean }[]
      >`
        select
          has_function_privilege('giromesa_worker', 'public.giromesa_privacy_export_domain(uuid,uuid,integer,varchar)', 'execute') as worker_execute,
          has_function_privilege('giromesa_app', 'public.giromesa_privacy_export_domain(uuid,uuid,integer,varchar)', 'execute') as app_execute,
          has_function_privilege('giromesa_worker', 'public.giromesa_privacy_reference_inventory(uuid,uuid,varchar)', 'execute') as helper_execute
      `;
      assert.deepEqual(privileges, {
        worker_execute: true,
        app_execute: false,
        helper_execute: false,
      });

      const backupExport = await database.client.begin(async (transaction) => {
        await transaction.unsafe("set local role giromesa_worker");
        const [row] = (await transaction.unsafe(
          "select public.giromesa_privacy_export_domain($1::uuid, $2::uuid, 1, 'backups') as payload",
          [organizationId, requestId],
        )) as unknown as Array<{ payload: { externalDeletionClaimed: boolean } }>;
        return row?.payload;
      });
      assert.equal(backupExport?.externalDeletionClaimed, false);

      await assert.rejects(
        () => {
          if (!database) throw new Error("database not initialized");
          return database.client.begin(async (transaction) => {
            await transaction.unsafe("set local role giromesa_worker");
            await transaction.unsafe(
              "select public.giromesa_privacy_export_domain($1::uuid, $2::uuid, 2, 'backups')",
              [organizationId, requestId],
            );
          });
        },
        (error: unknown) =>
          (error as { message?: string }).message?.includes(
            "PRIVACY_PROCESSING_CONTEXT_INVALID",
          ) === true,
      );
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
