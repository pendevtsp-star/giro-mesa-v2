#!/usr/bin/env bash
set -Eeuo pipefail

root=${GIROMESA_ROOT:-/srv/apps/giromesa-v2}
env_file=${GIROMESA_ENV_FILE:-$root/shared/.env}
backup_dir=$root/backups
release_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
artifact_sha=${GIROMESA_RELEASE_ARTIFACT_SHA:-$(basename "$release_dir")}
expected_release="$root/releases/$artifact_sha"
current_release=$(readlink -f "$root/current")
recovery_sha=${GIROMESA_RECOVERY_RELEASE_SHA:-}
recovery_release="$root/releases/$recovery_sha"
target_artifact="git:$artifact_sha"

if [[ ! $artifact_sha =~ ^[0-9a-fA-F]{40}$ ]] || [[ $(readlink -f "$release_dir") != "$expected_release" ]]; then
  echo "RELEASE_PATH_NOT_CANONICAL: expected releases/$artifact_sha" >&2
  exit 1
fi
if [[ ! $current_release =~ ^$root/releases/[0-9a-fA-F]{40}$ ]] || [[ ! -f $env_file ]]; then
  echo "CURRENT_RELEASE_PATH_NOT_CANONICAL" >&2
  exit 1
fi
if [[ ! $recovery_sha =~ ^[0-9a-f]{40}$ || ! -d $recovery_release || $(readlink -f "$recovery_release") != "$recovery_release" ]]; then echo "RECOVERY_RELEASE_REQUIRED" >&2; exit 1; fi

compose_file="$release_dir/deploy/vps/compose.pilot.yaml"
images_file="$release_dir/deploy/vps/compose.images.yaml"
observability_file="$release_dir/deploy/vps/compose.observability.yaml"
backup_script="$release_dir/scripts/backup-production.sh"
provenance_script="$release_dir/deploy/vps/verify-image-provenance.sh"
for file in "$compose_file" "$images_file" "$observability_file" "$backup_script" "$provenance_script"; do
  if [[ ! -f $file ]]; then echo "DEPLOY_FILE_REQUIRED:$file" >&2; exit 1; fi
done
for tool in docker python3 tar sha256sum curl readlink; do
  if ! command -v "$tool" >/dev/null 2>&1; then echo "DEPLOY_TOOL_REQUIRED:$tool" >&2; exit 1; fi
done

read_env_key() {
  python3 - "$env_file" "$1" <<'PY'
import json, pathlib, re, sys
path, key = pathlib.Path(sys.argv[1]), sys.argv[2]
matches = []
for line in path.read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(rf"{re.escape(key)}=(.*)", line)
    if match: matches.append(match.group(1).strip())
if len(matches) != 1: raise SystemExit(1)
value = matches[0]
if len(value) >= 2 and value[0] == value[-1] == '"': value = json.loads(value)
if "\n" in value or "\r" in value: raise SystemExit(1)
print(value, end="")
PY
}

target_migration_id=$(python3 - "$release_dir/packages/db/drizzle/meta/_journal.json" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1], encoding="utf-8")).get("entries", [])
if not entries or not isinstance(entries[-1].get("tag"), str): raise SystemExit(1)
print(entries[-1]["tag"], end="")
PY
)
if [[ ! $target_migration_id =~ ^[0-9]{4}_[A-Za-z0-9_.-]+$ ]]; then
  echo "TARGET_MIGRATION_INVALID" >&2
  exit 1
fi

postgres_id=$(docker ps --filter label=com.docker.compose.project=giromesa-v2-pilot \
  --filter label=com.docker.compose.service=postgres --format '{{.ID}}' --no-trunc)
if [[ ! $postgres_id =~ ^[0-9a-f]{64}$ ]] || [[ $(docker inspect --format '{{.State.Health.Status}}' "$postgres_id") != healthy ]]; then
  echo "RUNNING_POSTGRES_REQUIRED_BEFORE_BACKUP" >&2
  exit 1
fi
postgres_user=$(read_env_key POSTGRES_USER)
postgres_database=$(read_env_key POSTGRES_DB)
applied_migration_at=$(docker exec "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --set ON_ERROR_STOP=1 --tuples-only --no-align --command "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1")
applied_migration_at=${applied_migration_at//$'\r'/}
applied_migration_at=${applied_migration_at//$'\n'/}
source_migration_id=$(python3 - "$release_dir/packages/db/drizzle/meta/_journal.json" "$applied_migration_at" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1], encoding="utf-8")).get("entries", [])
matches = [entry.get("tag") for entry in entries if str(entry.get("when")) == sys.argv[2]]
if len(matches) != 1: raise SystemExit(1)
print(matches[0], end="")
PY
)
recovery_migration_id=$(python3 - "$recovery_release/packages/db/drizzle/meta/_journal.json" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1], encoding="utf-8")).get("entries", [])
if not entries or not isinstance(entries[-1].get("tag"), str): raise SystemExit(1)
print(entries[-1]["tag"], end="")
PY
)
recovery_matrix="$release_dir/deploy/vps/recovery-compatibility.json"
python3 - "$recovery_matrix" "$source_migration_id" "$target_migration_id" "$recovery_migration_id" "$recovery_sha" <<'PY'
import json, re, sys
value=json.load(open(sys.argv[1],encoding="utf-8"))
valid=value.get("schemaVersion")==1 and value.get("targetMigration")=="0029_platform_incident_projection_actions" and any(
    item.get("appliedBefore")==sys.argv[2]
    and item.get("appliedAfter")==sys.argv[3]
    and item.get("recoveryMigration")==sys.argv[4]
    and item.get("recoveryArtifact")==f"git:{sys.argv[5]}"
    and item.get("testedUpgrade") is True
    and isinstance(item.get("evidence"),dict)
    and re.fullmatch(r"https://github\.com/pendevtsp-star/giro-mesa-v2/actions/runs/[0-9]+",item["evidence"].get("workflowRun",""))
    and re.fullmatch(r"sha256:[0-9a-f]{64}",item["evidence"].get("testReportDigest",""))
    for item in value.get("transitions",[])
)
if not valid: raise SystemExit("RECOVERY_SCHEMA_COMPATIBILITY_UNPROVEN")
PY

attestation=${GIROMESA_IMAGE_ATTESTATION_FILE:-}
if [[ -z $attestation || ! -f $attestation || -L $attestation ]]; then echo "IMAGE_PROVENANCE_ATTESTATION_REQUIRED" >&2; exit 1; fi
recovery_attestation=${GIROMESA_RECOVERY_IMAGE_ATTESTATION_FILE:-}
if [[ -z $recovery_attestation || ! -f $recovery_attestation || -L $recovery_attestation ]]; then echo "RECOVERY_IMAGE_PROVENANCE_ATTESTATION_REQUIRED" >&2; exit 1; fi
target_attestation_bundle=${GIROMESA_IMAGE_ATTESTATION_BUNDLE_FILE:-${attestation}.bundle}
target_attestation_checksum=${GIROMESA_IMAGE_ATTESTATION_CHECKSUM_FILE:-${attestation}.sha256}
recovery_attestation_bundle=${GIROMESA_RECOVERY_IMAGE_ATTESTATION_BUNDLE_FILE:-${recovery_attestation}.bundle}
recovery_attestation_checksum=${GIROMESA_RECOVERY_IMAGE_ATTESTATION_CHECKSUM_FILE:-${recovery_attestation}.sha256}
for file in "$recovery_release/deploy/vps/compose.pilot.yaml" "$recovery_release/deploy/vps/compose.images.yaml" \
  "$recovery_release/deploy/vps/compose.observability.yaml" "$recovery_release/deploy/vps/verify-image-provenance.sh"; do
  [[ -f $file && ! -L $file ]] || { echo "RECOVERY_RELEASE_FILE_REQUIRED:$file" >&2; exit 1; }
done
mapfile -t image_values < <(python3 - "$attestation" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
by_service = {image.rsplit("-", 1)[-1].split("@", 1)[0]: image for image in value.get("images", [])}
for name in ("api", "worker", "site", "customer", "ops"): print(by_service.get(name, ""))
PY
)
for index in "${!image_values[@]}"; do image_values[index]=${image_values[index]%$'\r'}; done
export GIROMESA_API_IMAGE=${image_values[0]} GIROMESA_WORKER_IMAGE=${image_values[1]}
export GIROMESA_SITE_IMAGE=${image_values[2]} GIROMESA_CUSTOMER_IMAGE=${image_values[3]}
export GIROMESA_OPS_IMAGE=${image_values[4]}
export GIROMESA_POSTGRES_IMAGE=postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
export GIROMESA_RELEASE_ARTIFACT_SHA=$artifact_sha GIROMESA_IMAGE_ATTESTATION_FILE=$attestation
export GIROMESA_IMAGE_ATTESTATION_BUNDLE_FILE=$target_attestation_bundle GIROMESA_IMAGE_ATTESTATION_CHECKSUM_FILE=$target_attestation_checksum
export DOCKER_CONFIG=${GIROMESA_DOCKER_CONFIG_DIRECTORY:?GIROMESA_DOCKER_CONFIG_DIRECTORY_REQUIRED}
compose=(docker compose --env-file "$env_file" -f "$compose_file" -f "$images_file" -f "$observability_file")
"${compose[@]}" config --quiet
GIROMESA_PROVENANCE_REQUIRE_LOCAL_IMAGE=false "$provenance_script"
mapfile -t recovery_image_values < <(python3 - "$recovery_attestation" <<'PY'
import json, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))
by_service = {image.rsplit("-", 1)[-1].split("@", 1)[0]: image for image in value.get("images", [])}
for name in ("api", "worker", "site", "customer", "ops"): print(by_service.get(name, ""))
PY
)
for index in "${!recovery_image_values[@]}"; do recovery_image_values[index]=${recovery_image_values[index]%$'\r'}; done
export GIROMESA_RELEASE_ARTIFACT_SHA=$recovery_sha GIROMESA_IMAGE_ATTESTATION_FILE=$recovery_attestation GIROMESA_PROVENANCE_ROLE=recovery
export GIROMESA_IMAGE_ATTESTATION_BUNDLE_FILE=$recovery_attestation_bundle GIROMESA_IMAGE_ATTESTATION_CHECKSUM_FILE=$recovery_attestation_checksum
export GIROMESA_API_IMAGE=${recovery_image_values[0]} GIROMESA_WORKER_IMAGE=${recovery_image_values[1]}
export GIROMESA_SITE_IMAGE=${recovery_image_values[2]} GIROMESA_CUSTOMER_IMAGE=${recovery_image_values[3]}
export GIROMESA_OPS_IMAGE=${recovery_image_values[4]}
recovery_compose=(docker compose --env-file "$env_file" -f "$recovery_release/deploy/vps/compose.pilot.yaml" -f "$recovery_release/deploy/vps/compose.images.yaml" -f "$recovery_release/deploy/vps/compose.observability.yaml")
"${recovery_compose[@]}" config --quiet
GIROMESA_PROVENANCE_REQUIRE_LOCAL_IMAGE=false "$recovery_release/deploy/vps/verify-image-provenance.sh"
"${recovery_compose[@]}" pull
"$recovery_release/deploy/vps/verify-image-provenance.sh"
export GIROMESA_RELEASE_ARTIFACT_SHA=$artifact_sha GIROMESA_IMAGE_ATTESTATION_FILE=$attestation
export GIROMESA_PROVENANCE_ROLE=target
export GIROMESA_IMAGE_ATTESTATION_BUNDLE_FILE=$target_attestation_bundle GIROMESA_IMAGE_ATTESTATION_CHECKSUM_FILE=$target_attestation_checksum
export GIROMESA_API_IMAGE=${image_values[0]} GIROMESA_WORKER_IMAGE=${image_values[1]}
export GIROMESA_SITE_IMAGE=${image_values[2]} GIROMESA_CUSTOMER_IMAGE=${image_values[3]}
export GIROMESA_OPS_IMAGE=${image_values[4]}
if [[ -z ${GIROMESA_OBJECT_DIRECTORY:-} || ! -d ${GIROMESA_OBJECT_DIRECTORY:-} || -L ${GIROMESA_OBJECT_DIRECTORY:-} ]]; then
  echo "BACKUP_COMPLETE_COVERAGE_REQUIRED: database, objects and encrypted current configuration are mandatory" >&2
  exit 1
fi
export GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64
GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64=$(read_env_key GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64)
export GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64
GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64=$(read_env_key GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64)

mutators=()
source_artifact=""
source_component_images=()
for service in api worker; do
  id=$(docker ps --filter label=com.docker.compose.project=giromesa-v2-pilot \
    --filter "label=com.docker.compose.service=$service" --format '{{.ID}}' --no-trunc)
  if [[ ! $id =~ ^[0-9a-f]{64}$ ]]; then echo "RUNNING_MUTATOR_REQUIRED:$service" >&2; exit 1; fi
  mutators+=("$id")
  image_id=$(docker inspect --format '{{.Image}}' "$id")
  running_image=$(docker image inspect "$image_id" --format '{{json .RepoDigests}}' | python3 -c "import json,sys; values=json.load(sys.stdin); matches=[v for v in values if v.startswith('ghcr.io/pendevtsp-star/giro-mesa-v2-$service@sha256:')]; print(matches[0] if len(matches)==1 else '',end='')")
  [[ $running_image =~ @sha256:[0-9a-f]{64}$ ]] || { echo "RUNNING_RELEASE_IMAGE_NOT_IMMUTABLE:$service" >&2; exit 1; }
  source_component_images+=("$running_image")
done
source_artifact=$(printf '%s\n' "${source_component_images[@]}" | python3 -c 'import hashlib,json,sys; values=sorted(line.rstrip("\n") for line in sys.stdin if line.rstrip("\n")); print("runtime-set:sha256:"+hashlib.sha256(json.dumps(values,separators=(",",":" )).encode()).hexdigest(),end="")')
deployment_committed=0
mutators_stopped=0
recover_mutators() {
  if [[ $deployment_committed -eq 0 && $mutators_stopped -eq 1 ]]; then
    ln -sfn "$recovery_release" "$root/.current-next" && mv -Tf "$root/.current-next" "$root/current"
    export GIROMESA_RELEASE_ARTIFACT_SHA=$recovery_sha GIROMESA_IMAGE_ATTESTATION_FILE=$recovery_attestation GIROMESA_PROVENANCE_ROLE=recovery
    export GIROMESA_IMAGE_ATTESTATION_BUNDLE_FILE=$recovery_attestation_bundle GIROMESA_IMAGE_ATTESTATION_CHECKSUM_FILE=$recovery_attestation_checksum
    export GIROMESA_API_IMAGE=${recovery_image_values[0]} GIROMESA_WORKER_IMAGE=${recovery_image_values[1]}
    export GIROMESA_SITE_IMAGE=${recovery_image_values[2]} GIROMESA_CUSTOMER_IMAGE=${recovery_image_values[3]} GIROMESA_OPS_IMAGE=${recovery_image_values[4]}
    "${recovery_compose[@]}" up -d --remove-orphans >/dev/null 2>&1 || echo "RECOVERY_RELEASE_START_FAILED" >&2
  fi
}
trap recover_mutators EXIT
docker stop --timeout "${GIROMESA_DRAIN_SECONDS:-30}" "${mutators[@]}" >/dev/null
mutators_stopped=1

mkdir -p "$backup_dir"
chmod 700 "$root/shared" "$backup_dir"
backup_arguments=(
  --database-container "$postgres_id" --database-name "$postgres_database" --database-user "$postgres_user"
  --output-directory "$backup_dir" --source-artifact "$source_artifact"
  --source-migration-id "$source_migration_id" --target-artifact "$target_artifact"
  --target-migration-id "$target_migration_id"
  --object-directory "${GIROMESA_OBJECT_DIRECTORY:-}"
  --runtime-env-file "$env_file"
)
for image in "${source_component_images[@]}"; do backup_arguments+=(--source-component-image "$image"); done
backup=$("$backup_script" "${backup_arguments[@]}")
unset GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64
unset GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64
[[ -f $backup/manifest.json ]] || { echo "BACKUP_MANIFEST_MISSING" >&2; exit 1; }

"${compose[@]}" pull
"$provenance_script"
"${compose[@]}" up -d postgres
postgres_id=$("${compose[@]}" ps -q postgres)
[[ $(docker inspect --format '{{.State.Health.Status}}' "$postgres_id") == healthy ]] || { echo "POSTGRES_UPDATE_UNHEALTHY" >&2; exit 1; }
"${compose[@]}" --profile tools run --rm migrate
ln -sfn "$release_dir" "$root/.current-next"
mv -Tf "$root/.current-next" "$root/current"
"${compose[@]}" up -d --remove-orphans

for service in api worker site customer ops; do
  container_id=$("${compose[@]}" ps -q "$service")
  for _ in $(seq 1 30); do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
    [[ $status == healthy ]] && break
    sleep 2
  done
  [[ $status == healthy ]] || { echo "SERVICE_UNHEALTHY:$service" >&2; exit 1; }
done

stability_seconds=${GIROMESA_STABILITY_SECONDS:-15}
if [[ ! $stability_seconds =~ ^[0-9]+$ ]] || ((stability_seconds < 5)); then
  echo "STABILITY_WINDOW_INVALID" >&2
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
    echo "SERVICE_UNSTABLE:$service" >&2
    exit 1
  fi
done

probe_id=$(docker exec "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" --set ON_ERROR_STOP=1 \
  --quiet --tuples-only --no-align --command "WITH inserted AS (INSERT INTO outbox_events(topic,aggregate_type,aggregate_id,payload) VALUES ('system.worker_probe','system','deploy', '{}'::jsonb) RETURNING id) SELECT id FROM inserted")
probe_id=${probe_id//$'\r'/}; probe_id=${probe_id//$'\n'/}
for _ in $(seq 1 30); do
  processed=$(docker exec "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align \
    --command "SELECT processed_at IS NOT NULL FROM outbox_events WHERE id = '$probe_id'::uuid")
  processed=${processed//$'\r'/}; processed=${processed//$'\n'/}
  [[ $processed == t ]] && break
  sleep 1
done
[[ $processed == t ]] || { echo "WORKER_QUEUE_SMOKE_FAILED:system.worker_probe" >&2; exit 1; }
docker exec "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" --set ON_ERROR_STOP=1 \
  --command "DELETE FROM outbox_events WHERE id = '$probe_id'::uuid" >/dev/null

curl --fail --silent --show-error http://127.0.0.1:3210/health >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3110/ >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3111/ >/dev/null
curl --fail --silent --show-error http://127.0.0.1:3112/health >/dev/null
deployment_committed=1
trap - EXIT
"${compose[@]}" ps
echo "Deploy concluído a partir de backup completo: $backup"
