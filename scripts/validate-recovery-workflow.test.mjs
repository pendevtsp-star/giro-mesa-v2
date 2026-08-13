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
  assert.match(script, /for level in 26 27 28 29/);
  assert.match(script, /ROLLBACK_0029_DATABASE_URL/);
  assert.match(script, /APP=api/);
  assert.match(script, /APP=worker/);
  assert.match(script, /doseclub\.integration\.test/);
  assert.match(script, /apps\/worker\/src\/doseclub-reconciliation\.ts/);
  assert.match(script, /DOSECLUB_RECONCILIATION_DATABASE_URL/);
  assert.match(script, /"doseClubReconciliation":\s*"passed"/);
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
  const evidence = matrix.transitions[0]?.evidence;
  assert.equal(evidence?.path, "docs/evidence/recovery/e73f407-validation.json");
  assert.equal(
    evidence?.sha256,
    "sha256:d3289e587f71d3145f00473606bf3cc82a47713a2782cbdf0ded039eee57bb0f",
  );
  assert.match(publish, /docs\/evidence\/recovery\//);
  assert.match(publish, /recovery evidence hash mismatch/);
});
