#!/usr/bin/env bash
set -Eeuo pipefail

database_container=""
database_name=""
database_user=""
output_directory=""
source_artifact=""
source_migration_id=""
target_artifact=""
target_migration_id=""
source_component_images=()
object_directory=""
runtime_env_file=""
max_rpo_minutes=5

while (($#)); do
  case "$1" in
    --database-container) database_container=${2-}; shift 2 ;;
    --database-name) database_name=${2-}; shift 2 ;;
    --database-user) database_user=${2-}; shift 2 ;;
    --output-directory) output_directory=${2-}; shift 2 ;;
    --artifact) source_artifact=${2-}; target_artifact=${2-}; shift 2 ;;
    --migration-id) source_migration_id=${2-}; target_migration_id=${2-}; shift 2 ;;
    --source-artifact) source_artifact=${2-}; shift 2 ;;
    --source-migration-id) source_migration_id=${2-}; shift 2 ;;
    --target-artifact) target_artifact=${2-}; shift 2 ;;
    --target-migration-id) target_migration_id=${2-}; shift 2 ;;
    --source-component-image) source_component_images+=("${2-}"); shift 2 ;;
    --object-directory) object_directory=${2-}; shift 2 ;;
    --encrypted-config-archive) echo "BACKUP_PREBUILT_CONFIG_FORBIDDEN" >&2; exit 1 ;;
    --runtime-env-file) runtime_env_file=${2-}; shift 2 ;;
    --max-rpo-minutes) max_rpo_minutes=${2-}; shift 2 ;;
    *) echo "BACKUP_ARGUMENT_INVALID" >&2; exit 1 ;;
  esac
done

for required in database_container database_name database_user output_directory source_artifact source_migration_id target_artifact target_migration_id; do
  if [[ -z ${!required} ]]; then
    echo "BACKUP_ARGUMENT_REQUIRED:$required" >&2
    exit 1
  fi
done

if [[ ! $database_container =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] ||
  [[ ! $database_name =~ ^[A-Za-z_][A-Za-z0-9_$.\-]{0,62}$ ]] ||
  [[ ! $database_user =~ ^[A-Za-z_][A-Za-z0-9_$.\-]{0,62}$ ]]; then
  echo "BACKUP_DATABASE_IDENTIFIER_INVALID" >&2
  exit 1
fi
if [[ ! $source_artifact =~ ^(git:)?[0-9a-fA-F]{40}$ ]] && [[ ! $source_artifact =~ @sha256:[0-9a-fA-F]{64}$ ]] && [[ ! $source_artifact =~ ^runtime-set:sha256:[0-9a-f]{64}$ ]]; then
  echo "BACKUP_ARTIFACT_NOT_IMMUTABLE" >&2
  exit 1
fi
if [[ ! $target_artifact =~ ^(git:)?[0-9a-fA-F]{40}$ ]] && [[ ! $target_artifact =~ @sha256:[0-9a-fA-F]{64}$ ]]; then
  echo "BACKUP_ARTIFACT_NOT_IMMUTABLE" >&2
  exit 1
fi
for image in "${source_component_images[@]}"; do
  [[ $image =~ ^ghcr\.io/pendevtsp-star/giro-mesa-v2-(api|worker)@sha256:[0-9a-f]{64}$ ]] || { echo "BACKUP_SOURCE_COMPONENT_NOT_IMMUTABLE" >&2; exit 1; }
done
if ((${#source_component_images[@]} != 0 && ${#source_component_images[@]} != 2)); then
  echo "BACKUP_SOURCE_COMPONENTS_INCOMPLETE" >&2
  exit 1
fi
if [[ ! $source_migration_id =~ ^[0-9]{4}_[A-Za-z0-9_.-]+$ ]] || [[ ! $target_migration_id =~ ^[0-9]{4}_[A-Za-z0-9_.-]+$ ]]; then
  echo "BACKUP_MIGRATION_ID_INVALID" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "BACKUP_TOOL_REQUIRED:python3" >&2
  exit 1
fi
if ! python3 - <<'PY'
import base64, os, sys
value = os.environ.get("GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64", "")
if not value:
    print("MANIFEST_HMAC_KEY_REQUIRED", file=sys.stderr)
    raise SystemExit(1)
try:
    decoded = base64.b64decode(value, validate=True)
except Exception:
    print("MANIFEST_HMAC_KEY_INVALID", file=sys.stderr)
    raise SystemExit(1)
if len(decoded) < 32:
    print("MANIFEST_HMAC_KEY_INVALID", file=sys.stderr)
    raise SystemExit(1)
PY
then
  exit 1
fi
if [[ -z $object_directory || -z $runtime_env_file ]]; then
  echo "BACKUP_COMPLETE_COVERAGE_REQUIRED" >&2
  exit 1
fi
if ! python3 - <<'PY'
import base64, os, sys
try: value = base64.b64decode(os.environ.get("GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64", ""), validate=True)
except Exception: value = b""
if len(value) != 32:
    print("BACKUP_CONFIG_ENCRYPTION_KEY_INVALID", file=sys.stderr); raise SystemExit(1)
PY
then exit 1; fi
if [[ ! -f $runtime_env_file || -L $runtime_env_file ]]; then
  echo "BACKUP_RUNTIME_ENV_INVALID" >&2
  exit 1
fi
if [[ ! $max_rpo_minutes =~ ^[1-5]$ ]]; then
  echo "BACKUP_RPO_INVALID" >&2
  exit 1
fi

for tool in docker tar sha256sum openssl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "BACKUP_TOOL_REQUIRED:$tool" >&2
    exit 1
  fi
done
if [[ -n $object_directory ]]; then
  if [[ ! -d $object_directory ]]; then
    echo "BACKUP_OBJECT_DIRECTORY_INVALID" >&2
    exit 1
  fi
  if ! python3 - "$object_directory" <<'PY'
import os, pathlib, sys
root = pathlib.Path(sys.argv[1])
for current, directories, files in os.walk(root, followlinks=False):
    for name in [*directories, *files]:
        if (pathlib.Path(current) / name).is_symlink():
            print("BACKUP_OBJECT_SYMLINK_FORBIDDEN", file=sys.stderr)
            raise SystemExit(1)
PY
  then
    exit 1
  fi
fi

started_epoch=$(date +%s)
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
backup_id="$(date -u +%Y%m%dT%H%M%SZ)-$(python3 - <<'PY'
import secrets
print(secrets.token_hex(16))
PY
)"
mkdir -p -- "$output_directory"
chmod 700 -- "$output_directory"
backup_directory="$output_directory/$backup_id"
container_dump="/tmp/giromesa-$backup_id.dump"
completed=0

cleanup() {
  docker exec "$database_container" rm -f "$container_dump" >/dev/null 2>&1 || true
  unset GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64
  if [[ $completed -ne 1 && -n ${backup_directory:-} && -d $backup_directory ]]; then
    chmod -R u+w -- "$backup_directory" 2>/dev/null || true
    rm -rf -- "$backup_directory"
  fi
}
trap cleanup EXIT

mkdir -- "$backup_directory"
chmod 700 -- "$backup_directory"
docker exec "$database_container" pg_dump \
  --format=custom --compress=6 --no-owner --no-acl \
  --username "$database_user" --dbname "$database_name" --file "$container_dump"
docker cp "$database_container:$container_dump" "$backup_directory/database.dump" >/dev/null
if [[ ! -s $backup_directory/database.dump ]]; then
  echo "BACKUP_DATABASE_DUMP_EMPTY" >&2
  exit 1
fi

if [[ -n $object_directory ]]; then
  tar_force_local=()
  if [[ $backup_directory == *:* ]]; then tar_force_local+=(--force-local); fi
  tar "${tar_force_local[@]}" --create --gzip --file "$backup_directory/objects.tar.gz" --directory "$object_directory" .
  if [[ ! -s $backup_directory/objects.tar.gz ]]; then
    echo "BACKUP_OBJECT_ARCHIVE_EMPTY" >&2
    exit 1
  fi
fi
openssl enc -aes-256-cbc -pbkdf2 -md sha256 -salt \
  -in "$runtime_env_file" -out "$backup_directory/configuration.enc" \
  -pass env:GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64
[[ -s $backup_directory/configuration.enc ]] || { echo "BACKUP_CONFIG_ENCRYPTION_FAILED" >&2; exit 1; }

finished_epoch=$(date +%s)
duration_seconds=$((finished_epoch - started_epoch))
if ((duration_seconds > max_rpo_minutes * 60)); then
  echo "BACKUP_WINDOW_EXCEEDED" >&2
  exit 1
fi
completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

source_components_json=$(printf '%s\n' "${source_component_images[@]}" | python3 -c 'import json,sys; print(json.dumps([line.rstrip("\n") for line in sys.stdin if line.rstrip("\n")]))')
python3 - "$backup_directory" "$backup_id" "$source_artifact" "$source_migration_id" "$target_artifact" "$target_migration_id" \
  "$database_container" "$database_name" "$started_at" "$completed_at" \
  "$duration_seconds" "$max_rpo_minutes" "$runtime_env_file" "$source_components_json" <<'PY'
import base64, hashlib, hmac, json, os, pathlib, sys
(
    root_raw, backup_id, source_artifact, source_migration_id, target_artifact,
    target_migration_id, source_container, database_name, created_at, completed_at,
    duration, rpo, runtime_env_file, source_components_json,
) = sys.argv[1:]
root = pathlib.Path(root_raw)
kind_by_name = {
    "database.dump": "postgresql",
    "objects.tar.gz": "objects",
    "configuration.age": "encrypted_configuration",
    "configuration.gpg": "encrypted_configuration",
    "configuration.enc": "encrypted_configuration",
}
files = []
for path in sorted(root.iterdir(), key=lambda item: item.name):
    if path.name not in kind_by_name or not path.is_file() or path.is_symlink():
        continue
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    files.append({"path": path.name, "kind": kind_by_name[path.name], "bytes": path.stat().st_size, "sha256": digest})
payload = {
    "schemaVersion": 1,
    "backupId": backup_id,
    "artifact": source_artifact,
    "migrationId": source_migration_id,
    "sourceArtifact": source_artifact,
    "sourceComponentImages": json.loads(source_components_json),
    "sourceMigrationId": source_migration_id,
    "targetArtifact": target_artifact,
    "targetMigrationId": target_migration_id,
    "coverage": {"mode": "embedded", "database": True, "objects": True, "encryptedConfiguration": True},
    "sourceDatabaseContainer": source_container,
    "databaseName": database_name,
    "createdAt": created_at,
    "completedAt": completed_at,
    "durationSeconds": int(duration),
    "declaredRpoMinutes": int(rpo),
    "files": files,
}
key = base64.b64decode(os.environ["GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64"], validate=True)
payload["runtimeConfigurationHmacSha256"] = hmac.new(
    key, pathlib.Path(runtime_env_file).read_bytes(), hashlib.sha256
).hexdigest()
payload_bytes = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
manifest = {
    "schemaVersion": 1,
    "signedPayloadBase64": base64.b64encode(payload_bytes).decode(),
    "hmacSha256": hmac.new(key, payload_bytes, hashlib.sha256).hexdigest(),
}
(root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY

chmod 400 -- "$backup_directory"/*
completed=1
printf '%s\n' "$backup_directory"
