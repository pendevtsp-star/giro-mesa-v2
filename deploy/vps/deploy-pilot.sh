#!/usr/bin/env bash
set -Eeuo pipefail

root=/srv/apps/giromesa-v2
compose_file=${GIROMESA_COMPOSE_FILE:-$root/current/deploy/vps/compose.pilot.yaml}
env_file=${GIROMESA_ENV_FILE:-$root/shared/.env}
backup_dir=$root/backups
release_dir=$(cd "$(dirname "$compose_file")/../.." && pwd -P)
backup_script="$release_dir/scripts/backup-production.sh"
ensure_runtime_env="$release_dir/deploy/vps/ensure-runtime-env.sh"

if [[ ! -f "$compose_file" || ! -f "$env_file" || ! -f "$backup_script" || ! -f "$ensure_runtime_env" ]]; then
  echo "Compose ou ambiente do V2 não encontrado." >&2
  exit 1
fi

for tool in docker python3 tar sha256sum curl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Ferramenta obrigatória ausente antes do deploy: $tool" >&2
    exit 1
  fi
done

"$ensure_runtime_env" "$env_file"

read_env_key() {
  python3 - "$env_file" "$1" <<'PY'
import json, pathlib, re, sys
path, key = pathlib.Path(sys.argv[1]), sys.argv[2]
pattern = re.compile(rf"^{re.escape(key)}=(.*)$")
for line in path.read_text(encoding="utf-8").splitlines():
    match = pattern.match(line)
    if not match:
        continue
    value = match.group(1).strip()
    if len(value) >= 2 and value[0] == value[-1] == '"':
        value = json.loads(value)
    if "\n" in value or "\r" in value:
        raise SystemExit(1)
    print(value, end="")
    raise SystemExit(0)
raise SystemExit(1)
PY
}

artifact_sha=${GIROMESA_RELEASE_ARTIFACT_SHA:-}
if [[ -z "$artifact_sha" ]] && git -C "$release_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  artifact_sha=$(git -C "$release_dir" rev-parse HEAD)
fi
if [[ -z "$artifact_sha" ]]; then
  release_name=$(basename "$release_dir")
  if [[ $release_name =~ ^[0-9a-fA-F]{40}$ ]]; then artifact_sha=$release_name; fi
fi
if [[ ! $artifact_sha =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "GIROMESA_RELEASE_ARTIFACT_SHA deve ser o SHA Git completo da release." >&2
  exit 1
fi
artifact="git:$artifact_sha"
export GIROMESA_IMAGE_TAG="$artifact_sha"

target_migration_id=$(python3 - "$release_dir/packages/db/drizzle/meta/_journal.json" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
entries = value.get("entries", [])
if not entries or not isinstance(entries[-1].get("tag"), str):
    raise SystemExit(1)
print(entries[-1]["tag"], end="")
PY
)
if [[ -n ${GIROMESA_MIGRATION_ID:-} && $GIROMESA_MIGRATION_ID != "$target_migration_id" ]]; then
  echo "GIROMESA_MIGRATION_ID diverge da última migration versionada." >&2
  exit 1
fi
if [[ ! $target_migration_id =~ ^[0-9]{4}_[A-Za-z0-9_.-]+$ ]]; then
  echo "GIROMESA_MIGRATION_ID inválido ou migration journal ausente." >&2
  exit 1
fi

mkdir -p "$backup_dir"
chmod 700 "$root/shared" "$backup_dir"

compose=(docker compose --env-file "$env_file" -f "$compose_file")
export GIROMESA_ENV_FILE="$env_file"

"${compose[@]}" pull
"${compose[@]}" up -d postgres

postgres_id=$("${compose[@]}" ps -q postgres)
for _ in $(seq 1 30); do
  if [[ $(docker inspect --format '{{.State.Health.Status}}' "$postgres_id" 2>/dev/null || true) == healthy ]]; then
    break
  fi
  sleep 2
done
if [[ $(docker inspect --format '{{.State.Health.Status}}' "$postgres_id") != healthy ]]; then
  echo "PostgreSQL V2 não ficou saudável." >&2
  exit 1
fi

postgres_user=$(read_env_key POSTGRES_USER)
postgres_database=$(read_env_key POSTGRES_DB)
migration_table_exists=$(docker exec "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --set ON_ERROR_STOP=1 --tuples-only --no-align --command "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL")
migration_table_exists=${migration_table_exists//$'\r'/}
migration_table_exists=${migration_table_exists//$'\n'/}
if [[ $migration_table_exists == t ]]; then
  applied_migration_at=$(docker exec "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" \
    --set ON_ERROR_STOP=1 --tuples-only --no-align --command "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1")
  applied_migration_at=${applied_migration_at//$'\r'/}
  applied_migration_at=${applied_migration_at//$'\n'/}
  source_migration_id=$(python3 - "$release_dir/packages/db/drizzle/meta/_journal.json" "$applied_migration_at" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1], encoding="utf-8")).get("entries", [])
matches = [entry.get("tag") for entry in entries if str(entry.get("when")) == sys.argv[2]]
if len(matches) != 1 or not isinstance(matches[0], str):
    raise SystemExit(1)
print(matches[0], end="")
PY
  )
else
  source_migration_id=0000_unmigrated
fi
if [[ ! $source_migration_id =~ ^[0-9]{4}_[A-Za-z0-9_.-]+$ ]]; then
  echo "Migration aplicada no banco não corresponde ao journal da release; deploy abortado." >&2
  exit 1
fi
export GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64
GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64=$(read_env_key GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64)
backup_arguments=(
  --database-container "$postgres_id"
  --database-name "$postgres_database"
  --database-user "$postgres_user"
  --output-directory "$backup_dir"
  --artifact "$artifact"
  --migration-id "$source_migration_id"
)
if [[ -n ${GIROMESA_OBJECT_DIRECTORY:-} ]]; then
  backup_arguments+=(--object-directory "$GIROMESA_OBJECT_DIRECTORY")
fi
if [[ -n ${GIROMESA_ENCRYPTED_CONFIG_ARCHIVE:-} ]]; then
  backup_arguments+=(--encrypted-config-archive "$GIROMESA_ENCRYPTED_CONFIG_ARCHIVE")
fi
backup=$("$backup_script" "${backup_arguments[@]}")
unset GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64
if [[ ! -f "$backup/manifest.json" ]]; then
  echo "Backup completo não produziu manifesto; migrations abortadas." >&2
  exit 1
fi

"${compose[@]}" --profile tools run --rm migrate
"${compose[@]}" up -d --remove-orphans

for service in api worker site customer ops; do
  container_id=$("${compose[@]}" ps -q "$service")
  for _ in $(seq 1 30); do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
    if [[ "$status" == healthy || "$status" == running ]]; then
      break
    fi
    sleep 2
  done
  status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
  if [[ "$status" != healthy && "$status" != running ]]; then
    echo "Serviço $service não ficou saudável: $status" >&2
    exit 1
  fi
done

curl --fail --silent --show-error http://127.0.0.1:3210/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3110/ >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3111/ >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3112/health >/dev/null

"${compose[@]}" ps
echo "Deploy V2 concluído. Backup completo anterior: $backup"
