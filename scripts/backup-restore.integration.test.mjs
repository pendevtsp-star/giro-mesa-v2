import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const enabled = process.env.DISASTER_RECOVERY_DOCKER_TEST === "1";
const backupScript = join(process.cwd(), "scripts", "backup-production.ps1");
const restoreScript = join(process.cwd(), "scripts", "restore-drill.ps1");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  );
  return (result.stdout ?? "").trim();
}

function waitForPostgres(container) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync("docker", ["exec", container, "pg_isready", "-U", "giromesa"], {
      encoding: "utf8",
    });
    if (result.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  assert.fail(`PostgreSQL container ${container} did not become ready`);
}

test("round-trips PostgreSQL, objects and encrypted configuration before a functional smoke", {
  skip: !enabled,
  timeout: 180_000,
}, () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const source = `giromesa-dr-source-${suffix}`;
  const target = `giromesa-dr-target-${suffix}`;
  const directory = mkdtempSync(join(tmpdir(), "giromesa-dr-roundtrip-"));
  const backupRoot = join(directory, "backups");
  const objectSource = join(directory, "objects-source");
  const objectRestore = join(directory, "objects-restored");
  const configSource = join(directory, "configuration.enc");
  const runtimeEnv = join(directory, ".env");
  const configRestore = join(directory, "config-restored");
  const smokeSql = join(directory, "smoke.sql");
  const sourceArtifact = `git:${"a".repeat(40)}`;
  const targetArtifact = `git:${"b".repeat(40)}`;
  const sourceMigrationId = "0029_platform_incident_projection_actions";
  const targetMigrationId = "0030_dr_target_release";
  const manifestKey = Buffer.alloc(48, 37).toString("base64");

  try {
    mkdirSync(join(objectSource, "menus"), { recursive: true });
    mkdirSync(join(objectSource, "receipts"), { recursive: true });
    writeFileSync(join(objectSource, "menus", "cover.txt"), "cover-asset-v1\n");
    writeFileSync(join(objectSource, "receipts", "receipt.json"), '{"amountCents":4200}\n');
    writeFileSync(configSource, Buffer.from([0, 255, 19, 71, 105, 114, 111, 77, 101, 115, 97]));
    writeFileSync(runtimeEnv, "POSTGRES_DB=giromesa\nSECRET=bound-only-by-hmac\n");
    writeFileSync(
      smokeSql,
      [
        "\\set ON_ERROR_STOP on",
        "DO $$ BEGIN",
        "  IF (SELECT count(*) FROM dr_probe WHERE payload = 'giromesa-dr-ok') <> 1 THEN",
        "    RAISE EXCEPTION 'DR_PROBE_MISSING';",
        "  END IF;",
        "END $$;",
      ].join("\n"),
    );

    for (const container of [source, target]) {
      run("docker", [
        "run",
        "--detach",
        "--rm",
        "--name",
        container,
        "--env",
        "POSTGRES_PASSWORD=giromesa-dr-only",
        "--env",
        "POSTGRES_USER=giromesa",
        "--env",
        "POSTGRES_DB=giromesa",
        "postgres:17-alpine",
      ]);
      waitForPostgres(container);
    }

    run("docker", [
      "exec",
      source,
      "psql",
      "-U",
      "giromesa",
      "-d",
      "giromesa",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "CREATE TABLE dr_probe (id integer PRIMARY KEY, payload text NOT NULL); INSERT INTO dr_probe VALUES (1, 'giromesa-dr-ok');",
    ]);

    const backupOutput = run(
      "powershell",
      [
        "-NoProfile",
        "-File",
        backupScript,
        "-DatabaseContainer",
        source,
        "-DatabaseName",
        "giromesa",
        "-DatabaseUser",
        "giromesa",
        "-OutputDirectory",
        backupRoot,
        "-SourceArtifact",
        sourceArtifact,
        "-SourceMigrationId",
        sourceMigrationId,
        "-TargetArtifact",
        targetArtifact,
        "-TargetMigrationId",
        targetMigrationId,
        "-ObjectDirectory",
        objectSource,
        "-RuntimeEnvFile",
        runtimeEnv,
      ],
      { env: { ...process.env, GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey, GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 19).toString("base64") } },
    );
    const backupDirectory = backupOutput.split(/\r?\n/).at(-1);
    assert.ok(backupDirectory);

    const evidencePath = run(
      "powershell",
      [
        "-NoProfile",
        "-File",
        restoreScript,
        "-BackupDirectory",
        backupDirectory,
        "-TargetDatabaseContainer",
        target,
        "-DatabaseName",
        "giromesa",
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
        "-RestoreObjectDirectory",
        objectRestore,
        "-RestoreEncryptedConfigDirectory",
        configRestore,
        "-SmokeSqlFile",
        smokeSql,
      ],
      { env: { ...process.env, GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey, GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 19).toString("base64") } },
    )
      .split(/\r?\n/)
      .at(-1);

    assert.ok(evidencePath);
    assert.equal(
      run("docker", [
        "exec",
        target,
        "psql",
        "-U",
        "giromesa",
        "-d",
        "giromesa",
        "-Atc",
        "SELECT payload FROM dr_probe WHERE id = 1",
      ]),
      "giromesa-dr-ok",
    );
    assert.equal(
      readFileSync(join(objectRestore, "menus", "cover.txt"), "utf8"),
      "cover-asset-v1\n",
    );
    assert.equal(
      readFileSync(join(objectRestore, "receipts", "receipt.json"), "utf8"),
      '{"amountCents":4200}\n',
    );
    assert.deepEqual(
      readFileSync(join(configRestore, "runtime.env.restored")),
      readFileSync(runtimeEnv),
    );

    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.schemaVersion, 2);
    assert.equal(evidence.sourceArtifact, sourceArtifact);
    assert.equal(evidence.sourceMigrationId, sourceMigrationId);
    assert.equal(evidence.targetArtifact, targetArtifact);
    assert.equal(evidence.targetMigrationId, targetMigrationId);
    assert.equal(evidence.sourceDatabaseContainer, source);
    assert.equal(evidence.targetDatabaseContainer, target);
    assert.equal(evidence.smoke, "passed");
    assert.equal(evidence.objectsRestored, true);
    assert.equal(evidence.encryptedConfigurationRestored, true);
    assert.match(evidence.smokeSqlSha256, /^[0-9a-f]{64}$/);
    assert.equal(lstatSync(evidencePath).isSymbolicLink(), false);
    assert.deepEqual(
      readdirSync(backupDirectory).filter((name) => name.startsWith(".restore-evidence-")),
      [],
    );
  } finally {
    for (const container of [source, target]) {
      spawnSync("docker", ["rm", "--force", container], { encoding: "utf8" });
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
