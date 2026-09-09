import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const workflowPath = join(root, ".github", "workflows", "validate-recovery.yml");
const publishPath = join(root, ".github", "workflows", "publish-images.yml");
const validatorPath = join(root, "scripts", "validate-recovery-candidate.sh");
const recoveryMatrixPath = join(root, "deploy", "vps", "recovery-compatibility.json");
const entrypointPath = join(root, "deploy", "vps", "deploy-entrypoint.sh");
const provenancePath = join(root, "deploy", "vps", "verify-image-provenance.sh");
const migration43Path = join(root, "packages", "db", "drizzle", "0043_tricky_diamondback.sql");
const migration61Path = join(
  root,
  "packages",
  "db",
  "drizzle",
  "0061_accountant_portal_security.sql",
);

test("manual recovery validation is non-privileged and bound to the default branch", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /workflow_dispatch:\s*[\s\S]*recovery_sha:\s*[\s\S]*required:\s*true/);
  assert.match(workflow, /if:\s*github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(workflow, /packages:\s*write|id-token:\s*write|secrets\./);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /ref:\s*\$\{\{ inputs\.recovery_sha \}\}/);
  assert.match(workflow, /path:\s*candidate/);
  assert.match(workflow, /bash\s+\.\/scripts\/validate-recovery-candidate\.sh/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.doesNotMatch(workflow, /cosign\s+sign|docker\/login-action|docker\/build-push-action/);
});

test("manual and privileged recovery gates execute the same validator", () => {
  const workflow = readFileSync(workflowPath, "utf8");
  const publish = readFileSync(publishPath, "utf8");
  const invocation =
    /bash\s+\.\/scripts\/validate-recovery-candidate\.sh[\s\S]*--candidate-directory[\s\\]+candidate[\s\S]*--recovery-sha/;
  assert.match(workflow, invocation);
  assert.match(publish, invocation);
  assert.doesNotMatch(publish, /Reprove recovery migrations on PostgreSQL 16 and 17/);
  assert.doesNotMatch(publish, /Reprove recovery API and worker runtime on PostgreSQL 17/);
});

test("shared validator proves the full database and runtime compatibility matrix", () => {
  const script = readFileSync(validatorPath, "utf8");
  assert.match(script, /postgres16/);
  assert.match(script, /postgres17/);
  assert.match(script, /for level in "\$recovery_level" "\$target_level"/);
  assert.match(script, /target_tag="\$\{target_identity\[0\]/);
  assert.match(script, /DATABASE_URL=.*pnpm db:migrate/);
  assert.match(script, /run_target_database_matrix 16/);
  assert.match(script, /run_target_database_matrix 17/);
  assert.match(script, /cd -- "\$trust_root"[\s\S]*DATABASE_URL=.*pnpm db:migrate/);
  assert.match(script, /cd -- "\$candidate_directory"[\s\S]*pnpm --filter @giromesa\/db test/);
  assert.match(script, /APP=api/);
  assert.match(script, /APP=worker/);
  assert.match(script, /"doseClubReconciliation":\s*"legacy-source-upgraded"/);
  assert.match(script, /run_legacy_upgrade_matrix 16/);
  assert.match(script, /run_legacy_upgrade_matrix 17/);
  assert.match(script, /entry\.get\("when", 0\) > 1786493658116/);
  assert.equal(script.match(/when="\$\{when%\$'\\r'\}"/g)?.length, 2);
  assert.match(script, /psql -1/);
  assert.match(script, /"runtime":\s*\{[\s\S]*"apiHealth":\s*"passed"/);
  assert.match(script, /"apiHealthByLevel"/);
  assert.match(script, /system\.worker_probe/);
  assert.match(script, /gitleaks:v8\.28\.0@sha256:[0-9a-f]{64}/);
  assert.match(script, /trivy:0\.69\.2@sha256:[0-9a-f]{64}/);
  assert.match(script, /recovery-validation\.json/);
  assert.match(script, /recovery-validation\.json\.sha256/);
  assert.match(script, /json\.dumps\(value, sort_keys=True, separators=\(",", ":"\)\)/);
});

test("fresh bootstrap does not use a newly-added enum value in the same transaction", () => {
  const migration = readFileSync(migration61Path, "utf8");
  assert.match(migration, /binding\."role"::text = 'accountant'/);
  assert.doesNotMatch(migration, /binding\."role" = 'accountant'/);
});

test("schema 0043 adopts the historical event and DoseClub objects", () => {
  const migration = readFileSync(migration43Path, "utf8");
  assert.match(migration, /typname = 'command_inbox_status'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "command_inbox"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "doseclub_operations"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "doseclub_states_updated_idx"/);
});

test("privileged recovery authorization binds the schema 80 evidence", () => {
  const publish = readFileSync(publishPath, "utf8");
  const matrix = JSON.parse(readFileSync(recoveryMatrixPath, "utf8"));
  assert.equal(matrix.targetMigration, "0080_campaign_attribution_cost");
  assert.equal(matrix.transitions.length, 11);
  const expectedEvidence = {
    path: "docs/evidence/recovery/07bb30f5-validation-0080.json",
    sha256: "sha256:e9ad6d0a98b34ae9fabf638b52f7484b7622575a5322bf089bf38bdc659020e7",
    workflowRun: "https://github.com/pendevtsp-star/giro-mesa-v2/actions/runs/34365691644",
    testReportDigest: "sha256:e9ad6d0a98b34ae9fabf638b52f7484b7622575a5322bf089bf38bdc659020e7",
  };
  for (const transition of matrix.transitions) {
    assert.equal(transition.appliedAfter, matrix.targetMigration);
    assert.equal(transition.recoveryMigration, "0077_people_multi_role_access");
    assert.equal(transition.recoveryArtifact, "git:07bb30f5362d30d950432e04cf32fe2a2e40ad16");
    assert.equal(transition.testedUpgrade, true);
    assert.deepEqual(transition.evidence, expectedEvidence);
  }
  const evidence = JSON.parse(readFileSync(join(root, expectedEvidence.path), "utf8"));
  assert.equal(evidence.targetMigration, matrix.targetMigration);
  assert.deepEqual(evidence.schemaLevels, [77, 80]);
  assert.equal(evidence.runtime.schemaLevel, 80);
  assert.equal(evidence.securityScan.gitleaks, "passed");
  assert.equal(evidence.securityScan.trivy, "passed");
  for (const scriptPath of [entrypointPath, provenancePath]) {
    const script = readFileSync(scriptPath, "utf8");
    assert.match(script, /evidence\.get\("schemaLevels"\) == expected_levels/);
    assert.match(script, /"schemaLevel":(?:target_identity\[1\]|expected_levels\[1\])/);
  }
  assert.match(publish, /docs\/evidence\/recovery\//);
  assert.match(publish, /recovery evidence hash mismatch/);
  assert.match(publish, /exactly one recovery artifact and evidence are allowed/);
  assert.match(publish, /duplicate recovery source transition/);
});
