import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type postgres from "postgres";
import { createDatabase } from "./index.js";

const integrationUrl =
  process.env.FINANCE_DATABASE_URL ?? process.env.TENANT_ISOLATION_DATABASE_URL;
const migrationsDirectory = fileURLToPath(new URL("../../drizzle/", import.meta.url));

type Database = ReturnType<typeof createDatabase>;
type SqlTransaction = postgres.TransactionSql;

async function applyMigration(client: Database["client"], file: string) {
  const source = await readFile(`${migrationsDirectory}${file}`, "utf8");
  const statements = source
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  await client.begin(async (transaction) => {
    for (const statement of statements) await transaction.unsafe(statement);
  });
}

function postgresError(expectedCode: string) {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === expectedCode;
}

async function asApplication<T>(
  database: Database,
  scope: { organizationId: string; unitId: string; actorIdentityId: string },
  operation: (transaction: SqlTransaction) => Promise<T>,
) {
  return database.client.begin(async (transaction) => {
    await transaction.unsafe("set local role giromesa_app");
    await transaction.unsafe("select set_config('app.current_context_source', 'http', true)");
    await transaction.unsafe("select set_config('app.current_organization_id', $1, true)", [
      scope.organizationId,
    ]);
    await transaction.unsafe("select set_config('app.current_unit_id', $1, true)", [scope.unitId]);
    await transaction.unsafe("select set_config('app.current_actor_identity_id', $1, true)", [
      scope.actorIdentityId,
    ]);
    return operation(transaction);
  });
}

async function seedFinancialRows(database: Database) {
  const ids = {
    organization: randomUUID(),
    unit: randomUUID(),
    creator: randomUUID(),
    approver: randomUUID(),
    terminal: randomUUID(),
    intent: randomUUID(),
    attempt: randomUUID(),
    attemptForInvalidTransition: randomUUID(),
    ruleSet: randomUUID(),
    ruleVersion: randomUUID(),
    run: randomUUID(),
    runForInvalidTransition: randomUUID(),
    fiscal: randomUUID(),
    fiscalForInvalidTransition: randomUUID(),
  };
  await database.client`
    insert into organizations (id, legal_name, trade_name, document)
    values (${ids.organization}, 'Finance State Ltda', 'Finance State', '99000000000001')
  `;
  await database.client`
    insert into units (id, organization_id, name)
    values (${ids.unit}, ${ids.organization}, 'Finance Unit')
  `;
  await database.client`
    insert into identities (id, email, display_name)
    values
      (${ids.creator}, ${`finance-${ids.creator}@example.test`}, 'Finance Creator'),
      (${ids.approver}, ${`finance-${ids.approver}@example.test`}, 'Finance Approver')
  `;
  const memberships = await database.client<{ id: string; identity_id: string }[]>`
    insert into memberships (identity_id, organization_id, status)
    values
      (${ids.creator}, ${ids.organization}, 'active'),
      (${ids.approver}, ${ids.organization}, 'active')
    returning id, identity_id
  `;
  for (const membership of memberships) {
    await database.client`
      insert into role_bindings (membership_id, unit_id, role)
      values (${membership.id}, ${ids.unit}, 'owner')
    `;
  }
  await database.client`
    insert into payment_terminals
      (id, organization_id, unit_id, label, adapter, external_reference, capabilities)
    values
      (${ids.terminal}, ${ids.organization}, ${ids.unit}, 'Terminal 1', 'simulator',
       'terminal-provider-1', '["credit"]'::jsonb)
  `;
  await database.client`
    insert into payment_intents
      (id, organization_id, unit_id, source_type, source_id, amount_cents, idempotency_key, request_hash)
    values
      (${ids.intent}, ${ids.organization}, ${ids.unit}, 'sale', 'sale-1', 1000,
       'intent-key-1', repeat('a', 64))
  `;
  await database.client`
    insert into payment_attempts
      (id, organization_id, unit_id, intent_id, terminal_id, adapter, amount_cents, status,
       idempotency_key, request_hash)
    values
      (${ids.attempt}, ${ids.organization}, ${ids.unit}, ${ids.intent}, ${ids.terminal},
       'simulator', 400, 'processing', 'attempt-key-1', repeat('b', 64)),
      (${ids.attemptForInvalidTransition}, ${ids.organization}, ${ids.unit}, ${ids.intent},
       ${ids.terminal}, 'simulator', 300, 'processing', 'attempt-key-2', repeat('c', 64))
  `;
  await database.client`
    insert into remuneration_rule_sets
      (id, organization_id, unit_id, kind, name, idempotency_key, request_hash,
       created_by_identity_id)
    values
      (${ids.ruleSet}, ${ids.organization}, ${ids.unit}, 'service', 'Service rule',
       'rule-set-key-1', repeat('d', 64), ${ids.creator})
  `;
  await database.client`
    insert into remuneration_rule_versions
      (id, organization_id, unit_id, rule_set_id, version, expression, effective_from,
       created_by_identity_id)
    values
      (${ids.ruleVersion}, ${ids.organization}, ${ids.unit}, ${ids.ruleSet}, 1,
       '{"type":"constant","value":100}'::jsonb, '2026-01-01T00:00:00Z', ${ids.creator})
  `;
  const frozenRule = JSON.stringify({ ruleSetId: ids.ruleSet, version: 1 });
  for (const [runId, key] of [
    [ids.run, "run-key-1"],
    [ids.runForInvalidTransition, "run-key-2"],
  ] as const) {
    await database.client`
      insert into remuneration_calculation_runs
        (id, organization_id, unit_id, kind, period_start, period_end, rule_version_id,
         frozen_rule, frozen_metrics, source_references, evaluation_trace, output_cents,
         memory_hash, idempotency_key, request_hash, created_by_identity_id)
      values
        (${runId}, ${ids.organization}, ${ids.unit}, 'service', '2026-01-01', '2026-01-31',
         ${ids.ruleVersion}, ${frozenRule}::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb,
         100, repeat('e', 64), ${key}, repeat('f', 64), ${ids.creator})
    `;
  }
  for (const [documentId, key] of [
    [ids.fiscal, "fiscal-key-1"],
    [ids.fiscalForInvalidTransition, "fiscal-key-2"],
  ] as const) {
    await database.client`
      insert into fiscal_documents
        (id, organization_id, unit_id, sale_reference, document_type, total_cents,
         document_payload, adapter, idempotency_key, request_hash, actor_identity_id)
      values
        (${documentId}, ${ids.organization}, ${ids.unit}, 'sale-1', 'nfce', 1000,
         '{"operation":"sale"}'::jsonb, 'simulator', ${key}, repeat('1', 64), ${ids.creator})
    `;
  }
  return ids;
}

async function assertFinancialGuards(database: Database) {
  const ids = await seedFinancialRows(database);
  const creatorScope = {
    organizationId: ids.organization,
    unitId: ids.unit,
    actorIdentityId: ids.creator,
  };
  const approverScope = { ...creatorScope, actorIdentityId: ids.approver };

  const [privileges] = await database.client<
    {
      fiscal_table_update: boolean;
      fiscal_status_update: boolean;
      fiscal_total_update: boolean;
      intent_amount_update: boolean;
      intent_status_update: boolean;
      intent_table_update: boolean;
      rule_set_table_update: boolean;
      rule_version_effective_until_update: boolean;
      rule_version_expression_update: boolean;
      run_output_update: boolean;
      run_status_update: boolean;
      terminal_table_update: boolean;
    }[]
  >`
    select
      has_table_privilege('giromesa_app', 'payment_terminals', 'update') terminal_table_update,
      has_table_privilege('giromesa_app', 'payment_intents', 'update') intent_table_update,
      has_column_privilege('giromesa_app', 'payment_intents', 'status', 'update') intent_status_update,
      has_column_privilege('giromesa_app', 'payment_intents', 'amount_cents', 'update') intent_amount_update,
      has_table_privilege('giromesa_app', 'remuneration_rule_sets', 'update') rule_set_table_update,
      has_column_privilege('giromesa_app', 'remuneration_rule_versions', 'effective_until', 'update') rule_version_effective_until_update,
      has_column_privilege('giromesa_app', 'remuneration_rule_versions', 'expression', 'update') rule_version_expression_update,
      has_column_privilege('giromesa_app', 'remuneration_calculation_runs', 'status', 'update') run_status_update,
      has_column_privilege('giromesa_app', 'remuneration_calculation_runs', 'output_cents', 'update') run_output_update,
      has_table_privilege('giromesa_app', 'fiscal_documents', 'update') fiscal_table_update,
      has_column_privilege('giromesa_app', 'fiscal_documents', 'status', 'update') fiscal_status_update,
      has_column_privilege('giromesa_app', 'fiscal_documents', 'total_cents', 'update') fiscal_total_update
  `;
  assert.deepEqual(privileges, {
    fiscal_table_update: false,
    fiscal_status_update: true,
    fiscal_total_update: false,
    intent_amount_update: false,
    intent_status_update: true,
    intent_table_update: false,
    rule_set_table_update: false,
    rule_version_effective_until_update: true,
    rule_version_expression_update: false,
    run_output_update: false,
    run_status_update: true,
    terminal_table_update: false,
  });

  for (const statement of [
    `insert into payment_terminals
       (organization_id, unit_id, label, adapter, status, capabilities)
     values ($1, $2, 'Forged revoked terminal', 'simulator', 'revoked', '[]'::jsonb)`,
    `insert into payment_intents
       (organization_id, unit_id, source_type, source_id, amount_cents, captured_cents,
        status, idempotency_key, request_hash)
     values ($1, $2, 'sale', 'forged-sale', 100, 100, 'paid',
             'forged-intent-key', repeat('2', 64))`,
    `insert into payment_attempts
       (organization_id, unit_id, intent_id, terminal_id, adapter, amount_cents, status,
        resolved_at, idempotency_key, request_hash)
     values ($1, $2, '${ids.intent}', '${ids.terminal}', 'simulator', 100, 'authorized',
             now(), 'forged-attempt-key', repeat('3', 64))`,
    `insert into remuneration_rule_versions
       (organization_id, unit_id, rule_set_id, version, expression, effective_from,
        effective_until, created_by_identity_id)
     values ($1, $2, '${ids.ruleSet}', 2, '{"type":"constant","value":1}'::jsonb,
             '2026-02-01', '2026-03-01', '${ids.creator}')`,
    `insert into remuneration_calculation_runs
       (organization_id, unit_id, kind, period_start, period_end, status, rule_version_id,
        frozen_rule, frozen_metrics, source_references, evaluation_trace, output_cents,
        memory_hash, idempotency_key, request_hash, created_by_identity_id,
        approved_by_identity_id, approved_at, closed_by_identity_id, closed_at)
     values ($1, $2, 'service', '2026-02-01', '2026-02-28', 'closed', '${ids.ruleVersion}',
             '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, 1,
             repeat('4', 64), 'forged-run-key', repeat('5', 64), '${ids.creator}',
             '${ids.approver}', now(), '${ids.creator}', now())`,
    `insert into fiscal_documents
       (organization_id, unit_id, sale_reference, document_type, total_cents,
        document_payload, status, adapter, document_reference, idempotency_key, request_hash,
        actor_identity_id, authorized_at)
     values ($1, $2, 'forged-sale', 'nfce', 100, '{}'::jsonb, 'authorized', 'simulator',
             'forged-document', 'forged-fiscal-key', repeat('6', 64), '${ids.creator}', now())`,
  ]) {
    await assert.rejects(
      () =>
        asApplication(database, creatorScope, (tx) =>
          tx.unsafe(statement, [ids.organization, ids.unit]),
        ),
      postgresError("55000"),
    );
  }

  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe("update payment_terminals set label = 'stolen' where id = $1", [ids.terminal]),
      ),
    postgresError("42501"),
  );
  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe("update payment_intents set amount_cents = 1 where id = $1", [ids.intent]),
      ),
    postgresError("42501"),
  );
  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe(
          "update payment_intents set status = 'paid', version = version + 1, updated_at = now() where id = $1",
          [ids.intent],
        ),
      ),
    postgresError("55000"),
  );
  await asApplication(database, creatorScope, (tx) =>
    tx.unsafe(
      "update payment_intents set captured_cents = 400, status = 'partially_paid', version = version + 1, updated_at = now() where id = $1",
      [ids.intent],
    ),
  );

  await asApplication(database, creatorScope, (tx) =>
    tx.unsafe(
      "update payment_attempts set status = 'unknown', provider_reference = 'provider-1', review_required = true, review_reason = 'TIMEOUT', version = version + 1, updated_at = now() where id = $1",
      [ids.attempt],
    ),
  );
  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe(
          "update payment_attempts set provider_reference = 'provider-2', version = version + 1, updated_at = now() where id = $1",
          [ids.attempt],
        ),
      ),
    postgresError("55000"),
  );
  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe(
          "update payment_attempts set status = 'created', version = version + 1, updated_at = now() where id = $1",
          [ids.attemptForInvalidTransition],
        ),
      ),
    postgresError("55000"),
  );
  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe("update payment_attempts set amount_cents = 1 where id = $1", [ids.attempt]),
      ),
    postgresError("42501"),
  );

  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe("update remuneration_rule_sets set name = 'changed' where id = $1", [
          ids.ruleSet,
        ]),
      ),
    postgresError("42501"),
  );
  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe("update remuneration_rule_versions set expression = '{}' where id = $1", [
          ids.ruleVersion,
        ]),
      ),
    postgresError("42501"),
  );
  await asApplication(database, creatorScope, (tx) =>
    tx.unsafe(
      "update remuneration_rule_versions set effective_until = '2026-02-01' where id = $1",
      [ids.ruleVersion],
    ),
  );
  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe("update remuneration_rule_versions set effective_until = null where id = $1", [
          ids.ruleVersion,
        ]),
      ),
    postgresError("55000"),
  );

  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe(
          "update remuneration_calculation_runs set status = 'closed', closed_by_identity_id = $2, closed_at = now(), updated_at = now() where id = $1",
          [ids.runForInvalidTransition, ids.creator],
        ),
      ),
    postgresError("55000"),
  );
  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe(
          "update remuneration_calculation_runs set status = 'approved', approved_by_identity_id = $2, approved_at = now(), updated_at = now() where id = $1",
          [ids.run, ids.creator],
        ),
      ),
    postgresError("55000"),
  );
  await asApplication(database, approverScope, (tx) =>
    tx.unsafe(
      "update remuneration_calculation_runs set status = 'approved', approved_by_identity_id = $2, approved_at = now(), updated_at = now() where id = $1",
      [ids.run, ids.approver],
    ),
  );
  await asApplication(database, creatorScope, (tx) =>
    tx.unsafe(
      "update remuneration_calculation_runs set status = 'closed', closed_by_identity_id = $2, closed_at = now(), updated_at = now() where id = $1",
      [ids.run, ids.creator],
    ),
  );
  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe("update remuneration_calculation_runs set output_cents = 1 where id = $1", [
          ids.run,
        ]),
      ),
    postgresError("42501"),
  );

  await assert.rejects(
    () =>
      asApplication(database, creatorScope, (tx) =>
        tx.unsafe(
          "update fiscal_documents set status = 'authorized', authorized_at = now(), version = version + 1, updated_at = now() where id = $1",
          [ids.fiscalForInvalidTransition],
        ),
      ),
    postgresError("55000"),
  );
  for (const statement of [
    "update fiscal_documents set total_cents = 1 where id = $1",
    "update fiscal_documents set document_payload = '{}' where id = $1",
    "update fiscal_documents set idempotency_key = 'reused' where id = $1",
    "update fiscal_documents set organization_id = gen_random_uuid() where id = $1",
  ]) {
    await assert.rejects(
      () => asApplication(database, creatorScope, (tx) => tx.unsafe(statement, [ids.fiscal])),
      postgresError("42501"),
    );
  }
  await asApplication(database, creatorScope, (tx) =>
    tx.unsafe(
      "update fiscal_documents set status = 'submitted', attempt_count = attempt_count + 1, version = version + 1, updated_at = now() where id = $1",
      [ids.fiscal],
    ),
  );
  await asApplication(database, creatorScope, (tx) =>
    tx.unsafe(
      "update fiscal_documents set document_reference = 'provider-document-1', last_error_code = 'PENDING', version = version + 1, updated_at = now() where id = $1",
      [ids.fiscal],
    ),
  );
  await asApplication(database, creatorScope, (tx) =>
    tx.unsafe(
      "update fiscal_documents set status = 'authorized', last_error_code = null, authorized_at = now(), version = version + 1, updated_at = now() where id = $1",
      [ids.fiscal],
    ),
  );
  await asApplication(database, creatorScope, (tx) =>
    tx.unsafe(
      "update fiscal_documents set status = 'cancelled', cancelled_at = now(), version = version + 1, updated_at = now() where id = $1",
      [ids.fiscal],
    ),
  );
}

async function withMigratedDatabase(
  mode: "fresh" | "upgrade",
  test: (database: Database) => Promise<void>,
) {
  if (!integrationUrl) return;
  const databaseName = `giromesa_finance_${mode}_${randomUUID().replaceAll("-", "")}`;
  const admin = createDatabase(integrationUrl).client;
  const databaseUrl = new URL(integrationUrl);
  databaseUrl.pathname = `/${databaseName}`;
  let database: Database | undefined;
  try {
    await admin.unsafe(`create database "${databaseName}"`);
    database = createDatabase(databaseUrl.toString(), { max: 1 });
    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => /^\d{4}_.*\.sql$/.test(file))
      .sort();
    const financeStart = migrationFiles.findIndex((file) => file.startsWith("0020_"));
    assert.notEqual(financeStart, -1);
    if (mode === "upgrade") {
      for (const file of migrationFiles.slice(0, financeStart)) {
        await applyMigration(database.client, file);
      }
      const [preFinanceTables] = await database.client<{ count: number }[]>`
        select count(*)::int count from information_schema.tables
        where table_schema = 'public' and table_name = 'payment_intents'
      `;
      assert.equal(preFinanceTables?.count, 0);
      for (const file of migrationFiles.slice(financeStart)) {
        await applyMigration(database.client, file);
      }
    } else {
      for (const file of migrationFiles) await applyMigration(database.client, file);
    }
    await test(database);
  } finally {
    if (database) await database.client.end();
    await admin.unsafe(
      `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${databaseName}'`,
    );
    await admin.unsafe(`drop database if exists "${databaseName}"`);
    await admin.end();
  }
}

describe("financial database state machines", () => {
  for (const mode of ["fresh", "upgrade"] as const) {
    it(`enforces least-privilege updates and immutable financial facts on ${mode}`, {
      timeout: 120_000,
    }, async (context) => {
      if (!integrationUrl) {
        context.skip("FINANCE_DATABASE_URL or TENANT_ISOLATION_DATABASE_URL not configured");
        return;
      }
      await withMigratedDatabase(mode, assertFinancialGuards);
    });
  }
});
