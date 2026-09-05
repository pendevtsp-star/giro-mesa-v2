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
source_component_images=()
object_directory=""
runtime_env_file=""
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
    --source-component-image) source_component_images+=("${2-}"); shift 2 ;;
    --object-directory) object_directory=${2-}; shift 2 ;;
    --encrypted-config-archive) echo "BACKUP_PREBUILT_CONFIG_FORBIDDEN" >&2; exit 1 ;;
    --runtime-env-file) runtime_env_file=${2-}; shift 2 ;;
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
if [[ ! $source_artifact =~ ^(git:)?[0-9a-fA-F]{40}$ ]] && [[ ! $source_artifact =~ @sha256:[0-9a-fA-F]{64}$ ]] && [[ ! $source_artifact =~ ^runtime-set:sha256:[0-9a-f]{64}$ ]]; then
  echo "BACKUP_ARTIFACT_NOT_IMMUTABLE" >&2
  exit 1
fi
if [[ ! $target_artifact =~ ^(git:)?[0-9a-fA-F]{40}$ ]] && [[ ! $target_artifact =~ @sha256:[0-9a-fA-F]{64}$ ]]; then
  echo "BACKUP_ARTIFACT_NOT_IMMUTABLE" >&2
  exit 1
fi
if [[ $source_artifact == runtime-set:* ]]; then
  runtime_set_artifact=$(printf '%s\n' "${source_component_images[@]}" | python3 -c '
import hashlib,json,re,sys
values=[line.rstrip("\n") for line in sys.stdin if line.rstrip("\n")]
pattern=re.compile(r"^ghcr\.io/pendevtsp-star/giro-mesa-v2-(api|worker)@sha256:[0-9a-f]{64}$")
matches=[pattern.fullmatch(value) for value in values]
if len(values)!=2 or not all(matches) or {match.group(1) for match in matches}!={"api","worker"} or len(set(values))!=2:
    raise SystemExit("BACKUP_SOURCE_COMPONENTS_INVALID")
canonical=json.dumps(sorted(values),separators=(",",":"))
print("runtime-set:sha256:"+hashlib.sha256(canonical.encode()).hexdigest(),end="")') || { echo "BACKUP_SOURCE_COMPONENTS_INVALID" >&2; exit 1; }
  [[ $runtime_set_artifact == "$source_artifact" ]] || { echo "BACKUP_SOURCE_RUNTIME_SET_MISMATCH" >&2; exit 1; }
elif ((${#source_component_images[@]} != 0)); then
  echo "BACKUP_SOURCE_COMPONENTS_UNEXPECTED" >&2
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
if [[ -z $object_directory || -z $runtime_env_file ]]; then
  echo "BACKUP_COMPLETE_COVERAGE_REQUIRED" >&2
  exit 1
fi
if ! python3 - <<'PY'
import base64, os, sys
try: value = base64.b64decode(os.environ.get("GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64", ""), validate=True)
except Exception: value = b""
if len(value) != 32:
    print("BACKUP_CONFIG_ENCRYPTION_KEY_INVALID", file=sys.stderr); raise SystemExit(1)
PY
then exit 1; fi
if [[ ! -f $runtime_env_file || -L $runtime_env_file ]]; then
  echo "BACKUP_RUNTIME_ENV_INVALID" >&2
  exit 1
fi
if [[ ! $max_rpo_minutes =~ ^[1-5]$ ]]; then
  echo "BACKUP_RPO_INVALID" >&2
  exit 1
fi

for tool in docker sha256sum openssl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "BACKUP_TOOL_REQUIRED:$tool" >&2
    exit 1
  fi
done
if [[ -n $object_directory ]]; then
  if [[ ! -d $object_directory || -L $object_directory ]]; then
    echo "BACKUP_OBJECT_DIRECTORY_INVALID" >&2
    exit 1
  fi
  if ! python3 - "$object_directory" <<'PY'
import os, pathlib, stat, sys
root = pathlib.Path(sys.argv[1]).absolute()
cursor = root
while True:
    info = os.lstat(cursor)
    if stat.S_ISLNK(info.st_mode):
        raise SystemExit("BACKUP_OBJECT_ANCESTOR_SYMLINK_FORBIDDEN")
    if cursor == cursor.parent: break
    cursor = cursor.parent
root_info = os.lstat(root)
if not stat.S_ISDIR(root_info.st_mode): raise SystemExit("BACKUP_OBJECT_DIRECTORY_INVALID")
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

started_epoch=$(date +%s)
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
backup_id="$(date -u +%Y%m%dT%H%M%SZ)-$(python3 - <<'PY'
import secrets
print(secrets.token_hex(16))
PY
)"
if [[ ! -d $output_directory || -L $output_directory ]]; then
  echo "BACKUP_OUTPUT_DIRECTORY_INVALID" >&2
  exit 1
fi
python3 - "$output_directory" <<'PY'
import os,pathlib,stat,sys
path=pathlib.Path(sys.argv[1]).absolute()
while True:
    info=os.lstat(path)
    if stat.S_ISLNK(info.st_mode): raise SystemExit("BACKUP_OUTPUT_ANCESTOR_SYMLINK_FORBIDDEN")
    if path == pathlib.Path(sys.argv[1]).absolute():
        if not stat.S_ISDIR(info.st_mode) or (os.name != "nt" and (info.st_uid != os.geteuid() or info.st_mode & 0o022)):
            raise SystemExit("BACKUP_OUTPUT_DIRECTORY_PERMISSIONS_INVALID")
    if path==path.parent: break
    path=path.parent
PY
python3 - "$output_directory" "$object_directory" <<'PY'
import os, pathlib, sys
output=pathlib.Path(sys.argv[1]).resolve(); objects=pathlib.Path(sys.argv[2]).resolve()
if output == objects or output in objects.parents or objects in output.parents:
    raise SystemExit("BACKUP_PATHS_OVERLAP_FORBIDDEN")
PY
backup_directory="$output_directory/$backup_id"
backup_directory_identity=""
container_dump="/tmp/giromesa-$backup_id.dump"
completed=0

cleanup() {
  docker exec "$database_container" rm -f "$container_dump" >/dev/null 2>&1 || true
  unset GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64
  if [[ $completed -ne 1 && -n ${backup_directory:-} && -n ${backup_directory_identity:-} ]]; then
    if [[ ! -L $backup_directory && -d $backup_directory && $(stat -c '%d:%i' "$backup_directory" 2>/dev/null || true) == "$backup_directory_identity" ]]; then
      chmod -R u+w -- "$backup_directory" 2>/dev/null || true
      rm -rf -- "$backup_directory"
    elif [[ -e $backup_directory || -L $backup_directory ]]; then
      echo "BACKUP_CLEANUP_IDENTITY_MISMATCH" >&2
    fi
  fi
}
trap cleanup EXIT

mkdir -- "$backup_directory"
chmod 700 -- "$backup_directory"
backup_directory_identity=$(stat -c '%d:%i' "$backup_directory")
runtime_snapshot="$backup_directory/.runtime-env.snapshot"
runtime_source_state=$(python3 - "$runtime_env_file" "$runtime_snapshot" <<'PY'
import hashlib,json,os,stat,sys
source,target=sys.argv[1:]
fd=os.open(source,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
try:
    metadata=os.fstat(fd)
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_size<=0: raise SystemExit("BACKUP_RUNTIME_ENV_INVALID")
    data=b""
    while chunk:=os.read(fd,1024*1024): data+=chunk
    target_fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        view=memoryview(data)
        while view: view=view[os.write(target_fd,view):]
        os.fsync(target_fd)
    finally: os.close(target_fd)
    print(json.dumps({"dev":metadata.st_dev,"ino":metadata.st_ino,"size":metadata.st_size,"mtime":metadata.st_mtime_ns,"sha256":hashlib.sha256(data).hexdigest()},separators=(",",":")),end="")
finally: os.close(fd)
PY
)
object_state_file="$backup_directory/.object-source-state.json"
object_source_state=$(python3 - "$object_directory" "$object_state_file" <<'PY'
import hashlib,json,os,stat,sys
root=os.path.realpath(sys.argv[1]); destination=sys.argv[2]; entries=[]
for current,dirs,files in os.walk(root,followlinks=False):
    for name in sorted([*dirs,*files]):
        path=os.path.join(current,name); info=os.lstat(path)
        if stat.S_ISLNK(info.st_mode): raise SystemExit("BACKUP_OBJECT_SYMLINK_FORBIDDEN")
        digest=None
        if stat.S_ISREG(info.st_mode):
            fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
            try:
                h=hashlib.sha256()
                while chunk:=os.read(fd,1024*1024): h.update(chunk)
                digest=h.hexdigest()
            finally: os.close(fd)
        kind="file" if stat.S_ISREG(info.st_mode) else "directory" if stat.S_ISDIR(info.st_mode) else "unsupported"
        if kind == "unsupported": raise SystemExit("BACKUP_OBJECT_PATH_INVALID")
        entries.append({"path":os.path.relpath(path,root).replace(os.sep,"/"),"kind":kind,"mode":info.st_mode,"size":info.st_size,"mtimeNs":info.st_mtime_ns,"sha256":digest})
encoded=json.dumps(entries,sort_keys=True,separators=(",",":")).encode()
fd=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
try:
    view=memoryview(encoded)
    while view: view=view[os.write(fd,view):]
    os.fsync(fd)
finally: os.close(fd)
print(hashlib.sha256(encoded).hexdigest(),end="")
PY
)
if ! database_integrity_violations=$(docker exec "$database_container" psql \
  --username "$database_user" --dbname "$database_name" --no-psqlrc \
  --tuples-only --no-align --set ON_ERROR_STOP=1 --command "
SELECT relation || ':' || orphan_count
FROM (
  SELECT 'auth_sessions.identity_id' AS relation, count(*) AS orphan_count
  FROM public.auth_sessions child
  WHERE NOT EXISTS (SELECT 1 FROM public.identities parent WHERE parent.id = child.identity_id)
  UNION ALL
  SELECT 'oauth_accounts.identity_id', count(*)
  FROM public.oauth_accounts child
  WHERE NOT EXISTS (SELECT 1 FROM public.identities parent WHERE parent.id = child.identity_id)
  UNION ALL
  SELECT 'password_credentials.identity_id', count(*)
  FROM public.password_credentials child
  WHERE NOT EXISTS (SELECT 1 FROM public.identities parent WHERE parent.id = child.identity_id)
) violations
WHERE orphan_count > 0
ORDER BY relation;"); then
  echo "BACKUP_DATABASE_INTEGRITY_CHECK_FAILED" >&2
  exit 1
fi
database_integrity_violations=${database_integrity_violations//$'\r'/}
database_integrity_violations=${database_integrity_violations//$'\n'/,}
database_integrity_violations=${database_integrity_violations%,}
if [[ -n $database_integrity_violations ]]; then
  echo "BACKUP_DATABASE_INTEGRITY_INVALID:$database_integrity_violations" >&2
  exit 1
fi
docker exec "$database_container" pg_dump \
  --format=custom --compress=6 --no-owner --no-acl \
  --username "$database_user" --dbname "$database_name" --file "$container_dump"
docker cp "$database_container:$container_dump" "$backup_directory/database.dump" >/dev/null
if [[ ! -s $backup_directory/database.dump ]]; then
  echo "BACKUP_DATABASE_DUMP_EMPTY" >&2
  exit 1
fi

if [[ -n $object_directory ]]; then
  python3 - "$object_directory" "$backup_directory/objects.zip" "$object_state_file" <<'PY'
import hashlib, json, os, pathlib, stat, sys, zipfile
root=pathlib.Path(sys.argv[1]).resolve(); destination=sys.argv[2]
expected_entries=json.loads(pathlib.Path(sys.argv[3]).read_text(encoding="utf-8"))
expected={entry["path"]:entry for entry in expected_entries}; seen=set()
with zipfile.ZipFile(destination,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for current,dirs,files in os.walk(root,followlinks=False):
        for name in sorted(dirs):
            path=pathlib.Path(current)/name; before=path.lstat(); relative=path.relative_to(root).as_posix()
            if stat.S_ISLNK(before.st_mode) or not stat.S_ISDIR(before.st_mode) or expected.get(relative,{}).get("kind")!="directory": raise SystemExit("BACKUP_OBJECT_PATH_INVALID")
            member=zipfile.ZipInfo(relative.rstrip("/")+"/"); member.create_system=3; member.external_attr=(stat.S_IFDIR|0o700)<<16
            archive.writestr(member,b""); seen.add(relative)
        for name in sorted(files):
            path=pathlib.Path(current)/name; before=path.lstat(); relative=path.relative_to(root).as_posix(); expected_entry=expected.get(relative,{})
            if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode) or expected_entry.get("kind")!="file": raise SystemExit("BACKUP_OBJECT_PATH_INVALID")
            fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
            try:
                opened=os.fstat(fd)
                if (opened.st_dev,opened.st_ino)!=(before.st_dev,before.st_ino): raise SystemExit("BACKUP_OBJECT_SOURCE_CHANGED")
                data=b""
                while chunk:=os.read(fd,1024*1024): data+=chunk
            finally: os.close(fd)
            after=path.lstat()
            if (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns)!=(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns): raise SystemExit("BACKUP_OBJECT_SOURCE_CHANGED")
            if hashlib.sha256(data).hexdigest()!=expected_entry.get("sha256"): raise SystemExit("BACKUP_OBJECT_SOURCE_CHANGED")
            member=zipfile.ZipInfo(relative); member.create_system=3; member.external_attr=(stat.S_IFREG|0o600)<<16; member.compress_type=zipfile.ZIP_DEFLATED
            archive.writestr(member,data); seen.add(relative)
if seen != set(expected): raise SystemExit("BACKUP_OBJECT_COVERAGE_MISMATCH")
PY
  if [[ ! -s $backup_directory/objects.zip ]]; then
    echo "BACKUP_OBJECT_ARCHIVE_EMPTY" >&2
    exit 1
  fi
  object_source_state_after=$(python3 - "$object_directory" <<'PY'
import hashlib,json,os,stat,sys
root=os.path.realpath(sys.argv[1]); entries=[]
for current,dirs,files in os.walk(root,followlinks=False):
    for name in sorted([*dirs,*files]):
        path=os.path.join(current,name); info=os.lstat(path)
        if stat.S_ISLNK(info.st_mode): raise SystemExit("BACKUP_OBJECT_SYMLINK_FORBIDDEN")
        digest=None
        if stat.S_ISREG(info.st_mode):
            fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
            try:
                h=hashlib.sha256()
                while chunk:=os.read(fd,1024*1024): h.update(chunk)
                digest=h.hexdigest()
            finally: os.close(fd)
        kind="file" if stat.S_ISREG(info.st_mode) else "directory" if stat.S_ISDIR(info.st_mode) else "unsupported"
        if kind == "unsupported": raise SystemExit("BACKUP_OBJECT_PATH_INVALID")
        entries.append({"path":os.path.relpath(path,root).replace(os.sep,"/"),"kind":kind,"mode":info.st_mode,"size":info.st_size,"mtimeNs":info.st_mtime_ns,"sha256":digest})
encoded=json.dumps(entries,sort_keys=True,separators=(",",":")).encode()
print(hashlib.sha256(encoded).hexdigest(),end="")
PY
)
  [[ $object_source_state_after == "$object_source_state" ]] || { echo "BACKUP_OBJECT_SOURCE_CHANGED" >&2; exit 1; }
  rm -f -- "$object_state_file"
fi
openssl enc -aes-256-cbc -pbkdf2 -md sha256 -salt \
  -in "$runtime_snapshot" -out "$backup_directory/configuration.enc" \
  -pass env:GIROMESA_BACKUP_CONFIG_ENCRYPTION_KEY_BASE64
[[ -s $backup_directory/configuration.enc ]] || { echo "BACKUP_CONFIG_ENCRYPTION_FAILED" >&2; exit 1; }
runtime_config_hmac=$(python3 - "$runtime_snapshot" <<'PY'
import base64,hashlib,hmac,os,pathlib,sys
key=base64.b64decode(os.environ["GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64"],validate=True)
print(hmac.new(key,pathlib.Path(sys.argv[1]).read_bytes(),hashlib.sha256).hexdigest(),end="")
PY
)
python3 - "$runtime_env_file" "$runtime_source_state" <<'PY'
import hashlib,json,os,stat,sys
source,expected=sys.argv[1:]; expected=json.loads(expected)
fd=os.open(source,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
try:
    info=os.fstat(fd); h=hashlib.sha256()
    while chunk:=os.read(fd,1024*1024): h.update(chunk)
    actual={"dev":info.st_dev,"ino":info.st_ino,"size":info.st_size,"mtime":info.st_mtime_ns,"sha256":h.hexdigest()}
finally: os.close(fd)
if not stat.S_ISREG(info.st_mode) or actual!=expected: raise SystemExit("BACKUP_RUNTIME_ENV_CHANGED")
PY
rm -f -- "$runtime_snapshot"

finished_epoch=$(date +%s)
duration_seconds=$((finished_epoch - started_epoch))
if ((duration_seconds > max_rpo_minutes * 60)); then
  echo "BACKUP_WINDOW_EXCEEDED" >&2
  exit 1
fi
completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)

source_components_json=$(printf '%s\n' "${source_component_images[@]}" | python3 -c 'import json,sys; print(json.dumps([line.rstrip("\n") for line in sys.stdin if line.rstrip("\n")]))')
python3 - "$backup_directory" "$backup_id" "$source_artifact" "$source_migration_id" "$target_artifact" "$target_migration_id" \
  "$database_container" "$database_name" "$started_at" "$completed_at" \
  "$duration_seconds" "$max_rpo_minutes" "$runtime_config_hmac" "$source_components_json" <<'PY'
import base64, hashlib, hmac, json, os, pathlib, sys
(
    root_raw, backup_id, source_artifact, source_migration_id, target_artifact,
    target_migration_id, source_container, database_name, created_at, completed_at,
    duration, rpo, runtime_config_hmac, source_components_json,
) = sys.argv[1:]
root = pathlib.Path(root_raw)
kind_by_name = {
    "database.dump": "postgresql",
    "objects.zip": "objects",
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
    "schemaVersion": 2,
    "backupId": backup_id,
    "artifact": source_artifact,
    "migrationId": source_migration_id,
    "sourceArtifact": source_artifact,
    "sourceComponentImages": json.loads(source_components_json),
    "sourceMigrationId": source_migration_id,
    "targetArtifact": target_artifact,
    "targetMigrationId": target_migration_id,
    "coverage": {"mode": "embedded", "database": True, "objects": True, "encryptedConfiguration": True},
    "sourceDatabaseContainer": source_container,
    "databaseName": database_name,
    "createdAt": created_at,
    "completedAt": completed_at,
    "durationSeconds": int(duration),
    "declaredRpoMinutes": int(rpo),
    "files": files,
}
key = base64.b64decode(os.environ["GIROMESA_BACKUP_MANIFEST_HMAC_KEY_BASE64"], validate=True)
payload["runtimeConfigurationHmacSha256"] = runtime_config_hmac
payload_bytes = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode()
manifest = {
    "schemaVersion": 2,
    "signedPayloadBase64": base64.b64encode(payload_bytes).decode(),
    "hmacSha256": hmac.new(key, payload_bytes, hashlib.sha256).hexdigest(),
}
(root / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
PY

chmod 400 -- "$backup_directory"/*
completed=1
printf '%s\n' "$backup_directory"
