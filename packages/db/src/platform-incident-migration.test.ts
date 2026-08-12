import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

const migrationPath = [
  resolve(process.cwd(), "drizzle/0029_platform_incident_projection_actions.sql"),
  resolve(process.cwd(), "packages/db/drizzle/0029_platform_incident_projection_actions.sql"),
].find(existsSync);

if (!migrationPath) throw new Error("0029 platform incident migration not found");

describe("platform incident projection migration", () => {
  it("exposes only safe projection columns and a narrow command boundary", () => {
    const sql = readFileSync(migrationPath, "utf8");
    const platformGrant = sql.match(
      /GRANT SELECT \([^)]+\) ON public\.management_incidents TO giromesa_platform/i,
    )?.[0];
    assert.ok(platformGrant);
    assert.match(platformGrant, /\(\s*id, organization_id, unit_id, incident_type, status,/i);
    assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE).*management_incidents.*giromesa_platform/i);
    assert.doesNotMatch(platformGrant, /(?:evidence|idempotency_key|request_hash)/i);
    assert.match(
      sql,
      /CREATE OR REPLACE FUNCTION public\.giromesa_platform_transition_incident\(/i,
    );
    assert.match(
      sql,
      /GRANT EXECUTE ON FUNCTION public\.giromesa_platform_transition_incident\([^)]+\) TO giromesa_platform/i,
    );
    assert.match(sql, /pg_advisory_xact_lock/i);
    assert.match(sql, /FOR UPDATE/i);
    assert.match(sql, /incident transition is invalid/i);
    assert.match(sql, /incident requires an independent actor/i);
  });

  it("keeps global intake read-only, RLS-protected, and excludes support free text", () => {
    const sql = readFileSync(migrationPath, "utf8");
    for (const table of ["trial_applications", "contact_requests"]) {
      assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"));
      assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} FORCE ROW LEVEL SECURITY`, "i"));
      assert.match(
        sql,
        new RegExp(`CREATE POLICY giromesa_platform_global_select ON public\\.${table}`, "i"),
      );
      assert.doesNotMatch(
        sql,
        new RegExp(`GRANT (?:INSERT|UPDATE|DELETE).*${table}.*giromesa_platform`, "i"),
      );
    }
    assert.match(
      sql,
      /GRANT SELECT \(id, name, email, phone, consented_at, created_at\)\s+ON public\.contact_requests TO giromesa_platform/i,
    );
    assert.doesNotMatch(
      sql,
      /GRANT SELECT \([^)]*message[^)]*\) ON public\.contact_requests TO giromesa_platform/i,
    );
  });
});
