#!/usr/bin/env bash
set -Eeuo pipefail

root=${GIROMESA_ROOT:-/srv/apps/giromesa-v2}
env_file=${GIROMESA_ENV_FILE:-$root/shared/.env}
target_sha=${ROLLBACK_RELEASE_SHA:-${1:-}}
current_link=$root/current
releases_root=$root/releases

if [[ ! $target_sha =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "ROLLBACK_RELEASE_SHA deve ser o SHA Git completo de uma release já instalada." >&2
  exit 1
fi
if [[ ! -L $current_link || ! -f $env_file ]]; then
  echo "ROLLBACK_CURRENT_RELEASE_INVALID" >&2
  exit 1
fi

current_release=$(readlink -f "$current_link")
target_candidate="$releases_root/$target_sha"
if [[ ! -d $target_candidate ]]; then
  echo "ROLLBACK_RELEASE_NOT_FOUND" >&2
  exit 1
fi
target_release=$(readlink -f "$target_candidate")
if [[ ${current_release%/*} != "$releases_root" ]] || [[ $target_release != "$target_candidate" ]]; then
  echo "ROLLBACK_RELEASE_PATH_INVALID" >&2
  exit 1
fi
if [[ ! -f $target_release/deploy/vps/compose.pilot.yaml ]]; then
  echo "ROLLBACK_RELEASE_NOT_FOUND" >&2
  exit 1
fi
current_sha=$(basename "$current_release")
if [[ $current_sha == "$target_sha" ]]; then
  echo "ROLLBACK_TARGET_ALREADY_CURRENT" >&2
  exit 1
fi

if [[ ${ROLLBACK_COMPATIBILITY_APPROVED:-} != true ]]; then
  echo "ROLLBACK_COMPATIBILITY_APPROVED=true é obrigatório após revisão operacional." >&2
  exit 1
fi
latest_migration() {
  python3 - "$1/packages/db/drizzle/meta/_journal.json" <<'PY'
import json, sys
entries = json.load(open(sys.argv[1], encoding="utf-8")).get("entries", [])
if not entries or not isinstance(entries[-1].get("tag"), str):
    raise SystemExit(1)
print(entries[-1]["tag"], end="")
PY
}
current_migration=$(latest_migration "$current_release")
target_migration=$(latest_migration "$target_release")
if [[ $current_migration != "$target_migration" ]]; then
  echo "ROLLBACK_DATABASE_COMPATIBILITY_UNPROVEN: application rollback never restores the database" >&2
  exit 1
fi

compose_file=$target_release/deploy/vps/compose.pilot.yaml
export GIROMESA_IMAGE_TAG="$target_sha"
compose=(docker compose --env-file "$env_file" -f "$compose_file")
restore_previous_release() {
  ln -sfn "$current_release" "$root/.current-next"
  mv -Tf "$root/.current-next" "$current_link"
  export GIROMESA_IMAGE_TAG="$current_sha"
  docker compose --env-file "$env_file" -f "$current_release/deploy/vps/compose.pilot.yaml" up -d --remove-orphans
}

ln -sfn "$target_release" "$root/.current-next"
mv -Tf "$root/.current-next" "$current_link"
if ! "${compose[@]}" up -d --remove-orphans; then
  if ! restore_previous_release; then
    echo "ROLLBACK_RECOVERY_FAILED: current link restored but previous containers need manual recovery" >&2
  fi
  echo "ROLLBACK_APPLICATION_START_FAILED" >&2
  exit 1
fi

for endpoint in http://127.0.0.1:3210/health http://127.0.0.1:3110/ http://127.0.0.1:3111/ http://127.0.0.1:3112/health; do
  if ! curl --fail --silent --show-error "$endpoint" >/dev/null; then
    if ! restore_previous_release; then
      echo "ROLLBACK_RECOVERY_FAILED: current link restored but previous containers need manual recovery" >&2
    fi
    echo "ROLLBACK_APPLICATION_SMOKE_FAILED" >&2
    exit 1
  fi
done

evidence="$root/shared/rollback-app.json"
python3 - "$evidence" "git:$current_sha" "git:$target_sha" "$current_migration" <<'PY'
import datetime, json, os, sys, tempfile
path, previous, target, migration = sys.argv[1:]
value = {
    "schemaVersion": 1,
    "previousArtifact": previous,
    "targetArtifact": target,
    "migrationId": migration,
    "databaseRestored": False,
    "completedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "smoke": "passed",
}
fd, temporary = tempfile.mkstemp(prefix="rollback-app.", dir=os.path.dirname(path))
with os.fdopen(fd, "w", encoding="utf-8") as handle:
    json.dump(value, handle, indent=2)
    handle.write("\n")
os.chmod(temporary, 0o600)
os.replace(temporary, path)
PY
echo "Rollback de aplicação concluído sem restaurar banco. Evidência: $evidence"
