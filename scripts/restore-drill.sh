#!/usr/bin/env bash
set -Eeuo pipefail

backup_directory=""
target_database_container=""
database_name=""
database_user=""
expected_artifact=""
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
    --restore-object-directory) restore_object_directory=${2-}; shift 2 ;;
    --restore-encrypted-config-directory) restore_encrypted_config_directory=${2-}; shift 2 ;;
    --smoke-sql-file) smoke_sql_file=${2-}; shift 2 ;;
    --max-rto-minutes) max_rto_minutes=${2-}; shift 2 ;;
    *) echo "RESTORE_ARGUMENT_INVALID" >&2; exit 1 ;;
  esac
done

for required in backup_directory target_database_container database_name database_user expected_artifact; do
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
if [[ ! $expected_artifact =~ ^(git:)?[0-9a-fA-F]{40}$ ]] && [[ ! $expected_artifact =~ @sha256:[0-9a-fA-F]{64}$ ]]; then
  echo "RESTORE_ARTIFACT_NOT_IMMUTABLE" >&2
  exit 1
fi
if [[ ! $max_rto_minutes =~ ^([1-9]|[12][0-9]|30)$ ]]; then
  echo "RESTORE_RTO_INVALID" >&2
  exit 1
fi
for tool in python3 docker tar; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "RESTORE_TOOL_REQUIRED:$tool" >&2
    exit 1
  fi
done
if [[ ! -d $backup_directory || ! -f $backup_directory/manifest.json ]]; then
  echo "BACKUP_MANIFEST_MISSING" >&2
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

if ! python3 - "$backup_directory" "$stage" "$expected_artifact" "$target_database_container" <<'PY'
import base64, hashlib, hmac, json, os, pathlib, shutil, sys, tarfile

root = pathlib.Path(sys.argv[1]).resolve()
stage = pathlib.Path(sys.argv[2]).resolve()
expected_artifact = sys.argv[3]
target_container = sys.argv[4]

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
if manifest.get("schemaVersion") != 1 or payload.get("schemaVersion") != 1:
    fail("BACKUP_SCHEMA_UNSUPPORTED")
if payload.get("artifact") != expected_artifact:
    fail("BACKUP_ARTIFACT_MISMATCH")
if not isinstance(payload.get("declaredRpoMinutes"), int) or not 1 <= payload["declaredRpoMinutes"] <= 5:
    fail("BACKUP_RPO_INVALID")
source = payload.get("sourceDatabaseContainer")
if not isinstance(source, str) or not source or source == target_container:
    fail("RESTORE_TARGET_MUST_DIFFER_FROM_SOURCE")

allowed = {
    "database.dump": "postgresql",
    "objects.tar.gz": "objects",
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

archive = stage / "objects.tar.gz"
if archive.exists():
    try:
        with tarfile.open(archive, "r:gz") as value:
            for member in value.getmembers():
                path = pathlib.PurePosixPath(member.name)
                if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk() or member.isdev():
                    fail("BACKUP_OBJECT_PATH_INVALID")
    except (tarfile.TarError, OSError):
        fail("BACKUP_OBJECT_ARCHIVE_INVALID")

plan = {
    "backupId": payload.get("backupId"),
    "artifact": payload.get("artifact"),
    "migrationId": payload.get("migrationId"),
    "sourceDatabaseContainer": source,
    "hasObjects": archive.exists(),
    "configName": next((name for name in ("configuration.age", "configuration.gpg", "configuration.enc") if (stage / name).exists()), ""),
}
(stage / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
PY
then
  exit 1
fi

mapfile -t plan < <(python3 - "$stage/plan.json" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
for key in ("backupId", "artifact", "migrationId", "sourceDatabaseContainer", "hasObjects", "configName"):
    print(value.get(key, ""))
PY
)
for index in "${!plan[@]}"; do plan[index]=${plan[index]%$'\r'}; done
backup_id=${plan[0]}
artifact=${plan[1]}
migration_id=${plan[2]}
has_objects=${plan[4]}
config_name=${plan[5]}

if [[ $has_objects == True ]]; then
  if [[ -z $restore_object_directory ]]; then
    echo "RESTORE_OBJECT_DIRECTORY_REQUIRED" >&2
    exit 1
  fi
  if [[ -e $restore_object_directory ]] && [[ -n $(find "$restore_object_directory" -mindepth 1 -maxdepth 1 -print -quit) ]]; then
    echo "RESTORE_OBJECT_TARGET_NOT_EMPTY" >&2
    exit 1
  fi
fi
if [[ -n $config_name ]]; then
  if [[ -z $restore_encrypted_config_directory ]]; then
    echo "RESTORE_CONFIG_DIRECTORY_REQUIRED" >&2
    exit 1
  fi
  if [[ -e $restore_encrypted_config_directory ]] && [[ -n $(find "$restore_encrypted_config_directory" -mindepth 1 -maxdepth 1 -print -quit) ]]; then
    echo "RESTORE_CONFIG_TARGET_NOT_EMPTY" >&2
    exit 1
  fi
fi
smoke_sha=""
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
fi

docker_touched=1
docker cp "$stage/database.dump" "$target_database_container:$container_dump"
docker exec "$target_database_container" pg_restore --clean --if-exists --no-owner --no-acl \
  --exit-on-error --username "$database_user" --dbname "$database_name" "$container_dump"
docker exec "$target_database_container" psql --username "$database_user" --dbname "$database_name" \
  --set ON_ERROR_STOP=1 --tuples-only --command "SELECT 1" >/dev/null

if [[ $has_objects == True ]]; then
  mkdir -p -- "$restore_object_directory"
  tar_force_local=()
  if [[ $stage == *:* ]]; then tar_force_local+=(--force-local); fi
  tar "${tar_force_local[@]}" --extract --gzip --file "$stage/objects.tar.gz" --directory "$restore_object_directory" --no-same-owner --no-same-permissions
fi
if [[ -n $config_name ]]; then
  mkdir -p -- "$restore_encrypted_config_directory"
  cp -- "$stage/$config_name" "$restore_encrypted_config_directory/$config_name"
  if ! python3 - "$stage/$config_name" "$restore_encrypted_config_directory/$config_name" <<'PY'
import hashlib, hmac, sys
left = hashlib.sha256(open(sys.argv[1], "rb").read()).digest()
right = hashlib.sha256(open(sys.argv[2], "rb").read()).digest()
raise SystemExit(0 if hmac.compare_digest(left, right) else 1)
PY
  then
    echo "RESTORE_CONFIG_COPY_HASH_MISMATCH" >&2
    exit 1
  fi
fi
if [[ -n $smoke_sql_file ]]; then
  docker cp "$smoke_sql_file" "$target_database_container:$container_smoke"
  docker exec "$target_database_container" psql --username "$database_user" --dbname "$database_name" \
    --set ON_ERROR_STOP=1 --file "$container_smoke"
fi

duration_seconds=$(($(date +%s) - started_epoch))
if ((duration_seconds > max_rto_minutes * 60)); then
  echo "RESTORE_RTO_EXCEEDED" >&2
  exit 1
fi
evidence_path="$backup_directory/restore-evidence.json"
python3 - "$evidence_path" "$backup_id" "$artifact" "$migration_id" "$target_database_container" \
  "$duration_seconds" "$max_rto_minutes" "$smoke_sha" "$has_objects" "$config_name" <<'PY'
import json, sys
path, backup_id, artifact, migration_id, target, duration, rto, smoke_sha, objects, config_name = sys.argv[1:]
value = {
    "schemaVersion": 1,
    "backupId": backup_id,
    "artifact": artifact,
    "migrationId": migration_id,
    "targetDatabaseContainer": target,
    "durationSeconds": int(duration),
    "declaredRtoMinutes": int(rto),
    "smoke": "passed",
    "smokeSqlSha256": smoke_sha or None,
    "objectsRestored": objects == "True",
    "encryptedConfigurationRestored": bool(config_name),
}
open(path, "w", encoding="utf-8").write(json.dumps(value, indent=2) + "\n")
PY
chmod 400 -- "$evidence_path"
printf '%s\n' "$evidence_path"
