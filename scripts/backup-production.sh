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
object_directory=""
encrypted_config_archive=""
external_coverage_attestation=""
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
    --object-directory) object_directory=${2-}; shift 2 ;;
    --encrypted-config-archive) encrypted_config_archive=${2-}; shift 2 ;;
    --external-coverage-attestation) external_coverage_attestation=${2-}; shift 2 ;;
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
if [[ ! $source_artifact =~ ^(git:)?[0-9a-fA-F]{40}$ ]] && [[ ! $source_artifact =~ @sha256:[0-9a-fA-F]{64}$ ]]; then
  echo "BACKUP_ARTIFACT_NOT_IMMUTABLE" >&2
  exit 1
fi
if [[ ! $target_artifact =~ ^(git:)?[0-9a-fA-F]{40}$ ]] && [[ ! $target_artifact =~ @sha256:[0-9a-fA-F]{64}$ ]]; then
  echo "BACKUP_ARTIFACT_NOT_IMMUTABLE" >&2
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
coverage_mode=embedded
if [[ -z $object_directory || -z $encrypted_config_archive ]]; then
  coverage_mode=external_attestation
  if [[ -z $external_coverage_attestation || ! -f $external_coverage_attestation || -L $external_coverage_attestation ]]; then
    echo "BACKUP_COVERAGE_ATTESTATION_REQUIRED" >&2
    exit 1
  fi
  if ! python3 - "$external_coverage_attestation" "$source_artifact" "$source_migration_id" <<'PY'
import datetime, json, pathlib, re, sys
path, artifact, migration = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
try:
    value = json.loads(path.read_text(encoding="utf-8"))
    expires = datetime.datetime.fromisoformat(value["expiresAt"].replace("Z", "+00:00"))
    valid = (
        value.get("schemaVersion") == 1
        and value.get("sourceArtifact") == artifact
        and value.get("sourceMigrationId") == migration
        and value.get("objects") == "externally_protected"
        and value.get("encryptedConfiguration") == "externally_protected"
        and re.fullmatch(r"sha256:[0-9a-f]{64}", value.get("evidenceDigest", ""))
        and expires > datetime.datetime.now(datetime.timezone.utc)
    )
except Exception:
    valid = False
if not valid:
    print("BACKUP_COVERAGE_ATTESTATION_INVALID", file=sys.stderr)
    raise SystemExit(1)
PY
  then exit 1; fi
fi
if [[ ! $max_rpo_minutes =~ ^[1-5]$ ]]; then
  echo "BACKUP_RPO_INVALID" >&2
  exit 1
fi

for tool in docker tar sha256sum; do
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
if [[ -n $encrypted_config_archive ]]; then
  if [[ ! -f $encrypted_config_archive || -L $encrypted_config_archive ]]; then
    echo "CONFIG_ARCHIVE_INVALID" >&2
    exit 1
  fi
  case "$encrypted_config_archive" in
    *.age|*.gpg|*.enc) ;;
    *) echo "CONFIG_ARCHIVE_MUST_BE_ENCRYPTED" >&2; exit 1 ;;
  esac
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
if [[ -n $encrypted_config_archive ]]; then
  extension=.${encrypted_config_archive##*.}
  cp -- "$encrypted_config_archive" "$backup_directory/configuration$extension"
fi

finished_epoch=$(date +%s)
duration_seconds=$((finished_epoch - started_epoch))
if ((duration_seconds > max_rpo_minutes * 60)); then
  echo "BACKUP_WINDOW_EXCEEDED" >&2
  exit 1
fi
completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

python3 - "$backup_directory" "$backup_id" "$source_artifact" "$source_migration_id" "$target_artifact" "$target_migration_id" \
  "$database_container" "$database_name" "$started_at" "$completed_at" \
  "$duration_seconds" "$max_rpo_minutes" "$coverage_mode" "$external_coverage_attestation" <<'PY'
import base64, hashlib, hmac, json, os, pathlib, sys
(
    root_raw, backup_id, source_artifact, source_migration_id, target_artifact,
    target_migration_id, source_container, database_name, created_at, completed_at,
    duration, rpo, coverage_mode, coverage_attestation,
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
    "sourceMigrationId": source_migration_id,
    "targetArtifact": target_artifact,
    "targetMigrationId": target_migration_id,
    "coverage": {"mode": coverage_mode},
    "sourceDatabaseContainer": source_container,
    "databaseName": database_name,
    "createdAt": created_at,
    "completedAt": completed_at,
    "durationSeconds": int(duration),
    "declaredRpoMinutes": int(rpo),
    "files": files,
}
if coverage_attestation:
    raw = pathlib.Path(coverage_attestation).read_bytes()
    payload["coverage"]["attestationSha256"] = hashlib.sha256(raw).hexdigest()
payload_bytes = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
key = base64.b64decode(os.environ["GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64"], validate=True)
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
