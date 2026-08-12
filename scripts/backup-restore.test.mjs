import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const backupScript = join(process.cwd(), "scripts", "backup-production.ps1");
const restoreScript = join(process.cwd(), "scripts", "restore-drill.ps1");
const manifestKey = Buffer.alloc(48, 37);
const sourceArtifact = `git:${"1".repeat(40)}`;
const targetArtifact = `git:${"2".repeat(40)}`;
const sourceMigrationId = "0029_platform_incident_projection_actions";
const targetMigrationId = "0030_dr_target_release";

function powershell(script, args, env = {}) {
  return spawnSync("powershell", ["-NoProfile", "-File", script, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

function output(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function backupArgs(outputDirectory, extra = []) {
  return [
    "-DatabaseContainer",
    "container-that-must-not-run",
    "-DatabaseName",
    "giromesa",
    "-DatabaseUser",
    "giromesa",
    "-OutputDirectory",
    outputDirectory,
    "-SourceArtifact",
    sourceArtifact,
    "-SourceMigrationId",
    sourceMigrationId,
    "-TargetArtifact",
    targetArtifact,
    "-TargetMigrationId",
    targetMigrationId,
    ...extra,
  ];
}

function restoreArgs(backupDirectory, extra = []) {
  return [
    "-BackupDirectory",
    backupDirectory,
    "-TargetDatabaseContainer",
    "container-that-must-not-run",
    "-DatabaseName",
    "giromesa_restore",
    "-DatabaseUser",
    "giromesa",
    "-ExpectedSourceArtifact",
    sourceArtifact,
    "-ExpectedSourceMigrationId",
    sourceMigrationId,
    "-ExpectedTargetArtifact",
    targetArtifact,
    "-ExpectedTargetMigrationId",
    targetMigrationId,
    ...extra,
  ];
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data ?? "", "utf8");
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(entry.externalAttributes ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function writeSignedBackup(directory, { objectArchive } = {}) {
  const files = [];
  const addFile = (name, kind, contents) => {
    writeFileSync(join(directory, name), contents);
    files.push({
      path: name,
      kind,
      bytes: contents.length,
      sha256: createHash("sha256").update(contents).digest("hex"),
    });
  };

  addFile("database.dump", "postgresql", Buffer.from("not-a-real-dump\n"));
  if (objectArchive) addFile("objects.zip", "objects", objectArchive);

  const payloadBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      backupId: "20260812T120000Z-test",
      sourceArtifact,
      sourceMigrationId,
      targetArtifact,
      targetMigrationId,
      sourceDatabaseContainer: "source-container",
      databaseName: "giromesa",
      createdAt: "2026-08-12T12:00:00.0000000+00:00",
      completedAt: "2026-08-12T12:00:01.0000000+00:00",
      durationSeconds: 1,
      declaredRpoMinutes: 5,
      files,
    }),
    "utf8",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      schemaVersion: 2,
      signedPayloadBase64: payloadBytes.toString("base64"),
      hmacSha256: createHmac("sha256", manifestKey).update(payloadBytes).digest("hex"),
    }),
  );
}

test("backup fails closed before invoking PostgreSQL when the manifest key is absent", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-backup-negative-"));
  try {
    const result = powershell(backupScript, backupArgs(directory), {
      GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: "",
    });

    assert.notEqual(result.status, 0);
    assert.match(output(result), /MANIFEST_HMAC_KEY_REQUIRED/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup rejects a reparse point inside the object tree before invoking PostgreSQL", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-backup-object-link-"));
  const objects = join(directory, "objects");
  const outside = join(directory, "outside");
  try {
    mkdirSync(objects);
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "must-not-be-archived");
    symlinkSync(outside, join(objects, "linked"), "junction");

    const result = powershell(
      backupScript,
      backupArgs(join(directory, "backups"), ["-ObjectDirectory", objects]),
      { GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey.toString("base64") },
    );

    assert.notEqual(result.status, 0);
    assert.match(output(result), /BACKUP_OBJECT_REPARSE_POINT_FORBIDDEN/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backup rejects a reparse point used as the encrypted configuration archive", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-backup-config-link-"));
  const outside = join(directory, "outside");
  const configLink = join(directory, "configuration.enc");
  try {
    mkdirSync(outside);
    symlinkSync(outside, configLink, "junction");

    const result = powershell(
      backupScript,
      backupArgs(join(directory, "backups"), ["-EncryptedConfigArchive", configLink]),
      { GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey.toString("base64") },
    );

    assert.notEqual(result.status, 0);
    assert.match(output(result), /CONFIG_ARCHIVE_REPARSE_POINT_FORBIDDEN/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restore rejects a forged manifest before touching the target", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-restore-negative-"));
  try {
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ schemaVersion: 2, files: [], hmacSha256: "00" }),
    );
    const result = powershell(restoreScript, restoreArgs(directory), {
      GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey.toString("base64"),
    });

    assert.notEqual(result.status, 0);
    assert.match(output(result), /MANIFEST_SIGNATURE_INVALID/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restore rejects a reparse point used as the backup directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-restore-root-link-"));
  const backup = join(directory, "backup");
  const backupLink = join(directory, "backup-link");
  try {
    mkdirSync(backup);
    writeSignedBackup(backup);
    symlinkSync(backup, backupLink, "junction");

    const result = powershell(restoreScript, restoreArgs(backupLink), {
      GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey.toString("base64"),
    });

    assert.notEqual(result.status, 0);
    assert.match(output(result), /RESTORE_REPARSE_POINT_FORBIDDEN/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restore rejects ZIP traversal before invoking PostgreSQL or extracting files", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-restore-zip-slip-"));
  const backup = join(directory, "backup");
  const restoreObjects = join(directory, "restored");
  const escaped = join(directory, "escaped.txt");
  try {
    mkdirSync(backup);
    writeSignedBackup(backup, {
      objectArchive: createStoredZip([{ name: "../escaped.txt", data: "escaped" }]),
    });

    const result = powershell(
      restoreScript,
      restoreArgs(backup, ["-RestoreObjectDirectory", restoreObjects]),
      { GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey.toString("base64") },
    );

    assert.notEqual(result.status, 0);
    assert.match(output(result), /BACKUP_OBJECT_PATH_INVALID/);
    assert.equal(existsSync(escaped), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restore rejects a symbolic-link entry in the ZIP before invoking PostgreSQL", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-restore-zip-link-"));
  const backup = join(directory, "backup");
  try {
    mkdirSync(backup);
    writeSignedBackup(backup, {
      objectArchive: createStoredZip([
        { name: "linked-secret", data: "../secret.txt", externalAttributes: 0xa1ff0000 },
      ]),
    });

    const result = powershell(
      restoreScript,
      restoreArgs(backup, ["-RestoreObjectDirectory", join(directory, "restored")]),
      { GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey.toString("base64") },
    );

    assert.notEqual(result.status, 0);
    assert.match(output(result), /BACKUP_OBJECT_LINK_FORBIDDEN/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restore rejects a reparse-point object target before invoking PostgreSQL", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-restore-target-link-"));
  const backup = join(directory, "backup");
  const outside = join(directory, "outside");
  const targetLink = join(directory, "restore-target");
  try {
    mkdirSync(backup);
    mkdirSync(outside);
    symlinkSync(outside, targetLink, "junction");
    writeSignedBackup(backup, {
      objectArchive: createStoredZip([{ name: "menus/cover.txt", data: "cover" }]),
    });

    const result = powershell(
      restoreScript,
      restoreArgs(backup, ["-RestoreObjectDirectory", targetLink]),
      { GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey.toString("base64") },
    );

    assert.notEqual(result.status, 0);
    assert.match(output(result), /RESTORE_REPARSE_POINT_FORBIDDEN/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restore refuses an existing reparse point at restore-evidence.json", () => {
  const directory = mkdtempSync(join(tmpdir(), "giromesa-restore-evidence-link-"));
  const backup = join(directory, "backup");
  const outside = join(directory, "outside");
  try {
    mkdirSync(backup);
    mkdirSync(outside);
    writeSignedBackup(backup);
    symlinkSync(outside, join(backup, "restore-evidence.json"), "junction");

    const result = powershell(restoreScript, restoreArgs(backup), {
      GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey.toString("base64"),
    });

    assert.notEqual(result.status, 0);
    assert.match(output(result), /RESTORE_EVIDENCE_PATH_INVALID/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("restore validates source and target release identities independently", async (t) => {
  const cases = [
    ["ExpectedSourceArtifact", `git:${"3".repeat(40)}`, "BACKUP_SOURCE_ARTIFACT_MISMATCH"],
    ["ExpectedSourceMigrationId", "0031_wrong_source", "BACKUP_SOURCE_MIGRATION_MISMATCH"],
    ["ExpectedTargetArtifact", `git:${"4".repeat(40)}`, "BACKUP_TARGET_ARTIFACT_MISMATCH"],
    ["ExpectedTargetMigrationId", "0032_wrong_target", "BACKUP_TARGET_MIGRATION_MISMATCH"],
  ];

  for (const [parameter, value, error] of cases) {
    await t.test(parameter, () => {
      const directory = mkdtempSync(join(tmpdir(), "giromesa-restore-release-contract-"));
      try {
        writeSignedBackup(directory);
        const args = restoreArgs(directory);
        args[args.indexOf(`-${parameter}`) + 1] = value;
        const result = powershell(restoreScript, args, {
          GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey.toString("base64"),
        });

        assert.notEqual(result.status, 0);
        assert.match(output(result), new RegExp(error));
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});

test("PowerShell DR scripts bind security controls and the source-target release contract", () => {
  const backup = readFileSync(backupScript, "utf8");
  const restore = readFileSync(restoreScript, "utf8");

  assert.match(backup, /ValidateRange\(1, 5\)[\s\S]*MaxRpoMinutes/);
  assert.match(backup, /EncryptedConfigArchive/);
  assert.match(backup, /ObjectDirectory/);
  assert.match(backup, /hmacSha256/);
  assert.match(backup, /sourceArtifact/);
  assert.match(backup, /sourceMigrationId/);
  assert.match(backup, /targetArtifact/);
  assert.match(backup, /targetMigrationId/);
  assert.match(backup, /ReparsePoint/);
  assert.match(restore, /ValidateRange\(1, 30\)[\s\S]*MaxRtoMinutes/);
  assert.match(restore, /MANIFEST_SIGNATURE_INVALID/);
  assert.match(restore, /BACKUP_FILE_HASH_MISMATCH/);
  assert.match(restore, /BACKUP_DATABASE_FILE_INVALID/);
  assert.match(restore, /BACKUP_OBJECT_PATH_INVALID/);
  assert.match(restore, /BACKUP_OBJECT_LINK_FORBIDDEN/);
  assert.match(restore, /RESTORE_OBJECT_TARGET_NOT_EMPTY/);
  assert.match(restore, /RESTORE_CONFIG_TARGET_NOT_EMPTY/);
  assert.match(restore, /SmokeSqlFile/);
  assert.match(restore, /smokeSqlSha256/);
  assert.match(restore, /objectsRestored/);
  assert.match(restore, /encryptedConfigurationRestored/);
  assert.ok(restore.indexOf("RESTORE_OBJECT_DIRECTORY_REQUIRED") < restore.indexOf("'pg_restore'"));
  assert.match(restore, /ExpectedSourceArtifact/);
  assert.match(restore, /ExpectedSourceMigrationId/);
  assert.match(restore, /ExpectedTargetArtifact/);
  assert.match(restore, /ExpectedTargetMigrationId/);
  assert.match(restore, /FileMode\]::CreateNew/);
  assert.match(restore, /\[IO\.File\]::Move/);
});
