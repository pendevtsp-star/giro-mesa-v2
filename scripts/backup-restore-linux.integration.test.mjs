import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const enabled = process.env.DISASTER_RECOVERY_DOCKER_TEST === "1";
const bash = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const backupScript = join(process.cwd(), "scripts", "backup-production.sh").replaceAll("\\", "/");
const restoreScript = join(process.cwd(), "scripts", "restore-drill.sh").replaceAll("\\", "/");
const powerShellRestoreScript = join(process.cwd(), "scripts", "restore-drill.ps1");

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
    if (spawnSync("docker", ["exec", container, "pg_isready", "-U", "giromesa"]).status === 0)
      return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  assert.fail(`PostgreSQL container ${container} did not become ready`);
}

test("Linux backup and restore round-trip database, objects, encrypted config and smoke", {
  skip: !enabled,
  timeout: 180_000,
}, () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const source = `giromesa-linux-dr-source-${suffix}`;
  const target = `giromesa-linux-dr-target-${suffix}`;
  const targetCross = `giromesa-linux-dr-cross-${suffix}`;
  const directory = mkdtempSync(join(tmpdir(), "giromesa-linux-dr-"));
  const backupRoot = join(directory, "backups");
  const objectSource = join(directory, "objects-source");
  const objectRestore = join(directory, "objects-restored");
  const configSource = join(directory, "configuration.age");
  const runtimeEnv = join(directory, ".env");
  const configRestore = join(directory, "config-restored");
  const smokeSql = join(directory, "smoke.sql");
  const artifact = `git:${"a".repeat(40)}`;
  const targetArtifact = `git:${"b".repeat(40)}`;
  const manifestKey = Buffer.alloc(48, 37).toString("base64");
  const path = (value) => value.replaceAll("\\", "/");

  try {
    mkdirSync(backupRoot, { recursive: true });
    chmodSync(backupRoot, 0o700);
    mkdirSync(join(objectSource, "menus"), { recursive: true });
    writeFileSync(join(objectSource, "menus", "cover.txt"), "cover-asset-v2\n");
    writeFileSync(configSource, Buffer.from([0, 255, 19, 71, 105, 114, 111]));
    writeFileSync(runtimeEnv, "POSTGRES_DB=giromesa\nSECRET=bound-only-by-hmac\n");
    writeFileSync(
      smokeSql,
      "DO $$ BEGIN IF (SELECT count(*) FROM dr_probe WHERE payload = 'linux-ok') <> 1 THEN RAISE EXCEPTION 'DR_PROBE_MISSING'; END IF; END $$;",
    );

    for (const container of [source, target, targetCross]) {
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
      `CREATE TABLE dr_probe (id integer PRIMARY KEY, payload text NOT NULL);
       CREATE TABLE identities (id uuid PRIMARY KEY);
       CREATE TABLE auth_sessions (identity_id uuid NOT NULL REFERENCES identities(id));
       CREATE TABLE oauth_accounts (identity_id uuid NOT NULL REFERENCES identities(id));
       CREATE TABLE password_credentials (identity_id uuid NOT NULL REFERENCES identities(id));
       INSERT INTO dr_probe VALUES (1, 'linux-ok');
       SET session_replication_role = replica;
       INSERT INTO auth_sessions VALUES ('00000000-0000-0000-0000-000000000001');
       INSERT INTO oauth_accounts VALUES ('00000000-0000-0000-0000-000000000001');
       INSERT INTO password_credentials VALUES ('00000000-0000-0000-0000-000000000001');
       RESET session_replication_role;`,
    ]);

    const env = {
      ...process.env,
      MSYS_NO_PATHCONV: "1",
      TMPDIR: path(directory),
      GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64: manifestKey,
    };
    const backupArgs = [
      backupScript,
      "--database-container",
      source,
      "--database-name",
      "giromesa",
      "--database-user",
      "giromesa",
      "--output-directory",
      path(backupRoot),
      "--source-artifact",
      artifact,
      "--source-migration-id",
      "0029_platform_incident_projection_actions",
      "--target-artifact",
      targetArtifact,
      "--target-migration-id",
      "0029_platform_incident_projection_actions",
      "--object-directory",
      path(objectSource),
      "--runtime-env-file",
      path(runtimeEnv),
    ];
    const backupEnv = {
      ...env,
      GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 19).toString("base64"),
    };
    const rejectedBackup = spawnSync(bash, backupArgs, {
      cwd: process.cwd(),
      encoding: "utf8",
      env: backupEnv,
    });
    assert.notEqual(rejectedBackup.status, 0);
    assert.match(
      rejectedBackup.stderr,
      /BACKUP_DATABASE_INTEGRITY_INVALID:auth_sessions\.identity_id:1,oauth_accounts\.identity_id:1,password_credentials\.identity_id:1/,
    );
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
      "TRUNCATE auth_sessions, oauth_accounts, password_credentials;",
    ]);
    const backupDirectory = run(bash, backupArgs, {
      env: backupEnv,
    })
      .split(/\r?\n/)
      .at(-1);
    assert.ok(backupDirectory);
    const crossBackup = join(directory, "cross-backup");
    cpSync(backupDirectory, crossBackup, { recursive: true });

    const evidencePath = run(
      bash,
      [
        restoreScript,
        "--backup-directory",
        backupDirectory,
        "--target-database-container",
        target,
        "--database-name",
        "giromesa",
        "--database-user",
        "giromesa",
        "--expected-artifact",
        artifact,
        "--expected-source-migration-id",
        "0029_platform_incident_projection_actions",
        "--expected-target-artifact",
        targetArtifact,
        "--expected-target-migration-id",
        "0029_platform_incident_projection_actions",
        "--restore-object-directory",
        path(objectRestore),
        "--restore-encrypted-config-directory",
        path(configRestore),
        "--smoke-sql-file",
        path(smokeSql),
      ],
      {
        env: {
          ...env,
          GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 19).toString("base64"),
        },
      },
    )
      .split(/\r?\n/)
      .at(-1);

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
        "SELECT payload FROM dr_probe WHERE id=1",
      ]),
      "linux-ok",
    );
    assert.equal(
      readFileSync(join(objectRestore, "menus", "cover.txt"), "utf8"),
      "cover-asset-v2\n",
    );
    assert.equal(
      readFileSync(join(configRestore, "runtime.env.restored"), "utf8").replaceAll("\r\n", "\n"),
      readFileSync(runtimeEnv, "utf8").replaceAll("\r\n", "\n"),
    );
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
    assert.equal(evidence.artifact, artifact);
    assert.equal(evidence.sourceArtifact, artifact);
    assert.equal(evidence.targetArtifact, targetArtifact);
    assert.equal(evidence.smoke, "passed");
    if (process.platform === "win32") {
      const crossObjects = join(directory, "objects-cross");
      const crossConfig = join(directory, "config-cross");
      const result = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-File",
          powerShellRestoreScript,
          "-BackupDirectory",
          crossBackup,
          "-TargetDatabaseContainer",
          targetCross,
          "-DatabaseName",
          "giromesa",
          "-DatabaseUser",
          "giromesa",
          "-ExpectedSourceArtifact",
          artifact,
          "-ExpectedSourceMigrationId",
          "0029_platform_incident_projection_actions",
          "-ExpectedTargetArtifact",
          targetArtifact,
          "-ExpectedTargetMigrationId",
          "0029_platform_incident_projection_actions",
          "-RestoreObjectDirectory",
          crossObjects,
          "-RestoreEncryptedConfigDirectory",
          crossConfig,
          "-SmokeSqlFile",
          smokeSql,
        ],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          env: {
            ...env,
            GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 19).toString("base64"),
          },
        },
      );
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.equal(
        run("docker", [
          "exec",
          targetCross,
          "psql",
          "-U",
          "giromesa",
          "-d",
          "giromesa",
          "-Atc",
          "SELECT payload FROM dr_probe WHERE id=1",
        ]),
        "linux-ok",
      );
    }
  } finally {
    for (const container of [source, target, targetCross])
      spawnSync("docker", ["rm", "--force", container]);
    rmSync(directory, { recursive: true, force: true });
  }
});
