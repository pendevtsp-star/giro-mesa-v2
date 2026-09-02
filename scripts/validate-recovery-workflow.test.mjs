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

test("schema 0043 adopts the historical event and DoseClub objects", () => {
  const migration = readFileSync(migration43Path, "utf8");
  assert.match(migration, /typname = 'command_inbox_status'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "command_inbox"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "doseclub_operations"/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS "doseclub_states_updated_idx"/);
});

test("privileged recovery authorization binds the versioned evidence file", () => {
  const publish = readFileSync(publishPath, "utf8");
  const matrix = JSON.parse(readFileSync(recoveryMatrixPath, "utf8"));
  assert.equal(matrix.targetMigration, "0076_edge_hub_pairing");
  assert.equal(matrix.transitions.length, 7);
  const [
    transition,
    previousProductionTransition,
    currentProductionTransition,
    latestProductionTransition,
    previousAppTransition,
    appOnlyTransition,
    currentTargetTransition,
  ] = matrix.transitions;
  assert.equal(transition.appliedBefore, "0026_doseclub_integration");
  assert.equal(transition.appliedBeforeWhen, "1786493658116");
  assert.equal(transition.appliedAfter, matrix.targetMigration);
  assert.equal(transition.recoveryMigration, "0045_strong_pride");
  assert.equal(transition.recoveryArtifact, "git:5421cefb866576183119b265fcaa9f042745e591");
  assert.equal(transition.testedUpgrade, true);
  assert.equal(transition.evidence.path, "docs/evidence/recovery/5421ce-validation.json");
  assert.equal(
    transition.evidence.sha256,
    "sha256:2fe6505087b0a66fa2388c3a29b2ff425d905680ef6ced6cf8c15dce5f5ba9d0",
  );
  assert.equal(
    transition.evidence.workflowRun,
    "https://github.com/pendevtsp-star/giro-mesa-v2/actions/runs/32503278065",
  );
  assert.equal(transition.evidence.testReportDigest, transition.evidence.sha256);
  assert.equal(previousProductionTransition.appliedBefore, "0042_shallow_lenny_balinger");
  assert.equal(previousProductionTransition.appliedBeforeWhen, "1787029862431");
  assert.equal(previousProductionTransition.appliedAfter, matrix.targetMigration);
  assert.equal(previousProductionTransition.recoveryMigration, "0045_strong_pride");
  assert.equal(previousProductionTransition.recoveryArtifact, transition.recoveryArtifact);
  assert.equal(previousProductionTransition.testedUpgrade, true);
  assert.deepEqual(previousProductionTransition.evidence, transition.evidence);
  assert.equal(currentProductionTransition.appliedBefore, "0045_strong_pride");
  assert.equal(currentProductionTransition.appliedBeforeWhen, "1787256690924");
  assert.equal(currentProductionTransition.appliedAfter, matrix.targetMigration);
  assert.equal(currentProductionTransition.recoveryMigration, "0045_strong_pride");
  assert.equal(currentProductionTransition.recoveryArtifact, transition.recoveryArtifact);
  assert.equal(currentProductionTransition.testedUpgrade, true);
  assert.deepEqual(currentProductionTransition.evidence, transition.evidence);
  assert.equal(latestProductionTransition.appliedBefore, "0053_petite_trauma");
  assert.equal(latestProductionTransition.appliedBeforeWhen, "1787373316439");
  assert.equal(latestProductionTransition.appliedAfter, matrix.targetMigration);
  assert.equal(latestProductionTransition.recoveryMigration, "0045_strong_pride");
  assert.equal(latestProductionTransition.recoveryArtifact, transition.recoveryArtifact);
  assert.equal(latestProductionTransition.testedUpgrade, true);
  assert.deepEqual(latestProductionTransition.evidence, transition.evidence);
  assert.equal(previousAppTransition.appliedBefore, "0074_crm_operational_inbox");
  assert.equal(previousAppTransition.appliedBeforeWhen, "1787709600000");
  assert.equal(previousAppTransition.appliedAfter, matrix.targetMigration);
  assert.equal(previousAppTransition.recoveryMigration, "0045_strong_pride");
  assert.equal(previousAppTransition.recoveryArtifact, transition.recoveryArtifact);
  assert.equal(previousAppTransition.testedUpgrade, true);
  assert.deepEqual(previousAppTransition.evidence, transition.evidence);
  assert.equal(appOnlyTransition.appliedBefore, "0075_platform_staff_invitations");
  assert.equal(appOnlyTransition.appliedBeforeWhen, "1787796000000");
  assert.equal(appOnlyTransition.appliedAfter, matrix.targetMigration);
  assert.equal(appOnlyTransition.recoveryMigration, "0045_strong_pride");
  assert.equal(appOnlyTransition.recoveryArtifact, transition.recoveryArtifact);
  assert.equal(appOnlyTransition.testedUpgrade, true);
  assert.deepEqual(appOnlyTransition.evidence, transition.evidence);
  assert.equal(currentTargetTransition.appliedBefore, matrix.targetMigration);
  assert.equal(currentTargetTransition.appliedBeforeWhen, "1788307200000");
  assert.equal(currentTargetTransition.appliedAfter, matrix.targetMigration);
  assert.equal(currentTargetTransition.recoveryMigration, "0045_strong_pride");
  assert.equal(currentTargetTransition.recoveryArtifact, transition.recoveryArtifact);
  assert.equal(currentTargetTransition.testedUpgrade, true);
  assert.deepEqual(currentTargetTransition.evidence, transition.evidence);
  const evidence = JSON.parse(
    readFileSync(join(root, "docs", "evidence", "recovery", "5421ce-validation.json"), "utf8"),
  );
  assert.equal(evidence.targetMigration, "0045_strong_pride");
  assert.deepEqual(evidence.schemaLevels, [45]);
  assert.equal(evidence.runtime.schemaLevel, 45);
  for (const scriptPath of [entrypointPath, provenancePath]) {
    const script = readFileSync(scriptPath, "utf8");
    assert.match(script, /evidence\.get\("schemaLevels"\) == expected_levels/);
    assert.match(script, /"schemaLevel":(?:target_identity\[1\]|expected_levels\[1\])/);
  }
  assert.match(publish, /docs\/evidence\/recovery\//);
  assert.match(publish, /recovery evidence hash mismatch/);
  assert.match(publish, /exactly one recovery artifact and evidence are allowed/);
  assert.match(publish, /duplicate recovery source transition/);
  assert.doesNotMatch(publish, /len\(transitions\)!=1/);
});
