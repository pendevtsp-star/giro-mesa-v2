import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const workflowPath = join(root, ".github", "workflows", "validate-recovery.yml");
const publishPath = join(root, ".github", "workflows", "publish-images.yml");
const validatorPath = join(root, "scripts", "validate-recovery-candidate.sh");
const recoveryMatrixPath = join(root, "deploy", "vps", "recovery-compatibility.json");

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
  assert.match(script, /for level in 45/);
  assert.match(script, /DATABASE_URL=.*pnpm db:migrate/);
  assert.match(script, /APP=api/);
  assert.match(script, /APP=worker/);
  assert.match(script, /"doseClubReconciliation":\s*"legacy-source-upgraded"/);
  assert.match(script, /run_legacy_upgrade_matrix 16/);
  assert.match(script, /run_legacy_upgrade_matrix 17/);
  assert.match(script, /entry\.get\("idx", -1\) >= 26/);
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

test("privileged recovery authorization binds the versioned evidence file", () => {
  const publish = readFileSync(publishPath, "utf8");
  const matrix = JSON.parse(readFileSync(recoveryMatrixPath, "utf8"));
  assert.equal(matrix.targetMigration, "0042_shallow_lenny_balinger");
  assert.equal(matrix.transitions.length, 1);
  const [transition] = matrix.transitions;
  assert.equal(transition.appliedBefore, "0026_doseclub_integration");
  assert.equal(transition.appliedBeforeWhen, "1786493658116");
  assert.equal(transition.appliedAfter, matrix.targetMigration);
  assert.equal(transition.recoveryMigration, matrix.targetMigration);
  assert.equal(transition.recoveryArtifact, "git:179dcd2901e012ccda7be987828db1b72bb87942");
  assert.equal(transition.testedUpgrade, true);
  assert.equal(transition.evidence.path, "docs/evidence/recovery/179dcd-validation.json");
  assert.equal(
    transition.evidence.sha256,
    "sha256:596dd8a09e3656a1899596c55378c0f6331aaea62e476e382e4dfe0175c745d0",
  );
  assert.equal(
    transition.evidence.workflowRun,
    "https://github.com/pendevtsp-star/giro-mesa-v2/actions/runs/32295634301",
  );
  assert.equal(transition.evidence.testReportDigest, transition.evidence.sha256);
  const evidence = readFileSync(
    join(root, "docs", "evidence", "recovery", "179dcd-validation.json"),
    "utf8",
  );
  assert.equal(JSON.parse(evidence).targetMigration, "0042_shallow_lenny_balinger");
  assert.match(publish, /docs\/evidence\/recovery\//);
  assert.match(publish, /recovery evidence hash mismatch/);
});
