#!/usr/bin/env bash
set -Eeuo pipefail
[[ ${GIROMESA_TRUST_BOOTSTRAP_VERIFIED:-} == true ]] || { echo "TRUST_BOOTSTRAP_REQUIRED" >&2; exit 1; }

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
if [[ ! $current_release =~ ^$root/releases/[0-9a-fA-F]{40}$ ]] || [[ ! -f $env_file || -L $env_file ]]; then
  echo "CURRENT_RELEASE_PATH_NOT_CANONICAL" >&2
  exit 1
fi
env_mode=$(stat -c '%a' "$env_file"); env_uid=$(stat -c '%u' "$env_file")
[[ $env_mode == 600 && $env_uid == $(id -u) ]] || { echo "RUNTIME_ENV_PERMISSIONS_INVALID" >&2; exit 1; }
if [[ ! $recovery_sha =~ ^[0-9a-f]{40}$ || ! -d $recovery_release || $(readlink -f "$recovery_release") != "$recovery_release" ]]; then echo "RECOVERY_RELEASE_REQUIRED" >&2; exit 1; fi

compose_file="$release_dir/deploy/vps/compose.pilot.yaml"
images_file="$release_dir/deploy/vps/compose.images.yaml"
observability_file="$release_dir/deploy/vps/compose.observability.yaml"
backup_script="$release_dir/scripts/backup-production.sh"
fiscal_storage_check="$release_dir/scripts/check-fiscal-storage.sh"
fiscal_schema_check="$release_dir/scripts/fiscal-production-smoke.sql"
fiscal_release_manifest="$release_dir/config/fiscal-release.json"
release_package="$release_dir/package.json"
provenance_script="$release_dir/deploy/vps/verify-image-provenance.sh"
for file in "$compose_file" "$images_file" "$observability_file" "$backup_script" "$fiscal_storage_check" "$fiscal_schema_check" "$fiscal_release_manifest" "$release_package" "$provenance_script"; do
  if [[ ! -f $file ]]; then echo "DEPLOY_FILE_REQUIRED:$file" >&2; exit 1; fi
done
for tool in docker python3 tar sha256sum curl readlink awk; do
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

installer_host_path=$(read_env_key EDGE_HUB_INSTALLER_HOST_PATH)
expected_installer_host_path=$root/shared/edge-hub-installer
if [[ $installer_host_path != "$expected_installer_host_path" ]]; then
  echo "EDGE_HUB_INSTALLER_HOST_PATH_INVALID" >&2
  exit 1
fi
mkdir -p "$installer_host_path"
chmod 750 "$installer_host_path"
installer_version=$(read_env_key EDGE_HUB_WINDOWS_INSTALLER_VERSION)
installer_sha256=$(read_env_key EDGE_HUB_WINDOWS_INSTALLER_SHA256)
installer_organizations=$(read_env_key EDGE_HUB_PILOT_ORGANIZATION_IDS)
if [[ -n $installer_version || -n $installer_sha256 || -n $installer_organizations ]]; then
  installer_file=$installer_host_path/GiroMesa-Conector-Setup.exe
  [[ -f $installer_file && ! -L $installer_file ]] || { echo "EDGE_HUB_INSTALLER_FILE_REQUIRED" >&2; exit 1; }
  actual_installer_sha256=$(sha256sum "$installer_file" | awk '{print $1}')
  [[ $actual_installer_sha256 == "${installer_sha256,,}" ]] || { echo "EDGE_HUB_INSTALLER_SHA256_MISMATCH" >&2; exit 1; }
fi

python3 - "$fiscal_release_manifest" "$release_package" "$env_file" <<'PY'
import base64, datetime, json, pathlib, re, sys

manifest_path, package_path, env_path = map(pathlib.Path, sys.argv[1:])
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
package = json.loads(package_path.read_text(encoding="utf-8"))
entries = {}
for line in env_path.read_text(encoding="utf-8").splitlines():
    match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
    if not match:
        continue
    key, raw = match.groups()
    if key in entries:
        raise SystemExit(f"FISCAL_RELEASE_ENV_DUPLICATE:{key}")
    raw = raw.strip()
    if len(raw) >= 2 and raw[0] == raw[-1] == '"':
        try:
            raw = json.loads(raw)
        except Exception as error:
            raise SystemExit(f"FISCAL_RELEASE_ENV_VALUE_INVALID:{key}") from error
    entries[key] = raw

mode = entries.get("FISCAL_RELEASE_ENV")
if mode not in {"homologation", "production"}:
    raise SystemExit("FISCAL_RELEASE_ENV_INVALID")
base_valid = (
    manifest.get("schemaVersion") == 1
    and manifest.get("moduleVersion") == package.get("version")
    and manifest.get("provider") == "focus"
    and manifest.get("status") in {"blocked", "homologated"}
)
if not base_valid:
    raise SystemExit("FISCAL_RELEASE_MANIFEST_INVALID")
if mode == "homologation":
    valid = (
        manifest.get("status") == "blocked"
        and manifest.get("environment") == "homologation"
        and manifest.get("scope") is None
        and manifest.get("evidence") is None
        and manifest.get("homologatedAt") is None
        and isinstance(manifest.get("blockers"), list)
        and bool(manifest["blockers"])
        and all(isinstance(item, str) and item.strip() for item in manifest["blockers"])
    )
    if not valid:
        raise SystemExit("FISCAL_HOMOLOGATION_FAIL_CLOSED")
    raise SystemExit(0)

scope = manifest.get("scope")
evidence = manifest.get("evidence")
evidence_names = {
    "focusApproval", "sefazAuthorization", "consultation", "cancellation",
    "numberInvalidation", "artifactVerification", "rollbackRun",
}
immutable = re.compile(r"^(?:(?:git:)?[0-9a-f]{40}|(?:[\w./:-]+@)?sha256:[0-9a-f]{64})$", re.I)
key = entries.get("FISCAL_CREDENTIALS_ENCRYPTION_KEY", "")
try:
    key_valid = len(base64.b64decode(key, validate=True)) == 32
except Exception:
    key_valid = False
try:
    datetime.datetime.fromisoformat(manifest.get("homologatedAt", "").replace("Z", "+00:00"))
    homologated_at_valid = True
except (AttributeError, TypeError, ValueError):
    homologated_at_valid = False
valid = (
    manifest.get("status") == "homologated"
    and manifest.get("environment") == "production"
    and isinstance(scope, dict)
    and isinstance(scope.get("uf"), str)
    and re.fullmatch(r"[A-Z]{2}", scope["uf"])
    and isinstance(scope.get("nfceSeries"), str)
    and re.fullmatch(r"\d+", scope["nfceSeries"])
    and isinstance(scope.get("issuerDocumentSha256"), str)
    and re.fullmatch(r"[0-9a-f]{64}", scope["issuerDocumentSha256"], re.I)
    and isinstance(evidence, dict)
    and set(evidence) == evidence_names
    and all(isinstance(value, str) and immutable.fullmatch(value) for value in evidence.values())
    and homologated_at_valid
    and manifest.get("blockers") == []
    and bool(entries.get("FOCUS_NFE_PRIMARY_TOKEN", "").strip())
    and key_valid
    and entries.get("MEDIA_ROOT") == "/app/data/media"
    and entries.get("ACCOUNTANT_ATTACHMENT_SCAN_MODE") == "clamd"
    and bool(entries.get("ACCOUNTANT_ATTACHMENT_CLAMD_HOST", "").strip())
    and entries.get("ACCOUNTANT_ATTACHMENT_CLAMD_PORT", "").isdigit()
    and 1 <= int(entries["ACCOUNTANT_ATTACHMENT_CLAMD_PORT"]) <= 65535
    and entries.get("ACCOUNTANT_ATTACHMENT_SCAN_TIMEOUT_MS", "").isdigit()
    and 1000 <= int(entries["ACCOUNTANT_ATTACHMENT_SCAN_TIMEOUT_MS"]) <= 30000
    and entries.get("ACCOUNTANT_ATTACHMENT_RETENTION_DAYS", "").isdigit()
    and int(entries["ACCOUNTANT_ATTACHMENT_RETENTION_DAYS"]) >= 1827
)
if not valid:
    raise SystemExit("FISCAL_PRODUCTION_HOMOLOGATION_REQUIRED")
PY

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
recovery_matrix="$release_dir/deploy/vps/recovery-compatibility.json"
source_migration_id=$(python3 - "$release_dir/packages/db/drizzle/meta/_journal.json" "$recovery_matrix" "$applied_migration_at" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1], encoding="utf-8")).get("entries", [])
matches = [entry.get("tag") for entry in entries if str(entry.get("when")) == sys.argv[3]]
if not matches:
    matrix = json.load(open(sys.argv[2], encoding="utf-8"))
    matches = [item.get("appliedBefore") for item in matrix.get("transitions", []) if str(item.get("appliedBeforeWhen")) == sys.argv[3]]
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
python3 - "$recovery_matrix" "$source_migration_id" "$applied_migration_at" "$target_migration_id" "$recovery_migration_id" "$recovery_sha" <<'PY'
import json, re, sys
value=json.load(open(sys.argv[1],encoding="utf-8"))
valid=value.get("schemaVersion")==1 and value.get("targetMigration")==sys.argv[4] and any(
    item.get("appliedBefore")==sys.argv[2]
    and str(item.get("appliedBeforeWhen"))==sys.argv[3]
    and item.get("appliedAfter")==sys.argv[4]
    and item.get("recoveryMigration")==sys.argv[5]
    and item.get("recoveryArtifact")==f"git:{sys.argv[6]}"
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
export GIROMESA_CLAMAV_IMAGE=clamav/clamav-debian@sha256:967334b92d1782e4d1314ddf903ae537d26792d21c9a39adecb8ac9757980514
export GIROMESA_RELEASE_ARTIFACT_SHA=$artifact_sha GIROMESA_IMAGE_ATTESTATION_FILE=$attestation
export GIROMESA_RELEASE_DIRECTORY=$release_dir
export GIROMESA_IMAGE_ATTESTATION_BUNDLE_FILE=$target_attestation_bundle GIROMESA_IMAGE_ATTESTATION_CHECKSUM_FILE=$target_attestation_checksum
export DOCKER_CONFIG=${GIROMESA_DOCKER_CONFIG_DIRECTORY:?GIROMESA_DOCKER_CONFIG_DIRECTORY_REQUIRED}
compose=(docker compose --project-name giromesa-v2-pilot --env-file "$env_file" -f "$compose_file" -f "$images_file" -f "$observability_file")
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
export GIROMESA_RELEASE_ARTIFACT_SHA=$recovery_sha GIROMESA_IMAGE_ATTESTATION_FILE=$recovery_attestation GIROMESA_EXPECTED_PROVENANCE_ROLE=recovery
export GIROMESA_RELEASE_DIRECTORY=$recovery_release
export GIROMESA_IMAGE_ATTESTATION_BUNDLE_FILE=$recovery_attestation_bundle GIROMESA_IMAGE_ATTESTATION_CHECKSUM_FILE=$recovery_attestation_checksum
export GIROMESA_API_IMAGE=${recovery_image_values[0]} GIROMESA_WORKER_IMAGE=${recovery_image_values[1]}
export GIROMESA_SITE_IMAGE=${recovery_image_values[2]} GIROMESA_CUSTOMER_IMAGE=${recovery_image_values[3]}
export GIROMESA_OPS_IMAGE=${recovery_image_values[4]}
recovery_compose=(docker compose --project-name giromesa-v2-pilot --env-file "$env_file" -f "$recovery_release/deploy/vps/compose.pilot.yaml" -f "$recovery_release/deploy/vps/compose.images.yaml" -f "$recovery_release/deploy/vps/compose.observability.yaml")
"${recovery_compose[@]}" config --quiet
GIROMESA_PROVENANCE_REQUIRE_LOCAL_IMAGE=false "$provenance_script"
"${recovery_compose[@]}" pull
"$provenance_script"
export GIROMESA_RELEASE_ARTIFACT_SHA=$artifact_sha GIROMESA_IMAGE_ATTESTATION_FILE=$attestation
export GIROMESA_RELEASE_DIRECTORY=$release_dir
export GIROMESA_EXPECTED_PROVENANCE_ROLE=target
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
source_api_id=""
source_artifact=""
source_component_images=()
for service in api worker; do
  id=$(docker ps --filter label=com.docker.compose.project=giromesa-v2-pilot \
    --filter "label=com.docker.compose.service=$service" --format '{{.ID}}' --no-trunc)
  if [[ ! $id =~ ^[0-9a-f]{64}$ ]]; then echo "RUNNING_MUTATOR_REQUIRED:$service" >&2; exit 1; fi
  mutators+=("$id")
  if [[ $service == api ]]; then source_api_id=$id; fi
  image_id=$(docker inspect --format '{{.Image}}' "$id")
  running_image=$(docker image inspect "$image_id" --format '{{json .RepoDigests}}' | python3 -c "import json,sys; values=json.load(sys.stdin); matches=[v for v in values if v.startswith('ghcr.io/pendevtsp-star/giro-mesa-v2-$service@sha256:')]; print(matches[0] if len(matches)==1 else '',end='')")
  [[ $running_image =~ @sha256:[0-9a-f]{64}$ ]] || { echo "RUNNING_RELEASE_IMAGE_NOT_IMMUTABLE:$service" >&2; exit 1; }
  source_component_images+=("$running_image")
done
source_artifact=$(printf '%s\n' "${source_component_images[@]}" | python3 -c 'import hashlib,json,sys; values=sorted(line.rstrip("\n") for line in sys.stdin if line.rstrip("\n")); print("runtime-set:sha256:"+hashlib.sha256(json.dumps(values,separators=(",",":" )).encode()).hexdigest(),end="")')
bash "$fiscal_storage_check" source "$GIROMESA_OBJECT_DIRECTORY" "$source_api_id"
deployment_committed=0
mutators_stopped=0
recover_mutators() {
  if [[ $deployment_committed -eq 0 && $mutators_stopped -eq 1 ]]; then
    current_applied_at=$(docker exec "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" \
      --tuples-only --no-align --command "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1" 2>/dev/null || true)
    current_applied_at=${current_applied_at//$'\r'/}; current_applied_at=${current_applied_at//$'\n'/}
    if [[ $current_applied_at == "$applied_migration_at" ]]; then
      docker start "${mutators[@]}" >/dev/null
      for container_id in "${mutators[@]}"; do
        status=
        for _ in $(seq 1 30); do
          status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
          [[ $status == healthy || $status == running ]] && break
          sleep 2
        done
        [[ $status == healthy || $status == running ]] || { echo "SOURCE_RELEASE_RESTART_FAILED" >&2; return 97; }
      done
      echo "SOURCE_RELEASE_RESTORED_BEFORE_MIGRATION" >&2
      return 0
    fi
    export GIROMESA_RELEASE_ARTIFACT_SHA=$recovery_sha GIROMESA_IMAGE_ATTESTATION_FILE=$recovery_attestation GIROMESA_EXPECTED_PROVENANCE_ROLE=recovery
    export GIROMESA_IMAGE_ATTESTATION_BUNDLE_FILE=$recovery_attestation_bundle GIROMESA_IMAGE_ATTESTATION_CHECKSUM_FILE=$recovery_attestation_checksum
    export GIROMESA_API_IMAGE=${recovery_image_values[0]} GIROMESA_WORKER_IMAGE=${recovery_image_values[1]}
    export GIROMESA_SITE_IMAGE=${recovery_image_values[2]} GIROMESA_CUSTOMER_IMAGE=${recovery_image_values[3]} GIROMESA_OPS_IMAGE=${recovery_image_values[4]}
    if ! "${recovery_compose[@]}" up -d --remove-orphans; then
      echo "RECOVERY_RELEASE_START_FAILED" >&2
      return 97
    fi
    for service in api worker site customer ops; do
      container_id=$("${recovery_compose[@]}" ps -q "$service")
      status=
      for _ in $(seq 1 30); do
        status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)
        [[ $status == healthy ]] && break
        sleep 2
      done
      [[ $status == healthy ]] || { echo "RECOVERY_RELEASE_UNHEALTHY:$service" >&2; return 97; }
    done
    declare -A recovery_restarts=()
    for service in api worker site customer ops; do
      container_id=$("${recovery_compose[@]}" ps -q "$service")
      recovery_restarts[$service]=$(docker inspect --format '{{.RestartCount}}' "$container_id")
    done
    sleep "${GIROMESA_RECOVERY_STABILITY_SECONDS:-5}"
    for service in api worker site customer ops; do
      container_id=$("${recovery_compose[@]}" ps -q "$service")
      status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id")
      [[ $status == healthy && $(docker inspect --format '{{.RestartCount}}' "$container_id") == "${recovery_restarts[$service]}" ]] || { echo "RECOVERY_RELEASE_UNSTABLE:$service" >&2; return 97; }
    done
    recovery_postgres_id=$("${recovery_compose[@]}" ps -q postgres)
    recovery_probe=$(docker exec "$recovery_postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" --set ON_ERROR_STOP=1 --quiet --tuples-only --no-align --command "WITH inserted AS (INSERT INTO outbox_events(topic,aggregate_type,aggregate_id,payload) VALUES ('system.worker_probe','system','deploy-recovery','{}'::jsonb) RETURNING id) SELECT id FROM inserted")
    recovery_probe=${recovery_probe//$'\r'/}; recovery_probe=${recovery_probe//$'\n'/}
    recovery_processed=
    for _ in $(seq 1 30); do
      recovery_processed=$(docker exec "$recovery_postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" --tuples-only --no-align --command "SELECT processed_at IS NOT NULL FROM outbox_events WHERE id = '$recovery_probe'::uuid")
      recovery_processed=${recovery_processed//$'\r'/}; recovery_processed=${recovery_processed//$'\n'/}
      [[ $recovery_processed == t ]] && break
      sleep 1
    done
    [[ $recovery_processed == t ]] || { echo "RECOVERY_WORKER_QUEUE_SMOKE_FAILED" >&2; return 97; }
    docker exec "$recovery_postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" --set ON_ERROR_STOP=1 --command "DELETE FROM outbox_events WHERE id = '$recovery_probe'::uuid" >/dev/null
    ln -sfn "$recovery_release" "$root/.current-next" && mv -Tf "$root/.current-next" "$root/current"
    python3 - "$root/shared/deploy-recovery.json" "git:$artifact_sha" "git:$recovery_sha" <<'PY'
import datetime,json,os,pathlib,sys,tempfile
destination=pathlib.Path(sys.argv[1]); value={"schemaVersion":1,"failedArtifact":sys.argv[2],"recoveryArtifact":sys.argv[3],"completedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"health":"passed"}
fd,temporary=tempfile.mkstemp(prefix="deploy-recovery.",dir=destination.parent)
with os.fdopen(fd,"w",encoding="utf-8") as handle: json.dump(value,handle,sort_keys=True); handle.write("\n"); handle.flush(); os.fsync(handle.fileno())
os.chmod(temporary,0o600); os.replace(temporary,destination)
PY
  fi
}
trap recover_mutators EXIT

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

docker stop --timeout "${GIROMESA_DRAIN_SECONDS:-30}" "${mutators[@]}" >/dev/null
mutators_stopped=1

"${compose[@]}" pull
"$provenance_script"
"${compose[@]}" up -d postgres
postgres_id=$("${compose[@]}" ps -q postgres)
postgres_status=
for _ in $(seq 1 30); do
  postgres_status=$(docker inspect --format '{{.State.Health.Status}}' "$postgres_id" 2>/dev/null || true)
  [[ $postgres_status == healthy ]] && break
  sleep 2
done
[[ $postgres_status == healthy ]] || { echo "POSTGRES_UPDATE_UNHEALTHY" >&2; exit 1; }
"${compose[@]}" --profile tools run --rm migrate
docker exec -i "$postgres_id" psql --username "$postgres_user" --dbname "$postgres_database" \
  --set ON_ERROR_STOP=1 --quiet < "$fiscal_schema_check"
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

bash "$fiscal_storage_check" shared "$GIROMESA_OBJECT_DIRECTORY" \
  "$("${compose[@]}" ps -q api)" "$("${compose[@]}" ps -q worker)"

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
ln -sfn "$release_dir" "$root/.current-next"
mv -Tf "$root/.current-next" "$root/current"
deployment_committed=1
trap - EXIT
"${compose[@]}" ps
echo "Deploy concluído a partir de backup completo: $backup"
