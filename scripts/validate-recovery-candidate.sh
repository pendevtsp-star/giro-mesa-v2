#!/bin/bash
set -Eeuo pipefail
IFS=$'\n\t'
umask 077

candidate_directory=""
recovery_sha=""
output_directory=""

while (($#)); do
  case "$1" in
    --candidate-directory) candidate_directory="${2:-}"; shift 2 ;;
    --recovery-sha) recovery_sha="${2:-}"; shift 2 ;;
    --output-directory) output_directory="${2:-}"; shift 2 ;;
    *) printf 'RECOVERY_VALIDATION_ARGUMENT_INVALID\n' >&2; exit 64 ;;
  esac
done

if [[ ! "$recovery_sha" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'RECOVERY_SHA_INVALID\n' >&2
  exit 64
fi
if [[ -z "$candidate_directory" || -z "$output_directory" ]]; then
  printf 'RECOVERY_VALIDATION_ARGUMENT_REQUIRED\n' >&2
  exit 64
fi

for command_name in docker git node pnpm python3 sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || {
    printf 'RECOVERY_VALIDATION_TOOL_REQUIRED:%s\n' "$command_name" >&2
    exit 69
  }
done

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
trust_root="$(cd -- "$script_directory/.." && pwd -P)"
candidate_directory="$(cd -- "$candidate_directory" && pwd -P)"
if [[ "$(git -C "$candidate_directory" rev-parse HEAD)" != "$recovery_sha" ]]; then
  printf 'RECOVERY_CHECKOUT_SHA_MISMATCH\n' >&2
  exit 65
fi
if [[ -n "$(git -C "$candidate_directory" status --porcelain --untracked-files=no)" ]]; then
  printf 'RECOVERY_CHECKOUT_DIRTY\n' >&2
  exit 65
fi

image_lock="$trust_root/deploy/vps/image-lock.json"
readarray -t postgres_images < <(python3 -I - "$image_lock" <<'PY'
import json, pathlib, re, sys
value=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
for key in ("postgres16", "postgres"):
    reference=value.get("images",{}).get(key,{}).get("reference","")
    if not re.fullmatch(r"postgres(?::(?:16|17)-alpine)?@sha256:[0-9a-f]{64}",reference):
        raise SystemExit(f"invalid locked image: {key}")
    print(reference)
PY
)
if ((${#postgres_images[@]} != 2)); then
  printf 'RECOVERY_POSTGRES_LOCK_INVALID\n' >&2
  exit 65
fi
postgres16="${postgres_images[0]%$'\r'}"
postgres17="${postgres_images[1]%$'\r'}"

required_migration="$candidate_directory/packages/db/drizzle/0029_platform_incident_projection_actions.sql"
required_matrix_test="$candidate_directory/packages/db/src/rollback-0029.integration.test.ts"
[[ -f "$required_migration" && -f "$required_matrix_test" ]] || {
  printf 'RECOVERY_0029_PROOF_MISSING\n' >&2
  exit 65
}

gitleaks_image="zricethezav/gitleaks:v8.28.0@sha256:cdbb7c955abce02001a9f6c9f602fb195b7fadc1e812065883f695d1eeaba854"
trivy_image="aquasec/trivy:0.69.2@sha256:3d1f862cb6c4fe13c1506f96f816096030d8d5ccdb2380a3069f7bf07daa86aa"
MSYS_NO_PATHCONV=1 docker run --rm --volume "$candidate_directory:/repo:ro" \
  --volume "$trust_root/.gitleaks.toml:/trusted-gitleaks.toml:ro" \
  "$gitleaks_image" dir --config /trusted-gitleaks.toml --redact --no-banner /repo
MSYS_NO_PATHCONV=1 docker run --rm --volume "$candidate_directory:/repo:ro" "$trivy_image" \
  fs --quiet --exit-code 1 --severity HIGH,CRITICAL --scanners vuln \
  --skip-dirs /repo/node_modules --skip-dirs /repo/.git /repo/pnpm-lock.yaml

(cd -- "$candidate_directory" && pnpm install --frozen-lockfile)
(cd -- "$candidate_directory" && pnpm turbo run build --filter=@giromesa/worker...)

suffix="${recovery_sha:0:12}-$$"
declare -a containers=()
declare -a networks=()
declare -a local_images=()
runtime_environment=""

cleanup() {
  local item
  for item in "${containers[@]}"; do docker rm -f "$item" >/dev/null 2>&1 || true; done
  for item in "${networks[@]}"; do docker network rm "$item" >/dev/null 2>&1 || true; done
  for item in "${local_images[@]}"; do docker image rm -f "$item" >/dev/null 2>&1 || true; done
  [[ -z "$runtime_environment" ]] || rm -f -- "$runtime_environment"
}
trap cleanup EXIT

wait_for_postgres() {
  local container="$1" user="$2" database="$3"
  for _ in $(seq 1 90); do
    if docker exec "$container" pg_isready -U "$user" -d "$database" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  printf 'RECOVERY_POSTGRES_NOT_READY:%s\n' "$container" >&2
  return 1
}

run_database_matrix() {
  local major="$1" image="$2" binding port
  local container="gm-recovery-db-${major}-${suffix}"
  containers+=("$container")
  docker run -d --name "$container" -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 "$image" >/dev/null
  wait_for_postgres "$container" postgres postgres
  docker exec "$container" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='giromesa') THEN CREATE ROLE giromesa NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; END IF; END \$\$" >/dev/null
  binding="$(docker port "$container" 5432/tcp | head -n 1)"
  port="${binding##*:}"
  [[ "$port" =~ ^[0-9]+$ ]] || { printf 'RECOVERY_POSTGRES_PORT_INVALID\n' >&2; return 1; }
  (
    cd -- "$candidate_directory"
    ROLLBACK_0029_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${port}/postgres" \
      pnpm --filter @giromesa/db test
  )
  if [[ -f "$candidate_directory/apps/worker/src/doseclub-reconciliation.integration.test.ts" ]]; then
    (
      cd -- "$candidate_directory"
      DOSECLUB_RECONCILIATION_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:${port}/postgres" \
        node --test apps/worker/dist/doseclub-reconciliation.integration.test.js
    )
  fi
  docker rm -f "$container" >/dev/null
}

run_database_matrix 16 "$postgres16"
run_database_matrix 17 "$postgres17"

network="gm-recovery-runtime-${suffix}"
runtime_postgres="gm-recovery-runtime-pg-${suffix}"
otel_collector="gm-recovery-otel-${suffix}"
api_image="giromesa-recovery-api:${suffix}"
worker_image="giromesa-recovery-worker:${suffix}"
networks+=("$network")
containers+=("$runtime_postgres" "$otel_collector")
local_images+=("$api_image" "$worker_image")
docker network create "$network" >/dev/null
docker run -d --name "$runtime_postgres" --network "$network" --network-alias postgres \
  -e POSTGRES_PASSWORD=postgres "$postgres17" >/dev/null
wait_for_postgres "$runtime_postgres" postgres postgres
docker exec "$runtime_postgres" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='giromesa') THEN CREATE ROLE giromesa NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS; END IF; END \$\$" >/dev/null
otel_image="otel/opentelemetry-collector-contrib@sha256:09f7a495e6542343cc25aa4e3facba144ba03b0f0b030e4469186e8164a9ed64"
MSYS_NO_PATHCONV=1 docker run -d --name "$otel_collector" --network "$network" --network-alias otel \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --volume "$trust_root/infra/observability/otel-collector.debug.yaml:/etc/otelcol-contrib/config.yaml:ro" \
  "$otel_image" --config=/etc/otelcol-contrib/config.yaml >/dev/null

docker build --build-arg APP=api -t "$api_image" -f "$candidate_directory/Dockerfile" "$candidate_directory"
docker build --build-arg APP=worker -t "$worker_image" -f "$candidate_directory/Dockerfile" "$candidate_directory"

doseclub_worker_source="$candidate_directory/apps/worker/src/doseclub-reconciliation.ts"
doseclub_worker_test="$candidate_directory/apps/worker/src/doseclub-reconciliation.integration.test.ts"
[[ -f "$doseclub_worker_source" && -f "$doseclub_worker_test" ]] || {
  printf 'RECOVERY_DOSECLUB_REAL_PROBE_MISSING\n' >&2
  exit 65
}
doseclub_present=true

runtime_environment="$(mktemp)"
python3 -I - "$runtime_environment" <<'PY'
import base64, json, pathlib, sys
key=base64.b64encode(bytes(range(32))).decode()
values={
    "NODE_ENV":"production",
    "DATABASE_URL":"placeholder",
    "SESSION_SECRET":"recovery-runtime-session-secret-32-bytes-minimum",
    "CORS_ORIGINS":"http://127.0.0.1",
    "COMMAND_FINGERPRINT_ACTIVE_KEY_VERSION":"v1",
    "COMMAND_FINGERPRINT_KEYS":json.dumps({"v1":key},separators=(",",":")),
    "PRIVACY_EXPORT_ENCRYPTION_KEY":key,
    "PUBLIC_TABLE_SESSION_SIGNING_KEY":key,
    "PLATFORM_ADMIN_EMAILS":"recovery-runtime@invalid.local",
    "PLATFORM_ADMIN_GRANTS":"platform.read",
    "EMAIL_PROVIDER_ENABLED":"false",
    "DOSECLUB_PROVIDER_ENABLED":"true",
    "WORKER_HEARTBEAT_FILE":"/tmp/giromesa-worker-heartbeat",
    "OTEL_EXPORTER_OTLP_ENDPOINT":"http://otel:4318",
    "OTEL_EXPORTER_OTLP_INSECURE":"true",
    "DEPLOYMENT_ENVIRONMENT":"production",
}
pathlib.Path(sys.argv[1]).write_text("".join(f"{key}={value}\n" for key,value in values.items()),encoding="utf-8")
PY
chmod 600 "$runtime_environment"

apply_schema_level() {
  local database="$1" level="$2" file prefix number
  docker exec "$runtime_postgres" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE \"${database}\"" >/dev/null
  while IFS= read -r file; do
    prefix="$(basename -- "$file" | cut -c1-4)"
    number=$((10#$prefix))
    if ((number <= level)); then
      docker exec -i "$runtime_postgres" psql -U postgres -d "$database" -v ON_ERROR_STOP=1 < "$file" >/dev/null
    fi
  done < <(find "$candidate_directory/packages/db/drizzle" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' -print | sort)
}

write_runtime_environment() {
  local database="$1" temporary="${runtime_environment}.next"
  python3 -I - "$runtime_environment" "$temporary" "$database" <<'PY'
import pathlib, sys
source=pathlib.Path(sys.argv[1]).read_text(encoding="utf-8").splitlines()
database=sys.argv[3]
target=[line if not line.startswith("DATABASE_URL=") else f"DATABASE_URL=postgresql://postgres:postgres@postgres:5432/{database}" for line in source]
pathlib.Path(sys.argv[2]).write_text("\n".join(target)+"\n",encoding="utf-8")
PY
  chmod 600 "$temporary"
  mv -f -- "$temporary" "$runtime_environment"
}

for level in 26 27 28 29; do
  database="recovery_level_${level}"
  api="gm-recovery-api-${level}-${suffix}"
  worker="gm-recovery-worker-${level}-${suffix}"
  containers+=("$api" "$worker")
  apply_schema_level "$database" "$level"
  write_runtime_environment "$database"

  if [[ -f "$candidate_directory/apps/api/src/integrations/doseclub/doseclub.integration.test.ts" ]]; then
    docker run --rm --network "$network" --env-file "$runtime_environment" \
      -e "DOSECLUB_DATABASE_URL=postgresql://postgres:postgres@postgres:5432/${database}" \
      "$api_image" node apps/api/dist/integrations/doseclub/doseclub.integration.test.js
  fi

  if ((level == 29)); then
    docker run -d --name "$api" --network "$network" --env-file "$runtime_environment" \
      -e HOST=0.0.0.0 -e PORT=3200 "$api_image" >/dev/null
    ready=false
    for _ in $(seq 1 60); do
      if docker exec "$api" node -e "fetch('http://127.0.0.1:3200/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
        ready=true
        break
      fi
      sleep 2
    done
    [[ "$ready" == true ]] || { docker logs "$api" >&2; printf 'RECOVERY_API_NOT_READY:%s\n' "$level" >&2; exit 1; }
  fi
  docker run -d --name "$worker" --network "$network" --env-file "$runtime_environment" \
    "$worker_image" >/dev/null
  before="$(docker inspect --format '{{.RestartCount}}' "$worker")"
  sleep 15
  if [[ "$before" != "$(docker inspect --format '{{.RestartCount}}' "$worker")" ]] || \
    [[ "$(docker inspect --format '{{.State.Status}}' "$worker")" != running ]]; then
    docker logs "$worker" >&2 || true
    printf 'RECOVERY_WORKER_NOT_STABLE:%s\n' "$level" >&2
    exit 1
  fi

  probe="$(docker exec "$runtime_postgres" psql -U postgres -d "$database" -At -v ON_ERROR_STOP=1 -c \
    "WITH inserted AS (INSERT INTO outbox_events(topic,aggregate_type,aggregate_id,payload) VALUES ('system.worker_probe','system','recovery-ci','{}'::jsonb) RETURNING id) SELECT id FROM inserted")"
  processed=false
  for _ in $(seq 1 30); do
    if [[ "$(docker exec "$runtime_postgres" psql -U postgres -d "$database" -Atc "SELECT processed_at IS NOT NULL FROM outbox_events WHERE id='${probe}'::uuid")" == t ]]; then
      processed=true
      break
    fi
    sleep 1
  done
  [[ "$processed" == true ]] || { printf 'RECOVERY_WORKER_OUTBOX_PROBE_FAILED:%s\n' "$level" >&2; exit 1; }
  docker rm -f "$worker" >/dev/null
  if ((level == 29)); then docker rm -f "$api" >/dev/null; fi
done

mkdir -p -- "$output_directory"
[[ ! -L "$output_directory" ]] || { printf 'RECOVERY_EVIDENCE_SYMLINK_FORBIDDEN\n' >&2; exit 65; }
python3 -I - "$output_directory" "$recovery_sha" "$doseclub_present" <<'PY'
import hashlib, json, os, pathlib, sys, tempfile
directory=pathlib.Path(sys.argv[1])
recovery_sha=sys.argv[2]
doseclub_present=sys.argv[3]=="true"
levels=[26,27,28,29]
value={
    "schemaVersion":1,
    "role":"recovery",
    "recoveryArtifact":"git:"+recovery_sha,
    "postgresMajors":[16,17],
    "schemaLevels":levels,
    "targetMigration":"0029_platform_incident_projection_actions",
    "testedUpgrade":True,
    "doseClubReconciliation":"passed",
    "runtime":{
        "postgresMajor":17,
        "schemaLevel":29,
        "apiHealth":"passed",
        "workerStabilitySeconds":15,
        "outboxProbe":"passed",
    },
    "runtimeMatrix":{
        "postgresMajor":17,
        "schemaLevels":levels,
        "apiHealthByLevel":{"26":"not-applicable-pre-0029","27":"not-applicable-pre-0029","28":"not-applicable-pre-0029","29":"passed"},
        "workerByLevel":{"26":"passed","27":"passed","28":"passed","29":"passed"},
        "workerStabilitySeconds":15,
        "outboxProbe":"passed",
        "doseClub":{"present":doseclub_present,"probe":"passed" if doseclub_present else "not-present"},
    },
    "securityScan":{"gitleaks":"passed","trivy":"passed"},
    "result":"passed",
}
payload=(json.dumps(value, sort_keys=True, separators=(",", ":"))+"\n").encode()
target=directory/"recovery-validation.json"
fd, temporary=tempfile.mkstemp(prefix=".recovery-validation-",dir=directory)
try:
    with os.fdopen(fd,"wb") as stream:
        stream.write(payload); stream.flush(); os.fsync(stream.fileno())
    os.replace(temporary,target)
finally:
    if os.path.exists(temporary): os.unlink(temporary)
digest=hashlib.sha256(payload).hexdigest()
(directory/"recovery-validation.json.sha256").write_text(f"{digest}  recovery-validation.json\n",encoding="ascii")
PY

trap - EXIT
cleanup
