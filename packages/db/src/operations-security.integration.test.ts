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
        calls_state_update: boolean;
        dead_letters_reason_update: boolean;
        dead_letters_resolved_update: boolean;
        effects_state_update: boolean;
        effects_update: boolean;
        events_delete: boolean;
        events_update: boolean;
        nodes_delete: boolean;
        nodes_update: boolean;
        occupancies_state_update: boolean;
        occupancies_update: boolean;
        outcomes_update: boolean;
        receipts_update: boolean;
        sessions_revoked_update: boolean;
        sessions_update: boolean;
      }[]
    >`
      select
        has_table_privilege('giromesa_app', 'table_service_call_events', 'update') events_update,
        has_table_privilege('giromesa_app', 'table_service_call_events', 'delete') events_delete,
        has_table_privilege('giromesa_app', 'table_service_call_receipts', 'update') receipts_update,
        has_table_privilege('giromesa_app', 'table_service_calls', 'update') calls_update,
        has_column_privilege('giromesa_app', 'table_service_calls', 'state', 'update') calls_state_update,
        has_table_privilege('giromesa_app', 'table_service_calls', 'delete') calls_delete,
        has_table_privilege('giromesa_app', 'table_occupancies', 'update') occupancies_update,
        has_column_privilege('giromesa_app', 'table_occupancies', 'state', 'update') occupancies_state_update,
        has_table_privilege('giromesa_app', 'public_table_sessions', 'update') sessions_update,
        has_column_privilege('giromesa_app', 'public_table_sessions', 'revoked_at', 'update') sessions_revoked_update,
        has_table_privilege('giromesa_app', 'table_layout_nodes', 'update') nodes_update,
        has_table_privilege('giromesa_app', 'table_layout_nodes', 'delete') nodes_delete,
        has_table_privilege('giromesa_app', 'dispatch_attempts', 'update') attempts_update,
        has_table_privilege('giromesa_app', 'dispatch_outcomes', 'update') outcomes_update,
        has_table_privilege('giromesa_app', 'dispatch_effects', 'update') effects_update,
        has_column_privilege('giromesa_app', 'dispatch_effects', 'state', 'update') effects_state_update,
        has_column_privilege('giromesa_app', 'dispatch_dead_letters', 'resolved_at', 'update') dead_letters_resolved_update,
        has_column_privilege('giromesa_app', 'dispatch_dead_letters', 'reason', 'update') dead_letters_reason_update
    `;
    assert.deepEqual(privileges, {
      attempts_update: false,
      calls_delete: false,
      calls_state_update: true,
      calls_update: false,
      dead_letters_reason_update: false,
      dead_letters_resolved_update: true,
      effects_state_update: true,
      effects_update: false,
      events_delete: false,
      events_update: false,
      nodes_delete: true,
      nodes_update: false,
      occupancies_state_update: true,
      occupancies_update: false,
      outcomes_update: false,
      receipts_update: false,
      sessions_revoked_update: true,
      sessions_update: false,
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

    const triggers = await database.client<{ trigger_name: string }[]>`
      select trigger_name from information_schema.triggers
      where event_object_schema = 'public' and trigger_name in (
        'table_occupancies_state_machine',
        'public_table_sessions_state_machine',
        'table_service_calls_state_machine',
        'dispatch_effects_state_machine',
        'dispatch_dead_letters_state_machine'
      )
    `;
    assert.equal(triggers.length, 5);

    await database.client.unsafe("set role giromesa_app");
    await assert.rejects(
      database.client.unsafe(
        "update table_service_call_events set created_at = created_at where false",
      ),
      /permission denied/i,
    );
    for (const statement of [
      "update table_occupancies set organization_id = organization_id where false",
      "update public_table_sessions set capabilities = capabilities where false",
      "update table_service_calls set kind = kind where false",
      "update dispatch_effects set effect_key = effect_key where false",
      "update dispatch_dead_letters set reason = reason where false",
    ]) {
      await assert.rejects(database.client.unsafe(statement), /permission denied/i);
    }
    await database.client.unsafe("reset role");
  } finally {
    await database.client.end();
  }
});
