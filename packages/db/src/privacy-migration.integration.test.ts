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

describe("0025 privacy lifecycle upgrade", () => {
  it("preserves existing sessions and adds forced-RLS privacy storage", async (context) => {
    if (!integrationUrl) {
      context.skip("TENANT_ISOLATION_DATABASE_URL not configured");
      return;
    }
    const databaseName = `giromesa_privacy_upgrade_${randomUUID().replaceAll("-", "")}`;
    const admin = createDatabase(integrationUrl).client;
    const databaseUrl = new URL(integrationUrl);
    databaseUrl.pathname = `/${databaseName}`;
    let upgrade: ReturnType<typeof createDatabase> | undefined;
    try {
      await admin.unsafe(`create database "${databaseName}"`);
      upgrade = createDatabase(databaseUrl.toString(), { max: 1 });
      const baselineMigrations = (await readdir(migrationsDirectory))
        .filter((file) => /^(000[0-9]|001[0-6])_.*\.sql$/.test(file))
        .sort();
      for (const file of baselineMigrations) await applyMigration(upgrade.client, file);
      const identityId = randomUUID();
      const sessionId = randomUUID();
      await upgrade.client`
        insert into identities (id, email, display_name, email_verified_at)
        values (${identityId}, ${`${identityId}@example.test`}, 'Existing Subject', now())
      `;
      await upgrade.client`
        insert into auth_sessions (id, identity_id, token_hash, expires_at)
        values (${sessionId}, ${identityId}, ${"c".repeat(64)}, now() + interval '1 hour')
      `;

      await applyMigration(upgrade.client, "0025_privacy_lifecycle.sql");
      const [result] = await upgrade.client<
        {
          session_count: number;
          mfa_verified_at: Date | null;
          privacy_tables: number;
          forced_tables: number;
        }[]
      >`
        select
          (select count(*)::int from auth_sessions where id = ${sessionId}) as session_count,
          (select mfa_verified_at from auth_sessions where id = ${sessionId}) as mfa_verified_at,
          (select count(*)::int from pg_class where oid in (
            'privacy_requests'::regclass, 'privacy_request_steps'::regclass,
            'privacy_exports'::regclass
          )) as privacy_tables,
          (select count(*)::int from pg_class where oid in (
            'privacy_requests'::regclass, 'privacy_request_steps'::regclass,
            'privacy_exports'::regclass
          ) and relrowsecurity and relforcerowsecurity) as forced_tables
      `;
      assert.deepEqual(result, {
        session_count: 1,
        mfa_verified_at: null,
        privacy_tables: 3,
        forced_tables: 3,
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
