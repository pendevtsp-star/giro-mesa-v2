#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${RETIRE_V1_CONFIRM:-} != remove-v1-after-v2-smoke ]]; then
  echo "Defina RETIRE_V1_CONFIRM=remove-v1-after-v2-smoke para confirmar." >&2
  exit 1
fi

for endpoint in \
  https://giromesa.com.br/ \
  https://app.giromesa.com.br/ \
  https://menu.giromesa.com.br/ \
  https://api.giromesa.com.br/health; do
  curl --fail --silent --show-error "$endpoint" >/dev/null
done

backup_dir=/srv/apps/giromesa-v2/backups/v1-final
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
backup=$backup_dir/giromesa-v1-final-$timestamp.sql.gz

if docker inspect giro_mesa-postgres-1 >/dev/null 2>&1; then
  docker exec giro_mesa-postgres-1 sh -c 'pg_dump -U "$POSTGRES_USER" --no-owner --no-privileges "$POSTGRES_DB"' | gzip -9 > "$backup"
  sha256sum "$backup" > "$backup.sha256"
fi

mapfile -t old_images < <(
  docker inspect --format '{{.Image}}' \
    giro_mesa-web-1 giro_mesa-api-1 giro_mesa-worker-1 giro_mesa-postgres-1 giro_mesa-redis-1 \
    2>/dev/null | sort -u
)

docker compose \
  --env-file /srv/apps/giromesa/giro_mesa/.env \
  -f /srv/apps/giromesa/giro_mesa/docker-compose.yml \
  down --remove-orphans

docker volume rm giro_mesa_postgres-data giro_mesa_redis-data
if [[ ${#old_images[@]} -gt 0 ]]; then
  docker image rm "${old_images[@]}" 2>/dev/null || true
fi

echo "V1 removido da execução. Backup final: $backup"
