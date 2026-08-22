#!/usr/bin/env bash
set -Eeuo pipefail

mode=${1-}
object_directory=${2-}
api_container=${3-}
worker_container=${4-}

if [[ $mode != source && $mode != shared ]] ||
  [[ -z $object_directory || ! -d $object_directory || -L $object_directory ]] ||
  [[ ! $api_container =~ ^[0-9a-f]{12,64}$ ]] ||
  { [[ $mode == shared ]] && [[ ! $worker_container =~ ^[0-9a-f]{12,64}$ ]]; }; then
  echo "FISCAL_STORAGE_ARGUMENT_INVALID" >&2
  exit 1
fi

object_directory=$(readlink -f -- "$object_directory")

mount_source() {
  docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/data/media"}}{{.Source}}{{"\n"}}{{end}}{{end}}' "$1"
}

assert_mount() {
  local container=$1 source
  source=$(mount_source "$container")
  source=${source%$'\n'}
  if [[ -z $source || $source == *$'\n'* || ! -d $source || $(readlink -f -- "$source") != "$object_directory" ]]; then
    echo "FISCAL_STORAGE_MOUNT_MISMATCH" >&2
    exit 1
  fi
}

assert_mount "$api_container"
[[ $mode == source ]] && exit 0
assert_mount "$worker_container"

probe=".storage-probe-$(python3 -c 'import secrets; print(secrets.token_hex(12), end="")')"
cleanup() {
  docker exec "$api_container" node -e '
    const fs = require("node:fs"); const path = require("node:path");
    if (process.env.MEDIA_ROOT === "/app/data/media")
      fs.rmSync(path.join(process.env.MEDIA_ROOT, "fiscal", process.argv[1]), { force: true });
  ' "$probe" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker exec "$api_container" node -e '
  const fs = require("node:fs"); const path = require("node:path");
  const root = process.env.MEDIA_ROOT;
  if (root !== "/app/data/media") process.exit(2);
  const directory = path.join(root, "fiscal");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, process.argv[1]), "giromesa-fiscal-storage-v1", { flag: "wx", mode: 0o600 });
' "$probe"

docker exec "$worker_container" node -e '
  const fs = require("node:fs"); const path = require("node:path");
  const root = process.env.MEDIA_ROOT;
  if (root !== "/app/data/media") process.exit(2);
  const value = fs.readFileSync(path.join(root, "fiscal", process.argv[1]), "utf8");
  if (value !== "giromesa-fiscal-storage-v1") process.exit(3);
' "$probe"

cleanup
trap - EXIT
echo "FISCAL_STORAGE_READY"
