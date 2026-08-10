#!/usr/bin/env bash
set -Eeuo pipefail

root=/srv/apps/giromesa-v2
compose_file=${GIROMESA_COMPOSE_FILE:-$root/current/deploy/vps/compose.pilot.yaml}
env_file=${GIROMESA_ENV_FILE:-$root/shared/.env}
backup_dir=$root/backups

if [[ ! -f "$compose_file" || ! -f "$env_file" ]]; then
  echo "Compose ou ambiente do V2 não encontrado." >&2
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

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$backup_dir/predeploy-$timestamp.sql.gz"
docker exec "$postgres_id" pg_dump -U giromesa --no-owner --no-privileges giromesa_v2 | gzip -9 > "$backup"
sha256sum "$backup" > "$backup.sha256"

"${compose[@]}" --profile tools run --rm migrate
"${compose[@]}" up -d --remove-orphans

for service in api site customer ops; do
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
echo "Deploy V2 concluído. Backup anterior: $backup"
