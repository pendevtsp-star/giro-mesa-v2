import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const backupScript = join(root, "scripts", "backup-production.sh");
const restoreScript = join(root, "scripts", "restore-drill.sh");
const ensureScript = join(root, "deploy", "vps", "ensure-runtime-env.sh");
const deployScript = join(root, "deploy", "vps", "deploy-pilot.sh");
const observabilityCompose = join(root, "deploy", "vps", "compose.observability.yaml");
const observabilityConfig = join(root, "infra", "observability", "otel-collector.debug.yaml");
const rollbackScript = join(root, "deploy", "vps", "rollback-app.sh");
const bootstrapScript = join(root, "deploy", "vps", "bootstrap-env.sh");
const pilotCompose = join(root, "deploy", "vps", "compose.pilot.yaml");
const imagesCompose = join(root, "deploy", "vps", "compose.images.yaml");
const trustedEntrypoint = join(root, "deploy", "vps", "deploy-entrypoint.sh");

test("Linux backup rejects incomplete, duplicate and forged runtime source sets before Docker", () => {
  const api = `ghcr.io/pendevtsp-star/giro-mesa-v2-api@sha256:${"a".repeat(64)}`;
  const worker = `ghcr.io/pendevtsp-star/giro-mesa-v2-worker@sha256:${"b".repeat(64)}`;
  const canonical = JSON.stringify([api, worker].sort());
  const validArtifact = `runtime-set:sha256:${createHash("sha256").update(canonical).digest("hex")}`;
  const base = [
    "--database-container",
    "never-run",
    "--database-name",
    "giromesa",
    "--database-user",
    "giromesa",
    "--output-directory",
    "/tmp/never-run",
    "--source-migration-id",
    "0029_test",
    "--target-artifact",
    `git:${"c".repeat(40)}`,
    "--target-migration-id",
    "0029_test",
  ];
  const cases = [
    [validArtifact, [api], "BACKUP_SOURCE_COMPONENTS_INVALID"],
    [validArtifact, [api, api], "BACKUP_SOURCE_COMPONENTS_INVALID"],
    [`runtime-set:sha256:${"f".repeat(64)}`, [worker, api], "BACKUP_SOURCE_RUNTIME_SET_MISMATCH"],
  ];
  for (const [artifact, images, expected] of cases) {
    const args = [posix(backupScript), ...base, "--source-artifact", artifact];
    for (const image of images) args.push("--source-component-image", image);
    const result = spawnSync(bash, args, {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, MSYS_NO_PATHCONV: "1" },
    });
    assert.notEqual(result.status, 0);
    assert.match(output(result), new RegExp(expected));
  }
});
const imageProvenance = join(root, "deploy", "vps", "verify-image-provenance.sh");
const imageLock = join(root, "deploy", "vps", "image-lock.json");
const buildkitValidator = join(root, "deploy", "vps", "validate-buildkit-attestations.py");
const compatibilityMatrix = join(root, "deploy", "vps", "rollback-compatibility.json");
const recoveryMatrix = join(root, "deploy", "vps", "recovery-compatibility.json");

function posix(path) {
  return path.replaceAll("\\", "/");
}

function run(script, args = [], environment = {}) {
  return spawnSync(bash, [posix(script), ...args.map(posix)], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, MSYS_NO_PATHCONV: "1", ...environment },
  });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function signedManifest(directory, payload, key) {
  const payloadBytes = Buffer.from(JSON.stringify(payload));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      signedPayloadBase64: payloadBytes.toString("base64"),
      hmacSha256: createHmac("sha256", key).update(payloadBytes).digest("hex"),
    }),
  );
}

test("Linux backup fails closed before Docker when the HMAC key is absent", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-linux-backup-negative-"));
  try {
    const result = run(
      backupScript,
      [
        "--database-container",
        "container-that-must-not-run",
        "--database-name",
        "giromesa",
        "--database-user",
        "giromesa",
        "--output-directory",
        directory,
        "--artifact",
        `git:${"1".repeat(40)}`,
        "--migration-id",
        "0029_platform_incident_projection_actions",
      ],
      { GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: "", PATH: process.env.PATH },
    );
    assert.notEqual(result.status, 0);
    assert.match(output(result), /MANIFEST_HMAC_KEY_REQUIRED/);
    assert.doesNotMatch(output(result), /container-that-must-not-run.*No such container/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Linux restore rejects a forged manifest before Docker", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-linux-restore-negative-"));
  try {
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 2, signedPayloadBase64: "e30=", hmacSha256: "0".repeat(64) }),
    );
    const result = run(
      restoreScript,
      [
        "--backup-directory",
        directory,
        "--target-database-container",
        "container-that-must-not-run",
        "--database-name",
        "giromesa",
        "--database-user",
        "giromesa",
        "--expected-artifact",
        `git:${"1".repeat(40)}`,
        "--expected-source-migration-id",
        "0029_platform_incident_projection_actions",
      ],
      { GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: Buffer.alloc(32, 9).toString("base64") },
    );
    assert.notEqual(result.status, 0);
    assert.match(output(result), /MANIFEST_SIGNATURE_INVALID/);
    assert.doesNotMatch(output(result), /container-that-must-not-run.*No such container/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Linux restore rejects signed path traversal before Docker", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-linux-restore-traversal-"));
  const key = Buffer.alloc(32, 19);
  try {
    signedManifest(
      directory,
      {
        schemaVersion: 2,
        backupId: "traversal",
        artifact: `git:${"1".repeat(40)}`,
        migrationId: "0029_platform_incident_projection_actions",
        coverage: {
          mode: "embedded",
          database: true,
          objects: true,
          encryptedConfiguration: true,
        },
        runtimeConfigurationHmacSha256: "0".repeat(64),
        sourceDatabaseContainer: "source-container",
        databaseName: "giromesa",
        declaredRpoMinutes: 5,
        files: [
          {
            path: "../database.dump",
            kind: "postgresql",
            bytes: 1,
            sha256: "0".repeat(64),
          },
        ],
      },
      key,
    );
    const result = run(
      restoreScript,
      [
        "--backup-directory",
        directory,
        "--target-database-container",
        "container-that-must-not-run",
        "--database-name",
        "giromesa",
        "--database-user",
        "giromesa",
        "--expected-artifact",
        `git:${"1".repeat(40)}`,
        "--expected-source-migration-id",
        "0029_platform_incident_projection_actions",
      ],
      { GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: key.toString("base64") },
    );
    assert.notEqual(result.status, 0);
    assert.match(output(result), /BACKUP_FILE_PATH_INVALID/);
    assert.doesNotMatch(output(result), /container-that-must-not-run.*No such container/i);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Linux restore publishes evidence atomically and rejects symlink destinations", () => {
  const restore = readFileSync(restoreScript, "utf8");
  assert.match(restore, /BACKUP_PATH_SYMLINK_FORBIDDEN/);
  assert.match(restore, /RESTORE_EVIDENCE_ALREADY_EXISTS/);
  assert.match(restore, /tempfile\.mkstemp/);
  assert.match(restore, /os\.replace\(temporary, destination\)/);
  assert.match(restore, /getattr\(os, "O_NOFOLLOW"/);
});

test("runtime env hardening preserves existing secrets and is byte-idempotent", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-runtime-env-"));
  const envFile = join(directory, ".env");
  const fingerprint = Buffer.alloc(32, 11).toString("base64");
  const existing = [
    'POSTGRES_PASSWORD="unchanged-postgres-secret"',
    "COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION=v7",
    `COMMAND_FINGERPRINT_KEYS={"v7":"${fingerprint}"}`,
    "",
  ].join("\n");
  writeFileSync(envFile, existing);
  const grants =
    "admin@example.com=platform.pii.read|platform.action.propose|platform.action.approve|platform.tenant.suspend";
  try {
    const first = run(ensureScript, [envFile], { PLATFORM_ADMIN_GRANTS_BOOTSTRAP: grants });
    assert.equal(first.status, 0, output(first));
    assert.doesNotMatch(output(first), /unchanged-postgres-secret|admin@example\.com|v7/);
    const afterFirst = readFileSync(envFile, "utf8");
    assert.match(afterFirst, /COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION=v7/);
    assert.match(afterFirst, new RegExp(fingerprint.replace(/[+]/g, "\\+")));
    assert.match(afterFirst, /^PRIVACY_EXPORT_ENCRYPTION_KEY=/m);
    assert.match(afterFirst, /^PUBLIC_TABLE_SESSION_SIGNING_KEY=/m);
    assert.match(afterFirst, /^GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64=/m);
    assert.match(afterFirst, /^PLATFORM_ADMIN_GRANTS=/m);

    const second = run(ensureScript, [envFile]);
    assert.equal(second.status, 0, output(second));
    assert.equal(readFileSync(envFile, "utf8"), afterFirst);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime env hardening keeps absent mutation grants in safe read-only mode", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-runtime-env-readonly-"));
  const envFile = join(directory, ".env");
  writeFileSync(
    envFile,
    'POSTGRES_PASSWORD="preserve-me"\nPLATFORM_ADMIN_EMAILS="admin@example.com"\n',
  );
  try {
    const result = run(ensureScript, [envFile], { PLATFORM_ADMIN_GRANTS_BOOTSTRAP: "" });
    assert.equal(result.status, 0, output(result));
    assert.doesNotMatch(readFileSync(envFile, "utf8"), /^PLATFORM_ADMIN_GRANTS=/m);
    assert.doesNotMatch(output(result), /preserve-me/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("runtime env accepts incident transition grant and rejects duplicate keys atomically", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-runtime-env-duplicates-"));
  const acceptedFile = join(directory, "accepted.env");
  const duplicatedFile = join(directory, "duplicated.env");
  writeFileSync(acceptedFile, "POSTGRES_PASSWORD=x\n");
  const grants = "admin@example.com=platform.incident.transition";
  try {
    const accepted = run(ensureScript, [acceptedFile], { PLATFORM_ADMIN_GRANTS_BOOTSTRAP: grants });
    assert.equal(accepted.status, 0, output(accepted));
    assert.match(readFileSync(acceptedFile, "utf8"), /platform\.incident\.transition/);

    writeFileSync(duplicatedFile, "POSTGRES_PASSWORD=first\nPOSTGRES_PASSWORD=second\n");
    const before = readFileSync(duplicatedFile, "utf8");
    const rejected = run(ensureScript, [duplicatedFile], {
      PLATFORM_ADMIN_GRANTS_BOOTSTRAP: grants,
    });
    assert.notEqual(rejected.status, 0);
    assert.match(output(rejected), /RUNTIME_ENV_DUPLICATE_KEY:POSTGRES_PASSWORD/);
    assert.equal(readFileSync(duplicatedFile, "utf8"), before);
    assert.doesNotMatch(output(rejected), /first|second/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bootstrap refuses to overwrite an existing env without explicit rotation", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-bootstrap-existing-"));
  const target = join(directory, ".env");
  const legacyA = join(directory, "legacy-a.env");
  const legacyB = join(directory, "legacy-b.env");
  writeFileSync(target, "PRESERVE=this-value\n");
  for (const legacy of [legacyA, legacyB]) {
    writeFileSync(
      legacy,
      "GOOGLE_OAUTH_CLIENT_ID=id\nGOOGLE_OAUTH_CLIENT_SECRET=secret\nRESEND_API_KEY=resend\n",
    );
  }
  try {
    const result = run(bootstrapScript, [target, legacyA, legacyB]);
    assert.notEqual(result.status, 0);
    assert.match(output(result), /BOOTSTRAP_ENV_EXISTS/);
    assert.equal(readFileSync(target, "utf8"), "PRESERVE=this-value\n");
    assert.doesNotMatch(output(result), /this-value|secret|resend/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deploy invokes the complete backup before migration and never snapshots clear env", () => {
  const deploy = readFileSync(deployScript, "utf8");
  const backupCall = deploy.indexOf('backup=$("$backup_script"');
  const migrationCall = deploy.indexOf("--profile tools run --rm migrate");
  const composeInvocation = '"$' + '{compose[@]}"';
  const pullCall = deploy.indexOf(`${composeInvocation} pull`);
  const postgresUpCall = deploy.indexOf(`${composeInvocation} up -d postgres`);
  assert.ok(backupCall >= 0, "deploy must invoke the complete Linux backup");
  assert.ok(migrationCall > backupCall, "backup must finish before migrations start");
  assert.ok(pullCall > backupCall, "backup must finish before pulling images");
  assert.ok(postgresUpCall > backupCall, "backup must finish before updating PostgreSQL");
  assert.doesNotMatch(deploy, /(?:cp|tar|gzip)[^\n]*(?:env_file|\.env)/i);
  assert.match(deploy, /GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64/);
  assert.match(deploy, /BACKUP_COMPLETE_COVERAGE_REQUIRED/);
  assert.doesNotMatch(deploy, /external-coverage-attestation|GIROMESA_BACKUP_COVERAGE_ATTESTATION/);
  assert.match(deploy, /--runtime-env-file\s+"\$env_file"/);
  assert.doesNotMatch(deploy, /"\$ensure_runtime_env"/);
  assert.match(deploy, /for service in api worker/);
  assert.match(deploy, /docker stop --timeout/);
});

test("local observability overlay is pinned and explicitly debug-only without durable storage", () => {
  const compose = readFileSync(observabilityCompose, "utf8");
  const config = readFileSync(observabilityConfig, "utf8");
  assert.match(compose, /opentelemetry-collector-contrib@sha256:[0-9a-f]{64}/);
  assert.match(compose, /giromesa\.observability\.durability:\s*"none"/);
  assert.doesNotMatch(compose, /^\s*ports:/m);
  assert.doesNotMatch(compose, /^\s*volumes:\s*\n\s*- [^:]+:\/var\//m);
  assert.match(config, /debug:/);
  assert.match(config, /exporters:\s*\[debug\]/);
  assert.doesNotMatch(config, /otlphttp\/upstream/);
});

test("application rollback only accepts immutable releases and refuses database rollback", () => {
  const rollback = readFileSync(rollbackScript, "utf8");
  assert.match(rollback, /ROLLBACK_RELEASE_SHA/);
  assert.match(rollback, /readlink -f/);
  assert.match(rollback, /git:\$current_sha|git:\$target_sha/);
  assert.match(rollback, /rollback-app\.json/);
  assert.doesNotMatch(rollback, /pg_restore|database\.dump|restore-drill/);
  assert.doesNotMatch(rollback, /(?:DROP|DELETE|UPDATE|INSERT|ALTER)\s+(?:DATABASE|TABLE|SCHEMA)/i);
  assert.match(rollback, /restore_previous_release/);
  assert.match(rollback, /trap recover_previous_release EXIT/);
  assert.match(rollback, /ROLLBACK_SERVICE_UNSTABLE/);
  assert.match(rollback, /ROLLBACK_CURRENT_IMAGE_ATTESTATION_FILE/);
  assert.match(rollback, /drizzle\.__drizzle_migrations/);
  assert.match(rollback, /rollback-compatibility\.json/);
  assert.match(rollback, /compose\.observability\.yaml/);
  assert.match(rollback, /system\.worker_probe/);
  const matrix = JSON.parse(readFileSync(compatibilityMatrix, "utf8"));
  assert.equal(matrix.schemaVersion, 2);
  assert.equal(matrix.requiredAppliedMigration, "0042_shallow_lenny_balinger");
  assert.deepEqual(matrix.transitions, [
    {
      appliedMigration: "0042_shallow_lenny_balinger",
      targetReleaseMigration: "0042_shallow_lenny_balinger",
      targetArtifact: "git:08d766051ee2dc3aef9ccb45b7eed02b0ac6a8af",
      evidence: {
        workflowRun: "https://github.com/pendevtsp-star/giro-mesa-v2/actions/runs/32280692224",
        testReportDigest:
          "sha256:7d37532ea2390b2d96a6d941d7e74e9449bef026d8df6d2d0e97fcf2d157ee25",
      },
    },
  ]);
  assert.match(rollback, /targetArtifact/);
  assert.match(rollback, /testReportDigest/);
  assert.match(rollback, /actions\/runs/);
});

test("deploy health gate includes the asynchronous worker", () => {
  const deploy = readFileSync(deployScript, "utf8");
  assert.match(deploy, /for service in api worker site customer ops/);
  assert.match(deploy, /RestartCount/);
  assert.match(deploy, /GIROMESA_STABILITY_SECONDS/);
});

test("pre-migration backup binds the migration actually applied in the source database", () => {
  const deploy = readFileSync(deployScript, "utf8");
  assert.match(deploy, /drizzle\.__drizzle_migrations/);
  assert.match(deploy, /source_migration_id/);
  assert.match(deploy, /--source-migration-id\s+"\$source_migration_id"/);
  assert.match(deploy, /--target-migration-id\s+"\$target_migration_id"/);
  assert.match(deploy, /--source-artifact\s+"\$source_artifact"/);
  assert.match(deploy, /--source-component-image/);
  assert.match(deploy, /\.RepoDigests/);
  assert.match(deploy, /--target-artifact\s+"\$target_artifact"/);
  assert.match(deploy, /recovery-compatibility\.json/);
  assert.match(deploy, /testedUpgrade/);
  assert.match(deploy, /RECOVERY_SCHEMA_COMPATIBILITY_UNPROVEN/);
  const recovery = JSON.parse(readFileSync(recoveryMatrix, "utf8"));
  assert.equal(recovery.targetMigration, "0042_shallow_lenny_balinger");
  assert.deepEqual(recovery.transitions, [
    {
      appliedBefore: "0026_doseclub_integration",
      appliedBeforeWhen: "1786493658116",
      appliedAfter: "0042_shallow_lenny_balinger",
      recoveryMigration: "0042_shallow_lenny_balinger",
      recoveryArtifact: "git:08d766051ee2dc3aef9ccb45b7eed02b0ac6a8af",
      testedUpgrade: true,
      evidence: {
        path: "docs/evidence/recovery/08d766-validation.json",
        sha256: "sha256:7d37532ea2390b2d96a6d941d7e74e9449bef026d8df6d2d0e97fcf2d157ee25",
        workflowRun: "https://github.com/pendevtsp-star/giro-mesa-v2/actions/runs/32280692224",
        testReportDigest:
          "sha256:7d37532ea2390b2d96a6d941d7e74e9449bef026d8df6d2d0e97fcf2d157ee25",
      },
    },
  ]);
});

test("deployment and rollback compose contracts always include observability and digest images", () => {
  const deploy = readFileSync(deployScript, "utf8");
  const rollback = readFileSync(rollbackScript, "utf8");
  const base = readFileSync(pilotCompose, "utf8");
  const images = readFileSync(imagesCompose, "utf8");
  assert.match(deploy, /compose\.observability\.yaml/);
  assert.match(deploy, /compose\.images\.yaml/);
  assert.match(deploy, /verify-image-provenance\.sh/);
  assert.match(rollback, /compose\.images\.yaml/);
  assert.match(images, /postgres@sha256:[0-9a-f]{64}/);
  for (const variable of ["API", "WORKER", "SITE", "CUSTOMER", "OPS"]) {
    assert.match(images, new RegExp(`GIROMESA_${variable}_IMAGE:\\?`));
  }
  assert.doesNotMatch(base, /postgres:17-alpine/);
  const provenance = readFileSync(imageProvenance, "utf8");
  const lock = JSON.parse(readFileSync(imageLock, "utf8"));
  assert.match(lock.images.postgres.reference, /^postgres@sha256:[0-9a-f]{64}$/);
  assert.equal(lock.images.postgres.upstreamRepository, "docker.io/library/postgres");
  assert.match(
    lock.images.cosign.reference,
    /^ghcr\.io\/sigstore\/cosign\/cosign@sha256:[0-9a-f]{64}$/,
  );
  assert.match(provenance, /"\$cosign_image" verify/);
  assert.match(provenance, /verify-blob/);
  assert.match(provenance, /ATTESTATION_BUNDLE_REQUIRED/);
  assert.match(provenance, /ATTESTATION_CHECKSUM_REQUIRED/);
  assert.match(provenance, /--certificate-identity/);
  assert.match(provenance, /publish-images\.yml@refs\/heads\/main/);
  assert.match(provenance, /--certificate-oidc-issuer/);
  assert.match(provenance, /--certificate-github-workflow-repository/);
  assert.match(provenance, /--certificate-github-workflow-sha/);
  assert.match(provenance, /docker buildx imagetools inspect/);
  assert.match(provenance, /json \.Provenance/);
  assert.match(provenance, /json \.SBOM/);
  assert.doesNotMatch(provenance, /verify-attestation/);
  assert.match(provenance, /config_dir_mode != 700/);
  assert.match(provenance, /--read-only --cap-drop ALL --security-opt no-new-privileges/);
  assert.match(provenance, /--env HOME=\/tmp\/cosign-home/);
  assert.doesNotMatch(provenance, /gh attestation/);
});

test("private repository publishes keyless Sigstore signatures for every image digest", () => {
  const workflow = readFileSync(join(root, ".github", "workflows", "publish-images.yml"), "utf8");
  const provenance = readFileSync(imageProvenance, "utf8");
  assert.match(workflow, /sigstore\/cosign-installer/);
  assert.match(workflow, /cosign sign --yes/);
  assert.match(workflow, /cosign sign-blob --yes/);
  assert.match(workflow, /release-manifest:/);
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /giromesa-image-attestation-\$\{SOURCE_SHA\}\.json\.bundle/);
  assert.match(workflow, /@\$\{\{ steps\.build\.outputs\.digest \}\}/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /provenance: mode=max/);
  assert.match(workflow, /sbom: true/);
  assert.doesNotMatch(workflow, /attest-build-provenance/);
  assert.doesNotMatch(workflow, /attestations: write/);
  assert.match(workflow, /runs-on: ubuntu-latest/);
  assert.doesNotMatch(workflow, /workflow_dispatch/);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$SOURCE_SHA"/);
  assert.match(workflow, /workflow_run\.event == 'push'/);
  assert.match(workflow, /head_repository\.full_name == github\.repository/);
  assert.match(workflow, /head_sha == github\.sha/);
  assert.doesNotMatch(workflow, /head_sha \|\| github\.sha/);
  const cosignInstallerPins = workflow.match(
    /sigstore\/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6 # v4\.1\.2/g,
  );
  const cosignReleasePins = workflow.match(/cosign-release: v3\.0\.6/g);
  assert.equal(cosignInstallerPins?.length, 4);
  assert.equal(cosignReleasePins?.length, 4);
  assert.match(provenance, /workflow_trigger=workflow_run/);
  assert.match(provenance, /--certificate-github-workflow-trigger "\$workflow_trigger"/);
  assert.doesNotMatch(provenance, /ci\.yml@refs\/heads\/release\/rollback-0029/);
  assert.match(provenance, /publish-images\.yml@refs\/heads\/main/);
  for (const line of workflow.match(/^\s*uses:\s*.+$/gm) ?? []) {
    assert.match(line, /@[0-9a-f]{40}(?:\s+#\s+v[^\s]+)?$/);
  }
});

test("recovery validation provisions the historical migration owner before database tests", () => {
  const publish = readFileSync(join(root, ".github", "workflows", "publish-images.yml"), "utf8");
  const validator = readFileSync(join(root, "scripts", "validate-recovery-candidate.sh"), "utf8");
  assert.match(publish, /scripts\/validate-recovery-candidate\.sh/);
  assert.match(
    validator,
    /create role giromesa nologin nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls/i,
  );
  assert.match(validator, /DATABASE_URL=.*pnpm db:migrate/);
});

test("recovery validation waits through the PostgreSQL temporary-server restart", () => {
  const validator = readFileSync(join(root, "scripts", "validate-recovery-candidate.sh"), "utf8");
  assert.match(validator, /local consecutive=0/);
  assert.match(validator, /psql -U "\$user" -d "\$database" -Atqc "SELECT 1"/);
  assert.match(validator, /if \(\(consecutive >= 3\)\); then return 0; fi/);
  assert.doesNotMatch(validator, /pg_isready/);
});

test("trusted recovery evidence matches the production-only schema matrix", () => {
  const entrypoint = readFileSync(trustedEntrypoint, "utf8");
  const provenance = readFileSync(imageProvenance, "utf8");
  assert.match(entrypoint, /evidence\.get\("doseClubReconciliation"\) == "legacy-source-upgraded"/);
  assert.match(provenance, /evidence\.get\("doseClubReconciliation"\) == "legacy-source-upgraded"/);
});

test("trusted entrypoint sanitizes privileged execution and serializes release operations", () => {
  const entrypoint = readFileSync(trustedEntrypoint, "utf8");
  assert.match(entrypoint, /^#!\/bin\/bash/);
  assert.match(entrypoint, /export PATH=\/usr\/sbin:\/usr\/bin:\/sbin:\/bin/);
  assert.match(
    entrypoint,
    /unset BASH_ENV ENV CDPATH GLOBIGNORE PYTHONPATH PYTHONHOME LD_PRELOAD LD_LIBRARY_PATH/,
  );
  assert.match(entrypoint, /unset -f/);
  assert.match(entrypoint, /python3 -I/);
  assert.match(entrypoint, /flock -n 9/);
  assert.match(entrypoint, /RELEASE_OPERATION_IN_PROGRESS/);
  assert.match(entrypoint, /DOCKER_HOST=unix:\/\/\/var\/run\/docker\.sock/);
  assert.match(entrypoint, /docker-empty/);
  assert.doesNotMatch(entrypoint, /volume "\$docker_config:/);
});

test("BuildKit attestation validation accepts single and multi-platform structural views", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-buildkit-attestation-"));
  const provenanceFile = join(directory, "provenance.json");
  const sbomFile = join(directory, "sbom.json");
  const slsa = {
    builder: { id: "https://github.com/docker/build-push-action" },
    buildType: "https://mobyproject.org/buildkit@v1",
    materials: [],
    metadata: { buildStartedOn: "2026-08-12T00:00:00Z" },
  };
  const spdx = {
    SPDXID: "SPDXRef-DOCUMENT",
    spdxVersion: "SPDX-2.3",
    packages: [{ name: "large-fixture", comment: "x".repeat(300_000) }],
  };
  try {
    writeFileSync(provenanceFile, JSON.stringify({ SLSA: slsa }));
    writeFileSync(sbomFile, JSON.stringify({ SPDX: spdx }));
    assert.equal(spawnSync("python", [buildkitValidator, provenanceFile, sbomFile]).status, 0);
    writeFileSync(
      provenanceFile,
      JSON.stringify({ "linux/amd64": { SLSA: slsa }, "linux/arm64": { SLSA: slsa } }),
    );
    writeFileSync(
      sbomFile,
      JSON.stringify({ "linux/amd64": { SPDX: spdx }, "linux/arm64": { SPDX: spdx } }),
    );
    assert.equal(spawnSync("python", [buildkitValidator, provenanceFile, sbomFile]).status, 0);
    writeFileSync(provenanceFile, JSON.stringify({ SLSA: {} }));
    assert.notEqual(spawnSync("python", [buildkitValidator, provenanceFile, sbomFile]).status, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release paths are canonical releases SHA directories", () => {
  const deploy = readFileSync(deployScript, "utf8");
  assert.match(deploy, /releases\/\$artifact_sha/);
  assert.match(deploy, /readlink -f/);
  assert.match(deploy, /RELEASE_PATH_NOT_CANONICAL/);
});
