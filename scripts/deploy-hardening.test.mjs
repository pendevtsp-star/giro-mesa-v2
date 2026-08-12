import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
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
      schemaVersion: 1,
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
      JSON.stringify({ schemaVersion: 1, signedPayloadBase64: "e30=", hmacSha256: "0".repeat(64) }),
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
        schemaVersion: 1,
        backupId: "traversal",
        artifact: `git:${"1".repeat(40)}`,
        migrationId: "0029_platform_incident_projection_actions",
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

test("runtime env hardening blocks absent platform grants without partial writes", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-runtime-env-blocked-"));
  const envFile = join(directory, ".env");
  writeFileSync(envFile, 'POSTGRES_PASSWORD="preserve-me"\n');
  const before = readFileSync(envFile, "utf8");
  try {
    const result = run(ensureScript, [envFile], { PLATFORM_ADMIN_GRANTS_BOOTSTRAP: "" });
    assert.notEqual(result.status, 0);
    assert.match(output(result), /PLATFORM_ADMIN_GRANTS_REQUIRED/);
    assert.equal(readFileSync(envFile, "utf8"), before);
    assert.doesNotMatch(output(result), /preserve-me/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("deploy invokes the complete backup before migration and never snapshots clear env", () => {
  const deploy = readFileSync(deployScript, "utf8");
  const backupCall = deploy.indexOf("backup-production.sh");
  const migrationCall = deploy.indexOf("--profile tools run --rm migrate");
  assert.ok(backupCall >= 0, "deploy must invoke the complete Linux backup");
  assert.ok(migrationCall > backupCall, "backup must finish before migrations start");
  assert.doesNotMatch(deploy, /(?:cp|tar|gzip)[^\n]*(?:env_file|\.env)/i);
  assert.match(deploy, /GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64/);
  assert.match(deploy, /ensure-runtime-env\.sh/);
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
  assert.doesNotMatch(rollback, /pg_restore|psql|database\.dump|restore-drill/);
});

test("deploy health gate includes the asynchronous worker", () => {
  const deploy = readFileSync(deployScript, "utf8");
  assert.match(deploy, /for service in api worker site customer ops/);
});

test("pre-migration backup binds the migration actually applied in the source database", () => {
  const deploy = readFileSync(deployScript, "utf8");
  assert.match(deploy, /drizzle\.__drizzle_migrations/);
  assert.match(deploy, /source_migration_id/);
  assert.match(deploy, /--migration-id\s+"\$source_migration_id"/);
  assert.doesNotMatch(deploy, /--migration-id\s+"\$migration_id"/);
});
