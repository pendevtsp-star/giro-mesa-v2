import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const backupScript = join(process.cwd(), "scripts", "backup-production.ps1");
const restoreScript = join(process.cwd(), "scripts", "restore-drill.ps1");

function powershell(script, args, env = {}) {
  return spawnSync("powershell", ["-NoProfile", "-File", script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("backup fails closed before invoking PostgreSQL when the manifest key is absent", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-backup-negative-"));
  try {
    const result = powershell(
      backupScript,
      [
        "-DatabaseContainer",
        "container-that-must-not-run",
        "-DatabaseName",
        "giromesa",
        "-DatabaseUser",
        "giromesa",
        "-OutputDirectory",
        directory,
        "-Artifact",
        `git:${"1".repeat(40)}`,
        "-MigrationId",
        "0025_privacy_lifecycle",
      ],
      { GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: "" },
    );

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /MANIFEST_HMAC_KEY_REQUIRED/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restore rejects a forged manifest before touching the target", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-restore-negative-"));
  try {
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 1, files: [], hmacSha256: "00" }),
    );
    const result = powershell(
      restoreScript,
      [
        "-BackupDirectory",
        directory,
        "-TargetDatabaseContainer",
        "container-that-must-not-run",
        "-DatabaseName",
        "giromesa_restore",
        "-DatabaseUser",
        "giromesa",
        "-ExpectedArtifact",
        `git:${"1".repeat(40)}`,
      ],
      { GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: Buffer.alloc(32, 7).toString("base64") },
    );

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /MANIFEST_SIGNATURE_INVALID/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("scripts and runbook bind RPO, RTO, objects, encrypted config and immutable version", () => {
  const backup = readFileSync(backupScript, "utf8");
  const restore = readFileSync(restoreScript, "utf8");
  const runbook = readFileSync(
    join(process.cwd(), "docs", "runbooks", "disaster-recovery.md"),
    "utf8",
  );

  assert.match(backup, /ValidateRange\(1, 5\)[\s\S]*MaxRpoMinutes/);
  assert.match(backup, /EncryptedConfigArchive/);
  assert.match(backup, /ObjectDirectory/);
  assert.match(backup, /hmacSha256/);
  assert.match(restore, /ValidateRange\(1, 30\)[\s\S]*MaxRtoMinutes/);
  assert.match(restore, /MANIFEST_SIGNATURE_INVALID/);
  assert.match(restore, /BACKUP_FILE_HASH_MISMATCH/);
  assert.match(restore, /BACKUP_DATABASE_FILE_INVALID/);
  assert.match(restore, /RESTORE_OBJECT_TARGET_NOT_EMPTY/);
  assert.match(restore, /RESTORE_CONFIG_TARGET_NOT_EMPTY/);
  assert.match(restore, /SmokeSqlFile/);
  assert.match(restore, /smokeSqlSha256/);
  assert.match(restore, /objectsRestored/);
  assert.match(restore, /encryptedConfigurationRestored/);
  assert.ok(restore.indexOf("RESTORE_OBJECT_DIRECTORY_REQUIRED") < restore.indexOf("'pg_restore'"));
  assert.match(restore, /ExpectedArtifact/);
  assert.match(runbook, /RPO[^\n]*5 min/i);
  assert.match(runbook, /RTO[^\n]*30 min/i);
  assert.match(runbook, /objetos/i);
  assert.match(runbook, /configura[cç][aã]o criptografad/i);
});
