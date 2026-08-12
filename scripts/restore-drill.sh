#!/usr/bin/env bash
set -Eeuo pipefail

backup_directory=""
target_database_container=""
database_name=""
database_user=""
expected_artifact=""
expected_source_migration_id=""
expected_target_artifact=""
expected_target_migration_id=""
restore_object_directory=""
restore_encrypted_config_directory=""
smoke_sql_file=""
max_rto_minutes=30

while (($#)); do
  case "$1" in
    --backup-directory) backup_directory=${2-}; shift 2 ;;
    --target-database-container) target_database_container=${2-}; shift 2 ;;
    --database-name) database_name=${2-}; shift 2 ;;
    --database-user) database_user=${2-}; shift 2 ;;
    --expected-artifact) expected_artifact=${2-}; shift 2 ;;
    --expected-source-migration-id) expected_source_migration_id=${2-}; shift 2 ;;
    --expected-target-artifact) expected_target_artifact=${2-}; shift 2 ;;
    --expected-target-migration-id) expected_target_migration_id=${2-}; shift 2 ;;
    --restore-object-directory) restore_object_directory=${2-}; shift 2 ;;
    --restore-encrypted-config-directory) restore_encrypted_config_directory=${2-}; shift 2 ;;
    --smoke-sql-file) smoke_sql_file=${2-}; shift 2 ;;
    --max-rto-minutes) max_rto_minutes=${2-}; shift 2 ;;
    *) echo "RESTORE_ARGUMENT_INVALID" >&2; exit 1 ;;
  esac
done
expected_target_artifact=${expected_target_artifact:-$expected_artifact}
expected_target_migration_id=${expected_target_migration_id:-$expected_source_migration_id}

for required in backup_directory target_database_container database_name database_user expected_artifact expected_source_migration_id; do
  if [[ -z ${!required} ]]; then
    echo "RESTORE_ARGUMENT_REQUIRED:$required" >&2
    exit 1
  fi
done
if [[ ! $target_database_container =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] ||
  [[ ! $database_name =~ ^[A-Za-z_][A-Za-z0-9_$.\-]{0,62}$ ]] ||
  [[ ! $database_user =~ ^[A-Za-z_][A-Za-z0-9_$.\-]{0,62}$ ]]; then
  echo "RESTORE_DATABASE_IDENTIFIER_INVALID" >&2
  exit 1
fi
if [[ ! $expected_artifact =~ ^(git:)?[0-9a-fA-F]{40}$ ]] && [[ ! $expected_artifact =~ @sha256:[0-9a-fA-F]{64}$ ]] && [[ ! $expected_artifact =~ ^runtime-set:sha256:[0-9a-f]{64}$ ]]; then
  echo "RESTORE_ARTIFACT_NOT_IMMUTABLE" >&2
  exit 1
fi
if [[ ! $max_rto_minutes =~ ^([1-9]|[12][0-9]|30)$ ]]; then
  echo "RESTORE_RTO_INVALID" >&2
  exit 1
fi
for tool in python3 docker tar openssl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "RESTORE_TOOL_REQUIRED:$tool" >&2
    exit 1
  fi
done
if [[ ! -d $backup_directory || ! -f $backup_directory/manifest.json ]]; then
  echo "BACKUP_MANIFEST_MISSING" >&2
  exit 1
fi
if [[ -L $backup_directory || -L $backup_directory/manifest.json ]]; then
  echo "BACKUP_PATH_SYMLINK_FORBIDDEN" >&2
  exit 1
fi
if [[ -n $smoke_sql_file && (! -f $smoke_sql_file || -L $smoke_sql_file) ]]; then
  echo "RESTORE_SMOKE_SQL_INVALID" >&2
  exit 1
fi

started_epoch=$(date +%s)
stage=$(python3 - <<'PY'
import os, tempfile
print(tempfile.mkdtemp(prefix="giromesa-restore.", dir=os.environ.get("TMPDIR")))
PY
)
container_dump="/tmp/giromesa-restore-$(date +%s)-$$.dump"
container_smoke="/tmp/giromesa-smoke-$(date +%s)-$$.sql"
docker_touched=0
cleanup() {
  if [[ $docker_touched -eq 1 ]]; then
    docker exec "$target_database_container" rm -f "$container_dump" "$container_smoke" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$stage"
  unset GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64
}
trap cleanup EXIT

if ! python3 - "$backup_directory" "$stage" "$expected_artifact" "$expected_source_migration_id" "$expected_target_artifact" "$expected_target_migration_id" "$target_database_container" <<'PY'
import base64, hashlib, hmac, json, os, pathlib, re, shutil, stat, sys, zipfile

root_input = pathlib.Path(sys.argv[1])
if root_input.is_symlink():
    print("BACKUP_PATH_SYMLINK_FORBIDDEN", file=sys.stderr)
    raise SystemExit(1)
root = root_input.resolve()
stage = pathlib.Path(sys.argv[2]).resolve()
expected_artifact = sys.argv[3]
expected_source_migration = sys.argv[4]
expected_target_artifact = sys.argv[5]
expected_target_migration = sys.argv[6]
target_container = sys.argv[7]

def fail(code):
    print(code, file=sys.stderr)
    raise SystemExit(1)

encoded_key = os.environ.get("GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64", "")
if not encoded_key:
    fail("MANIFEST_HMAC_KEY_REQUIRED")
try:
    key = base64.b64decode(encoded_key, validate=True)
except Exception:
    fail("MANIFEST_HMAC_KEY_INVALID")
if len(key) < 32:
    fail("MANIFEST_HMAC_KEY_INVALID")
try:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    payload_bytes = base64.b64decode(manifest["signedPayloadBase64"], validate=True)
    declared = bytes.fromhex(manifest["hmacSha256"])
except Exception:
    fail("MANIFEST_SIGNATURE_INVALID")
computed = hmac.new(key, payload_bytes, hashlib.sha256).digest()
if not hmac.compare_digest(computed, declared):
    fail("MANIFEST_SIGNATURE_INVALID")
try:
    payload = json.loads(payload_bytes)
except Exception:
    fail("MANIFEST_PAYLOAD_INVALID")
if manifest.get("schemaVersion") != 2 or payload.get("schemaVersion") != 2:
    fail("BACKUP_SCHEMA_UNSUPPORTED")
if payload.get("coverage") != {"mode": "embedded", "database": True, "objects": True, "encryptedConfiguration": True}:
    fail("BACKUP_COMPLETE_COVERAGE_REQUIRED")
runtime_config_hmac = payload.get("runtimeConfigurationHmacSha256")
if not isinstance(runtime_config_hmac, str) or not __import__("re").fullmatch(r"[0-9a-f]{64}", runtime_config_hmac):
    fail("BACKUP_RUNTIME_CONFIGURATION_BINDING_INVALID")
if payload.get("sourceArtifact", payload.get("artifact")) != expected_artifact:
    fail("BACKUP_ARTIFACT_MISMATCH")
source_components = payload.get("sourceComponentImages", [])
if expected_artifact.startswith("runtime-set:"):
    pattern = re.compile(r"^ghcr\.io/pendevtsp-star/giro-mesa-v2-(api|worker)@sha256:[0-9a-f]{64}$")
    matches = [pattern.fullmatch(value) for value in source_components if isinstance(value, str)]
    canonical = json.dumps(sorted(source_components), separators=(",", ":"))
    computed = "runtime-set:sha256:" + hashlib.sha256(canonical.encode()).hexdigest()
    if len(source_components) != 2 or not all(matches) or {match.group(1) for match in matches} != {"api", "worker"} or len(set(source_components)) != 2 or computed != expected_artifact:
        fail("BACKUP_SOURCE_RUNTIME_SET_INVALID")
if payload.get("sourceMigrationId", payload.get("migrationId")) != expected_source_migration:
    fail("BACKUP_SOURCE_MIGRATION_MISMATCH")
if payload.get("targetArtifact", payload.get("artifact")) != expected_target_artifact:
    fail("BACKUP_TARGET_ARTIFACT_MISMATCH")
if expected_target_migration and payload.get("targetMigrationId", payload.get("migrationId")) != expected_target_migration:
    fail("BACKUP_TARGET_MIGRATION_MISMATCH")
if not isinstance(payload.get("declaredRpoMinutes"), int) or not 1 <= payload["declaredRpoMinutes"] <= 5:
    fail("BACKUP_RPO_INVALID")
source = payload.get("sourceDatabaseContainer")
if not isinstance(source, str) or not source or source == target_container:
    fail("RESTORE_TARGET_MUST_DIFFER_FROM_SOURCE")

allowed = {
    "database.dump": "postgresql",
    "objects.zip": "objects",
    "configuration.age": "encrypted_configuration",
    "configuration.gpg": "encrypted_configuration",
    "configuration.enc": "encrypted_configuration",
}
seen = set()
database_count = 0
for item in payload.get("files", []):
    if not isinstance(item, dict):
        fail("BACKUP_FILE_METADATA_INVALID")
    relative = item.get("path")
    if relative not in allowed or item.get("kind") != allowed[relative] or relative in seen:
        fail("BACKUP_FILE_PATH_INVALID")
    seen.add(relative)
    if relative == "database.dump":
        database_count += 1
    if not isinstance(item.get("bytes"), int) or item["bytes"] < 1:
        fail("BACKUP_FILE_METADATA_INVALID")
    digest = item.get("sha256")
    if not isinstance(digest, str) or len(digest) != 64:
        fail("BACKUP_FILE_METADATA_INVALID")
    candidate = root / relative
    if candidate.is_symlink() or not candidate.is_file():
        fail("BACKUP_FILE_MISSING")
    data = candidate.read_bytes()
    if len(data) != item["bytes"] or not hmac.compare_digest(hashlib.sha256(data).hexdigest(), digest):
        fail("BACKUP_FILE_HASH_MISMATCH")
    destination = stage / relative
    destination.write_bytes(data)
    if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
        fail("RESTORE_STAGING_HASH_MISMATCH")
if database_count != 1:
    fail("BACKUP_DATABASE_FILE_INVALID")

archive = stage / "objects.zip"
if archive.exists():
    try:
        with zipfile.ZipFile(archive, "r") as value:
            names=set()
            for member in value.infolist():
                path = pathlib.PurePosixPath(member.filename)
                mode=(member.external_attr >> 16) & 0xFFFF
                if (path.is_absolute() or ".." in path.parts or ":" in member.filename or member.filename in names
                        or stat.S_ISLNK(mode) or (mode and not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)))):
                    fail("BACKUP_OBJECT_PATH_INVALID")
                names.add(member.filename)
            object_stage = stage / "objects-restored"
            object_stage.mkdir(mode=0o700)
            value.extractall(object_stage)
    except (zipfile.BadZipFile, OSError):
        fail("BACKUP_OBJECT_ARCHIVE_INVALID")

plan = {
    "backupId": payload.get("backupId"),
    "sourceArtifact": payload.get("sourceArtifact", payload.get("artifact")),
    "sourceMigrationId": payload.get("sourceMigrationId", payload.get("migrationId")),
    "targetArtifact": payload.get("targetArtifact", payload.get("artifact")),
    "targetMigrationId": payload.get("targetMigrationId", payload.get("migrationId")),
    "sourceDatabaseContainer": source,
    "hasObjects": archive.exists(),
    "configName": next((name for name in ("configuration.age", "configuration.gpg", "configuration.enc") if (stage / name).exists()), ""),
    "runtimeConfigurationHmacSha256": runtime_config_hmac,
}
(stage / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
PY
then
  exit 1
fi

mapfile -t plan < <(python3 - "$stage/plan.json" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
for key in ("backupId", "sourceArtifact", "sourceMigrationId", "targetArtifact", "targetMigrationId", "sourceDatabaseContainer", "hasObjects", "configName", "runtimeConfigurationHmacSha256"):
    print(value.get(key, ""))
PY
)
for index in "${!plan[@]}"; do plan[index]=${plan[index]%$'\r'}; done
backup_id=${plan[0]}
artifact=${plan[1]}
migration_id=${plan[2]}
target_artifact=${plan[3]}
target_migration_id=${plan[4]}
has_objects=${plan[6]}
config_name=${plan[7]}
runtime_configuration_hmac=${plan[8]}

if [[ $has_objects == True ]]; then
  if [[ -z $restore_object_directory ]]; then
    echo "RESTORE_OBJECT_DIRECTORY_REQUIRED" >&2
    exit 1
  fi
  if [[ -e $restore_object_directory || -L $restore_object_directory ]]; then
    echo "RESTORE_OBJECT_TARGET_MUST_NOT_EXIST" >&2
    exit 1
  fi
fi
if [[ -n $config_name ]]; then
  if [[ -z $restore_encrypted_config_directory ]]; then
    echo "RESTORE_CONFIG_DIRECTORY_REQUIRED" >&2
    exit 1
  fi
  if [[ -e $restore_encrypted_config_directory || -L $restore_encrypted_config_directory ]]; then
    echo "RESTORE_CONFIG_TARGET_MUST_NOT_EXIST" >&2
    exit 1
  fi
fi
if [[ $config_name != configuration.enc ]]; then
  echo "BACKUP_CONFIG_FORMAT_UNSUPPORTED" >&2
  exit 1
fi
if ! python3 - <<'PY'
import base64, os, sys
try: value = base64.b64decode(os.environ.get("GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64", ""), validate=True)
except Exception: value = b""
if len(value) != 32: print("BACKUP_CONFIG_ENCRYPTION_KEY_INVALID", file=sys.stderr); raise SystemExit(1)
PY
then exit 1; fi
runtime_config_stage="$stage/runtime.env.restored"
openssl enc -d -aes-256-cbc -pbkdf2 -md sha256 -in "$stage/$config_name" -out "$runtime_config_stage" \
  -pass env:GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64
chmod 600 "$runtime_config_stage"
python3 - "$runtime_config_stage" "$runtime_configuration_hmac" <<'PY'
import base64, hashlib, hmac, os, pathlib, re, sys
path, expected = pathlib.Path(sys.argv[1]), sys.argv[2]
raw = path.read_bytes()
key = base64.b64decode(os.environ["GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64"], validate=True)
actual = hmac.new(key, raw, hashlib.sha256).hexdigest()
if not hmac.compare_digest(actual, expected): raise SystemExit("BACKUP_RUNTIME_CONFIGURATION_MISMATCH")
seen = set()
for line in raw.decode("utf-8").splitlines():
    if not line or line.lstrip().startswith("#"): continue
    match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)=(.*)", line)
    if not match or match.group(1) in seen: raise SystemExit("BACKUP_RUNTIME_CONFIGURATION_INVALID")
    seen.add(match.group(1))
PY
evidence_path="$backup_directory/restore-evidence.json"
if [[ -e $evidence_path || -L $evidence_path ]]; then
  echo "RESTORE_EVIDENCE_ALREADY_EXISTS" >&2
  exit 1
fi
smoke_sha=""
staged_smoke_sql=""
if [[ -n $smoke_sql_file ]]; then
  smoke_size=$(wc -c < "$smoke_sql_file")
  if ((smoke_size < 1 || smoke_size > 65536)); then
    echo "RESTORE_SMOKE_SQL_INVALID" >&2
    exit 1
  fi
  smoke_sha=$(python3 - "$smoke_sql_file" <<'PY'
import hashlib, sys
print(hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest(), end="")
PY
)
  staged_smoke_sql="$stage/smoke.sql"
  python3 - "$smoke_sql_file" "$staged_smoke_sql" "$smoke_sha" <<'PY'
import hashlib, hmac, pathlib, shutil, sys
source, destination, expected = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
if source.is_symlink() or not source.is_file(): raise SystemExit("RESTORE_SMOKE_SQL_INVALID")
shutil.copyfile(source, destination)
actual = hashlib.sha256(destination.read_bytes()).hexdigest()
if not hmac.compare_digest(actual, expected): raise SystemExit("RESTORE_SMOKE_SQL_CHANGED")
PY
fi

docker_touched=1
docker cp "$stage/database.dump" "$target_database_container:$container_dump"
docker exec "$target_database_container" pg_restore --clean --if-exists --no-owner --no-acl \
  --exit-on-error --username "$database_user" --dbname "$database_name" "$container_dump"
docker exec "$target_database_container" psql --username "$database_user" --dbname "$database_name" \
  --set ON_ERROR_STOP=1 --tuples-only --command "SELECT 1" >/dev/null

if [[ $has_objects == True ]]; then
  python3 - "$stage/objects-restored" "$restore_object_directory" <<'PY'
import os, pathlib, sys
source, destination = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
parent = destination.parent
if destination.exists() or destination.is_symlink() or parent.is_symlink() or not parent.is_dir():
    raise SystemExit("RESTORE_OBJECT_TARGET_UNSAFE")
if os.rename in os.supports_dir_fd:
    parent_fd = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        os.rename(source, destination.name, dst_dir_fd=parent_fd)
    finally:
        os.close(parent_fd)
else:
    if parent.is_symlink(): raise SystemExit("RESTORE_OBJECT_TARGET_UNSAFE")
    os.rename(source, destination)
PY
fi
if [[ -n $config_name ]]; then
  python3 - "$runtime_config_stage" "$restore_encrypted_config_directory" "runtime.env.restored" <<'PY'
import hashlib, hmac, os, pathlib, shutil, sys, tempfile
source, destination, name = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), sys.argv[3]
parent = destination.parent
if destination.exists() or destination.is_symlink() or parent.is_symlink() or not parent.is_dir():
    raise SystemExit("RESTORE_CONFIG_TARGET_UNSAFE")
temporary = pathlib.Path(tempfile.mkdtemp(prefix="giromesa-config.", dir=parent))
try:
    target = temporary / name
    shutil.copyfile(source, target)
    left = hashlib.sha256(source.read_bytes()).digest()
    right = hashlib.sha256(target.read_bytes()).digest()
    if not hmac.compare_digest(left, right): raise SystemExit("RESTORE_CONFIG_COPY_HASH_MISMATCH")
    if os.rename in os.supports_dir_fd:
        parent_fd = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0))
        try:
            os.rename(temporary, destination.name, dst_dir_fd=parent_fd)
        finally: os.close(parent_fd)
    else:
        if parent.is_symlink(): raise SystemExit("RESTORE_CONFIG_TARGET_UNSAFE")
        os.rename(temporary, destination)
except BaseException:
    shutil.rmtree(temporary, ignore_errors=True)
    raise
PY
fi
if [[ -n $staged_smoke_sql ]]; then
  python3 - "$staged_smoke_sql" "$smoke_sha" <<'PY'
import hashlib, hmac, sys
actual = hashlib.sha256(open(sys.argv[1], "rb").read()).hexdigest()
if not hmac.compare_digest(actual, sys.argv[2]): raise SystemExit("RESTORE_STAGED_SMOKE_SQL_CHANGED")
PY
  docker cp "$staged_smoke_sql" "$target_database_container:$container_smoke"
  docker exec "$target_database_container" psql --username "$database_user" --dbname "$database_name" \
    --set ON_ERROR_STOP=1 --file "$container_smoke"
fi

duration_seconds=$(($(date +%s) - started_epoch))
if ((duration_seconds > max_rto_minutes * 60)); then
  echo "RESTORE_RTO_EXCEEDED" >&2
  exit 1
fi
python3 - "$evidence_path" "$backup_id" "$artifact" "$migration_id" "$target_artifact" "$target_migration_id" "$target_database_container" \
  "$duration_seconds" "$max_rto_minutes" "$smoke_sha" "$has_objects" "$config_name" <<'PY'
import json, os, pathlib, sys, tempfile
path, backup_id, artifact, migration_id, target_artifact, target_migration_id, target, duration, rto, smoke_sha, objects, config_name = sys.argv[1:]
value = {
    "schemaVersion": 2,
    "backupId": backup_id,
    "artifact": artifact,
    "migrationId": migration_id,
    "sourceArtifact": artifact,
    "sourceMigrationId": migration_id,
    "targetArtifact": target_artifact,
    "targetMigrationId": target_migration_id,
    "targetDatabaseContainer": target,
    "durationSeconds": int(duration),
    "declaredRtoMinutes": int(rto),
    "smoke": "passed",
    "smokeSqlSha256": smoke_sha or None,
    "objectsRestored": objects == "True",
    "encryptedConfigurationRestored": bool(config_name),
}
destination = pathlib.Path(path)
if destination.exists() or destination.is_symlink(): raise SystemExit("RESTORE_EVIDENCE_ALREADY_EXISTS")
fd, temporary = tempfile.mkstemp(prefix="restore-evidence.", dir=destination.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
    os.chmod(temporary, 0o400)
    if destination.exists() or destination.is_symlink(): raise SystemExit("RESTORE_EVIDENCE_ALREADY_EXISTS")
    os.replace(temporary, destination)
    if os.name == "posix":
        directory_fd = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try: os.fsync(directory_fd)
        finally: os.close(directory_fd)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
PY
printf '%s\n' "$evidence_path"
