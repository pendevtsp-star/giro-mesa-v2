#!/usr/bin/env bash
set -Eeuo pipefail

root=${GIROMESA_ROOT:-/srv/apps/giromesa-v2}
env_file=${GIROMESA_ENV_FILE:-$root/shared/.env}
target_sha=${ROLLBACK_RELEASE_SHA:-${1:-}}
current_release=$(readlink -f "$root/current")
target_candidate="$root/releases/$target_sha"
if [[ ! $target_sha =~ ^[0-9a-fA-F]{40}$ ]] || [[ ! -d $target_candidate ]]; then
  echo "ROLLBACK_RELEASE_SHA_INVALID" >&2
  exit 1
fi
target_release=$(readlink -f "$target_candidate")
if [[ ! $current_release =~ ^$root/releases/[0-9a-fA-F]{40}$ ]] || [[ $target_release != "$target_candidate" ]]; then
  echo "ROLLBACK_RELEASE_PATH_INVALID" >&2
  exit 1
fi
current_sha=$(basename "$current_release")
[[ $current_sha != "$target_sha" ]] || { echo "ROLLBACK_TARGET_ALREADY_CURRENT" >&2; exit 1; }
[[ ${ROLLBACK_COMPATIBILITY_APPROVED:-} == true ]] || { echo "ROLLBACK_COMPATIBILITY_APPROVED_REQUIRED" >&2; exit 1; }

compose_file="$target_release/deploy/vps/compose.pilot.yaml"
images_file="$target_release/deploy/vps/compose.images.yaml"
observability_file="$target_release/deploy/vps/compose.observability.yaml"
matrix_file="$current_release/deploy/vps/rollback-compatibility.json"
provenance_script="$target_release/deploy/vps/verify-image-provenance.sh"
for file in "$compose_file" "$images_file" "$observability_file" "$matrix_file" "$provenance_script" "$env_file"; do
  [[ -f $file ]] || { echo "ROLLBACK_FILE_REQUIRED:$file" >&2; exit 1; }
done
for tool in docker python3 curl readlink gh; do
  command -v "$tool" >/dev/null 2>&1 || { echo "ROLLBACK_TOOL_REQUIRED:$tool" >&2; exit 1; }
done
read_env_key() {
  python3 - "$env_file" "$1" <<'PY'
import json, pathlib, re, sys
path, key = pathlib.Path(sys.argv[1]), sys.argv[2]
matches = []
for line in path.read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(rf"{re.escape(key)}=(.*)", line)
    if match: matches.append(match.group(1).strip())
if len(matches) != 1: raise SystemExit(f"ROLLBACK_ENV_KEY_AMBIGUOUS:{key}")
value = matches[0]
if len(value) >= 2 and value[0] == value[-1] == '"': value = json.loads(value)
if "\n" in value or "\r" in value or not value: raise SystemExit(f"ROLLBACK_ENV_KEY_INVALID:{key}")
print(value, end="")
PY
}

postgres_id=$(docker ps --filter label=com.docker.compose.project=giromesa-v2-pilot \
  --filter label=com.docker.compose.service=postgres --format '{{.ID}}' --no-trunc)
[[ $postgres_id =~ ^[0-9a-f]{64}$ ]] || { echo "ROLLBACK_POSTGRES_REQUIRED" >&2; exit 1; }
postgres_user=$(read_env_key POSTGRES_USER)
postgres_database=$(read_env_key POSTGRES_DB)
applied_migration_at=$(docker exec "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --set ON_ERROR_STOP=1 --tuples-only --no-align --command "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1")
applied_migration_at=${applied_migration_at//$'\r'/}; applied_migration_at=${applied_migration_at//$'\n'/}
applied_migration=$(python3 - "$current_release/packages/db/drizzle/meta/_journal.json" "$applied_migration_at" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1], encoding="utf-8")).get("entries", [])
matches = [entry.get("tag") for entry in entries if str(entry.get("when")) == sys.argv[2]]
if len(matches) != 1: raise SystemExit(1)
print(matches[0], end="")
PY
)
target_migration=$(python3 - "$target_release/packages/db/drizzle/meta/_journal.json" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1], encoding="utf-8")).get("entries", [])
if not entries: raise SystemExit(1)
print(entries[-1]["tag"], end="")
PY
)
python3 - "$matrix_file" "$applied_migration" "$target_migration" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
valid = value.get("schemaVersion") == 1 and any(
    item.get("appliedMigration") == sys.argv[2]
    and item.get("targetReleaseMigration") == sys.argv[3]
    and isinstance(item.get("evidence"), str) and item["evidence"]
    for item in value.get("transitions", [])
)
if not valid:
    print("ROLLBACK_DATABASE_COMPATIBILITY_UNPROVEN", file=sys.stderr)
    raise SystemExit(1)
PY

attestation=${ROLLBACK_TARGET_IMAGE_ATTESTATION_FILE:-}
current_attestation=${ROLLBACK_CURRENT_IMAGE_ATTESTATION_FILE:-}
[[ -f $attestation && ! -L $attestation && -f $current_attestation && ! -L $current_attestation ]] || { echo "ROLLBACK_IMAGE_ATTESTATION_REQUIRED" >&2; exit 1; }
mapfile -t image_values < <(python3 - "$attestation" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
by_service = {image.rsplit("-", 1)[-1].split("@", 1)[0]: image for image in value.get("images", [])}
for name in ("api", "worker", "site", "customer", "ops"): print(by_service.get(name, ""))
PY
)
for index in "${!image_values[@]}"; do image_values[index]=${image_values[index]%$'\r'}; done
export GIROMESA_RELEASE_ARTIFACT_SHA="$target_sha" GIROMESA_IMAGE_ATTESTATION_FILE="$attestation"
export GIROMESA_API_IMAGE=${image_values[0]} GIROMESA_WORKER_IMAGE=${image_values[1]}
export GIROMESA_SITE_IMAGE=${image_values[2]} GIROMESA_CUSTOMER_IMAGE=${image_values[3]}
export GIROMESA_OPS_IMAGE=${image_values[4]}
export GIROMESA_POSTGRES_IMAGE=postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
compose=(docker compose --env-file "$env_file" -f "$compose_file" -f "$images_file" -f "$observability_file")
"$provenance_script"

restore_previous_release() {
  trap - EXIT
  ln -sfn "$current_release" "$root/.current-next"
  mv -Tf "$root/.current-next" "$root/current"
  mapfile -t current_images < <(python3 - "$current_attestation" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
by_service = {image.rsplit("-", 1)[-1].split("@", 1)[0]: image for image in value.get("images", [])}
for name in ("api", "worker", "site", "customer", "ops"): print(by_service.get(name, ""))
PY
  )
  for index in "${!current_images[@]}"; do current_images[index]=${current_images[index]%$'\r'}; done
  export GIROMESA_RELEASE_ARTIFACT_SHA="$current_sha" GIROMESA_IMAGE_ATTESTATION_FILE="$current_attestation"
  export GIROMESA_API_IMAGE=${current_images[0]} GIROMESA_WORKER_IMAGE=${current_images[1]}
  export GIROMESA_SITE_IMAGE=${current_images[2]} GIROMESA_CUSTOMER_IMAGE=${current_images[3]}
  export GIROMESA_OPS_IMAGE=${current_images[4]}
  "$current_release/deploy/vps/verify-image-provenance.sh"
  docker compose --env-file "$env_file" -f "$current_release/deploy/vps/compose.pilot.yaml" \
    -f "$current_release/deploy/vps/compose.images.yaml" -f "$current_release/deploy/vps/compose.observability.yaml" \
    up -d --remove-orphans
}

rollback_committed=0
recover_previous_release() {
  if [[ $rollback_committed -eq 0 ]]; then
    restore_previous_release || echo "ROLLBACK_PREVIOUS_RELEASE_RECOVERY_FAILED" >&2
  fi
}
trap recover_previous_release EXIT
mutators=()
for service in api worker; do
  id=$(docker ps --filter label=com.docker.compose.project=giromesa-v2-pilot \
    --filter "label=com.docker.compose.service=$service" --format '{{.ID}}' --no-trunc)
  [[ $id =~ ^[0-9a-f]{64}$ ]] || { echo "ROLLBACK_RUNNING_MUTATOR_REQUIRED:$service" >&2; exit 1; }
  mutators+=("$id")
done
docker stop --timeout "${GIROMESA_DRAIN_SECONDS:-30}" "${mutators[@]}" >/dev/null

ln -sfn "$target_release" "$root/.current-next"
mv -Tf "$root/.current-next" "$root/current"
if ! "${compose[@]}" up -d --remove-orphans; then
  echo "ROLLBACK_APPLICATION_START_FAILED" >&2
  exit 1
fi
for service in api worker site customer ops; do
  container_id=$("${compose[@]}" ps -q "$service")
  for _ in $(seq 1 30); do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
    [[ $status == healthy ]] && break
    sleep 2
  done
  [[ $status == healthy ]] || { echo "ROLLBACK_SERVICE_UNHEALTHY:$service" >&2; exit 1; }
done

stability_seconds=${GIROMESA_STABILITY_SECONDS:-15}
if [[ ! $stability_seconds =~ ^[0-9]+$ ]] || ((stability_seconds < 5)); then
  echo "ROLLBACK_STABILITY_WINDOW_INVALID" >&2
  exit 1
fi
declare -A restart_counts=()
for service in api worker site customer ops; do
  container_id=$("${compose[@]}" ps -q "$service")
  restart_counts[$service]=$(docker inspect --format '{{.RestartCount}}' "$container_id")
done
sleep "$stability_seconds"
for service in api worker site customer ops; do
  container_id=$("${compose[@]}" ps -q "$service")
  status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
  restart_count=$(docker inspect --format '{{.RestartCount}}' "$container_id")
  if [[ $status != healthy || $restart_count != "${restart_counts[$service]}" ]]; then
    echo "ROLLBACK_SERVICE_UNSTABLE:$service" >&2
    exit 1
  fi
done

probe_id=$(docker exec "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" --set ON_ERROR_STOP=1 \
  --quiet --tuples-only --no-align --command "WITH inserted AS (INSERT INTO outbox_events(topic,aggregate_type,aggregate_id,payload) VALUES ('system.worker_probe','system','rollback', '{}'::jsonb) RETURNING id) SELECT id FROM inserted")
probe_id=${probe_id//$'\r'/}; probe_id=${probe_id//$'\n'/}
for _ in $(seq 1 30); do
  processed=$(docker exec "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align \
    --command "SELECT processed_at IS NOT NULL FROM outbox_events WHERE id = '$probe_id'::uuid")
  processed=${processed//$'\r'/}; processed=${processed//$'\n'/}
  [[ $processed == t ]] && break
  sleep 1
done
[[ $processed == t ]] || { echo "ROLLBACK_WORKER_QUEUE_SMOKE_FAILED:system.worker_probe" >&2; exit 1; }
docker exec "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" --set ON_ERROR_STOP=1 \
  --command "DELETE FROM outbox_events WHERE id = '$probe_id'::uuid" >/dev/null

for endpoint in http://127.0.0.1:3210/health http://127.0.0.1:3110/ http://127.0.0.1:3111/ http://127.0.0.1:3112/health; do
  curl --fail --silent --show-error "$endpoint" >/dev/null || { echo "ROLLBACK_APPLICATION_SMOKE_FAILED" >&2; exit 1; }
done
evidence="$root/shared/rollback-app.json"
python3 - "$evidence" "git:$current_sha" "git:$target_sha" "$applied_migration" <<'PY'
import datetime, json, os, pathlib, sys, tempfile
path, previous, target, migration = sys.argv[1:]
destination = pathlib.Path(path)
if destination.is_symlink(): raise SystemExit("ROLLBACK_EVIDENCE_SYMLINK_FORBIDDEN")
value = {"schemaVersion":1,"previousArtifact":previous,"targetArtifact":target,
         "appliedMigration":migration,"databaseRestored":False,
         "completedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"smoke":"passed"}
fd, temporary = tempfile.mkstemp(prefix="rollback-app.", dir=destination.parent)
with os.fdopen(fd, "w", encoding="utf-8") as handle:
    json.dump(value, handle, indent=2); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
os.chmod(temporary, 0o600); os.replace(temporary, destination)
PY
rollback_committed=1
trap - EXIT
echo "Rollback de aplicação concluído sem restaurar banco. Evidência: $evidence"
