import assert from "node:assert/strict";
import { it } from "node:test";
import { createDatabase } from "./index.js";

it("keeps operational append-only tables least-privileged and hot paths indexed", async (context) => {
  const databaseUrl = process.env.OPERATIONS_SECURITY_DATABASE_URL;
  if (!databaseUrl) {
    context.skip("OPERATIONS_SECURITY_DATABASE_URL not configured");
    return;
  }
  const database = createDatabase(databaseUrl, { max: 1 });
  try {
    const [privileges] = await database.client<
      {
        attempts_update: boolean;
        calls_delete: boolean;
        calls_update: boolean;
        events_delete: boolean;
        events_update: boolean;
        nodes_delete: boolean;
        nodes_update: boolean;
        outcomes_update: boolean;
        receipts_update: boolean;
      }[]
    >`
      select
        has_table_privilege('giromesa_app', 'table_service_call_events', 'update') events_update,
        has_table_privilege('giromesa_app', 'table_service_call_events', 'delete') events_delete,
        has_table_privilege('giromesa_app', 'table_service_call_receipts', 'update') receipts_update,
        has_table_privilege('giromesa_app', 'table_service_calls', 'update') calls_update,
        has_table_privilege('giromesa_app', 'table_service_calls', 'delete') calls_delete,
        has_table_privilege('giromesa_app', 'table_layout_nodes', 'update') nodes_update,
        has_table_privilege('giromesa_app', 'table_layout_nodes', 'delete') nodes_delete,
        has_table_privilege('giromesa_app', 'dispatch_attempts', 'update') attempts_update,
        has_table_privilege('giromesa_app', 'dispatch_outcomes', 'update') outcomes_update
    `;
    assert.deepEqual(privileges, {
      attempts_update: false,
      calls_delete: false,
      calls_update: true,
      events_delete: false,
      events_update: false,
      nodes_delete: true,
      nodes_update: false,
      outcomes_update: false,
      receipts_update: false,
    });

    const indexes = await database.client<{ indexname: string }[]>`
      select indexname from pg_indexes
      where schemaname = 'public' and indexname in (
        'table_layout_versions_published_idx',
        'area_assignments_routing_idx',
        'staff_presence_leases_routing_idx',
        'table_service_calls_cooldown_idx',
        'dispatch_outcomes_effect_idx'
      )
    `;
    assert.equal(indexes.length, 5);

    await database.client.unsafe("set role giromesa_app");
    await assert.rejects(
      database.client.unsafe("update table_service_call_events set created_at = created_at where false"),
      /permission denied/i,
    );
    await database.client.unsafe("reset role");
  } finally {
    await database.client.end();
  }
});
