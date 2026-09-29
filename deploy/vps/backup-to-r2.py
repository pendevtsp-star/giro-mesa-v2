#!/usr/bin/env python3
"""Back up the active GiroMesa release and copy the signed generation to R2."""

import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import time
import urllib.request


ROOT = Path("/srv/apps/giromesa-v2")
BACKUP_ID = re.compile(r"[0-9]{8}T[0-9]{6}Z-[0-9a-f]{32}")
SHA = re.compile(r"[0-9a-f]{40}")
LOCAL_RETENTION_SECONDS = 24 * 60 * 60


def read_env(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError("BACKUP_ENV_PERMISSIONS_INVALID")
    values = {}
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, raw = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key) or key in values:
            raise RuntimeError("BACKUP_ENV_INVALID")
        values[key] = json.loads(raw) if raw.startswith('"') else raw
        if not isinstance(values[key], str):
            raise RuntimeError("BACKUP_ENV_INVALID")
    return values


def run(*args, env=None):
    result = subprocess.run(args, env=env, text=True, capture_output=True, timeout=55)
    if result.returncode:
        raise RuntimeError("BACKUP_COMMAND_FAILED:" + Path(args[0]).name)
    return result.stdout.strip()


def aws(credentials, *args):
    account = credentials["R2_ACCOUNT_ID"]
    environment = {
        "PATH": os.environ["PATH"],
        "AWS_ACCESS_KEY_ID": credentials["R2_ACCESS_KEY_ID"],
        "AWS_SECRET_ACCESS_KEY": credentials["R2_SECRET_ACCESS_KEY"],
        "AWS_DEFAULT_REGION": "auto",
        "AWS_EC2_METADATA_DISABLED": "true",
        "AWS_CONFIG_FILE": "/dev/null",
        "AWS_SHARED_CREDENTIALS_FILE": "/dev/null",
    }
    return run("aws", "--endpoint-url", f"https://{account}.r2.cloudflarestorage.com", *args, env=environment)


def prune_scheduled(scheduled, now=None):
    """Remove only this job's verified local generations older than 24 hours."""
    now = time.time() if now is None else now
    root = scheduled.resolve(strict=True)
    for path in scheduled.iterdir():
        if path.is_symlink() or not path.is_dir() or path.parent.resolve() != root or not BACKUP_ID.fullmatch(path.name):
            continue
        marker = path / ".r2-verified.json"
        manifest = path / "manifest.json"
        if marker.is_symlink() or manifest.is_symlink() or not marker.is_file() or not manifest.is_file():
            continue
        try:
            value = json.loads(marker.read_text())
            verified = value["verifiedAt"]
            valid = (
                value["backupId"] == path.name
                and value["manifestSha256"] == hashlib.sha256(manifest.read_bytes()).hexdigest()
                and isinstance(verified, (int, float))
                and now - verified > LOCAL_RETENTION_SECONDS
                and path.resolve(strict=True).parent == root
            )
        except (OSError, ValueError, KeyError, TypeError):
            valid = False
        if valid:
            shutil.rmtree(path)


def main():
    import fcntl

    with open("/run/lock/giromesa-release.lock", "a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("BACKUP_RELEASE_IN_PROGRESS") from error

        current = (ROOT / "current").resolve(strict=True)
        if current.parent != ROOT / "releases" or not SHA.fullmatch(current.name):
            raise RuntimeError("BACKUP_RELEASE_INVALID")
        release_sha = current.name
        journal = json.loads((current / "packages/db/drizzle/meta/_journal.json").read_text())
        latest = journal["entries"][-1]
        health = json.load(urllib.request.urlopen("http://127.0.0.1:3210/health", timeout=5))
        if (health.get("status"), health.get("database"), health.get("buildSha"), health.get("schemaVersion")) != (
            "ok", "up", release_sha, int(latest["tag"][:4])
        ):
            raise RuntimeError("BACKUP_RUNTIME_RELEASE_MISMATCH")

        runtime = read_env(ROOT / "shared/.env")
        offsite = read_env(ROOT / "shared/backup-offsite.env")
        if not re.fullmatch(r"[0-9a-f]{32}", offsite.get("R2_ACCOUNT_ID", "")) or not re.fullmatch(
            r"[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]", offsite.get("R2_BUCKET", "")
        ) or not all(offsite.get(key) for key in ("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")):
            raise RuntimeError("BACKUP_R2_CONFIG_INVALID")
        volume = json.loads(run("docker", "volume", "inspect", "giromesa-v2-pilot_media_data"))[0]["Mountpoint"]
        object_directory = Path(volume)
        if object_directory.is_symlink() or not object_directory.is_dir():
            raise RuntimeError("BACKUP_OBJECT_VOLUME_INVALID")
        postgres = run("docker", "ps", "--filter", "label=com.docker.compose.project=giromesa-v2-pilot",
                       "--filter", "label=com.docker.compose.service=postgres", "--format", "{{.ID}}", "--no-trunc")
        if not re.fullmatch(r"[0-9a-f]{64}", postgres):
            raise RuntimeError("BACKUP_POSTGRES_NOT_RUNNING")
        if run("docker", "inspect", "--format", "{{.State.Health.Status}}", postgres) != "healthy":
            raise RuntimeError("BACKUP_POSTGRES_UNHEALTHY")
        database = runtime["POSTGRES_DB"]
        user = runtime["POSTGRES_USER"]
        applied = run("docker", "exec", postgres, "psql", "--username", user, "--dbname", database,
                      "--no-psqlrc", "--tuples-only", "--no-align", "--set", "ON_ERROR_STOP=1",
                      "--command", "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1")
        if str(latest["when"]) != applied:
            raise RuntimeError("BACKUP_SCHEMA_MISMATCH")
        attestation = json.loads((ROOT / "shared/trust-evidence" / release_sha / "target" /
                                  f"giromesa-image-attestation-{release_sha}.json").read_text())
        if attestation.get("sourceCommit") != release_sha or attestation.get("role") != "target":
            raise RuntimeError("BACKUP_ATTESTATION_INVALID")
        for service in ("api", "worker"):
            container = run("docker", "ps", "--filter", "label=com.docker.compose.project=giromesa-v2-pilot",
                            "--filter", f"label=com.docker.compose.service={service}", "--format", "{{.ID}}", "--no-trunc")
            if not re.fullmatch(r"[0-9a-f]{64}", container):
                raise RuntimeError("BACKUP_MUTATOR_NOT_RUNNING")
            image_id = run("docker", "inspect", "--format", "{{.Image}}", container)
            digests = json.loads(run("docker", "image", "inspect", image_id, "--format", "{{json .RepoDigests}}"))
            expected = [image for image in attestation["images"] if image.startswith(
                f"ghcr.io/pendevtsp-star/giro-mesa-v2-{service}@sha256:")]
            if len(expected) != 1 or expected[0] not in digests:
                raise RuntimeError("BACKUP_RUNNING_IMAGE_MISMATCH")

        scheduled = ROOT / "backups/scheduled"
        scheduled.mkdir(mode=0o700, exist_ok=True)
        if scheduled.is_symlink() or scheduled.stat().st_uid != 0 or scheduled.stat().st_mode & 0o077:
            raise RuntimeError("BACKUP_OUTPUT_PERMISSIONS_INVALID")
        environment = {"PATH": os.environ["PATH"]}
        for key in ("GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64", "GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64"):
            environment[key] = runtime[key]
        backup = Path(run("bash", str(current / "scripts/backup-production.sh"),
                          "--database-container", postgres, "--database-name", database, "--database-user", user,
                          "--output-directory", str(scheduled), "--artifact", "git:" + release_sha,
                          "--migration-id", latest["tag"], "--object-directory", str(object_directory),
                          "--runtime-env-file", str(ROOT / "shared/.env"), "--max-rpo-minutes", "1", env=environment))
        if backup.parent != scheduled or not BACKUP_ID.fullmatch(backup.name):
            raise RuntimeError("BACKUP_OUTPUT_INVALID")
        manifest = backup / "manifest.json"
        signed = json.loads(manifest.read_text())
        payload_bytes = base64.b64decode(signed["signedPayloadBase64"], validate=True)
        key = base64.b64decode(runtime["GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64"], validate=True)
        if not hmac.compare_digest(hmac.new(key, payload_bytes, hashlib.sha256).hexdigest(), signed["hmacSha256"]):
            raise RuntimeError("BACKUP_MANIFEST_INVALID")
        payload = json.loads(payload_bytes)
        if payload.get("coverage") != {"mode": "embedded", "database": True, "objects": True, "encryptedConfiguration": True}:
            raise RuntimeError("BACKUP_COVERAGE_INVALID")

        bucket = offsite["R2_BUCKET"]
        entries = payload["files"] + [{"path": "manifest.json", "bytes": manifest.stat().st_size,
                                      "sha256": hashlib.sha256(manifest.read_bytes()).hexdigest()}]
        for entry in entries:
            source = backup / entry["path"]
            if source.is_symlink() or not source.is_file() or source.stat().st_size != entry["bytes"] or (
                hashlib.sha256(source.read_bytes()).hexdigest() != entry["sha256"]
            ):
                raise RuntimeError("BACKUP_FILE_INVALID")
            key_name = f"giromesa-v2/backups/{backup.name}/{source.name}"
            aws(offsite, "s3", "cp", str(source), f"s3://{bucket}/{key_name}", "--quiet",
                "--metadata", "sha256=" + entry["sha256"])
            remote = json.loads(aws(offsite, "s3api", "head-object", "--bucket", bucket, "--key", key_name))
            if remote.get("ContentLength") != entry["bytes"] or remote.get("Metadata", {}).get("sha256") != entry["sha256"]:
                raise RuntimeError("BACKUP_R2_VERIFY_FAILED")

        marker = backup / ".r2-verified.json"
        marker.write_text(json.dumps({"backupId": backup.name, "manifestSha256": entries[-1]["sha256"],
                                      "verifiedAt": time.time()}) + "\n")
        marker.chmod(0o400)
        prune_scheduled(scheduled)
        print("BACKUP_R2_COMPLETE:" + backup.name)


if __name__ == "__main__":
    main()
