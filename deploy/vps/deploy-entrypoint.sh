#!/bin/bash
set -Eeuo pipefail
umask 077
IFS=$' \t\n'
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
export DOCKER_HOST=unix:///var/run/docker.sock
unset BASH_ENV ENV CDPATH GLOBIGNORE PYTHONPATH PYTHONHOME LD_PRELOAD LD_LIBRARY_PATH
unset TMPDIR TMP TEMP
unset DOCKER_CONTEXT DOCKER_TLS_VERIFY DOCKER_CERT_PATH DOCKER_CLI_PLUGIN_EXTRA_DIRS BUILDX_CONFIG
unset COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_FILE COMPOSE_ENV_FILES
unset POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL SESSION_SECRET HOST PORT
unset WORKER_HEARTBEAT_FILE WORKER_HEARTBEAT_MAX_AGE_MS WORKER_HEARTBEAT_CHECK_INTERVAL
unset NEXT_PUBLIC_API_URL NEXT_PUBLIC_OPS_URL NEXT_PUBLIC_CUSTOMER_API_URL NEXT_PUBLIC_GOOGLE_AUTH_ENABLED
unset NEXT_PUBLIC_REDE_STORE_URL NEXT_PUBLIC_PAYGO_STORE_URL NEXT_PUBLIC_STONE_STORE_URL
unset NEXT_PUBLIC_CUSTOMER_API_ENABLED NEXT_PUBLIC_WHATSAPP_NUMBER
unset FISCAL_RELEASE_ENV FOCUS_NFE_PRIMARY_TOKEN FISCAL_CREDENTIALS_ENCRYPTION_KEY FOCUS_NFE_TIMEOUT_MS MEDIA_ROOT
unset WORKER_HEARTBEAT_CLEANUP_ON_SHUTDOWN DEPLOYMENT_ENVIRONMENT GIROMESA_IMAGE_PREFIX GIROMESA_IMAGE_TAG
unalias -a 2>/dev/null || true
for function_name in awk basename chmod dirname docker flock id mktemp python3 readlink rm sha256sum stat; do unset -f "$function_name" 2>/dev/null || true; done
hash -r

for tool in awk basename chmod dirname docker flock id mktemp python3 readlink rm sha256sum stat; do
  command -v "$tool" >/dev/null 2>&1 || { echo "TRUST_ENTRYPOINT_TOOL_REQUIRED:$tool" >&2; exit 1; }
done
exec 9>/run/lock/giromesa-release.lock
flock -n 9 || { echo "RELEASE_OPERATION_IN_PROGRESS" >&2; exit 1; }
[[ $(stat -c '%a:%u' /run/lock/giromesa-release.lock) == "600:$(id -u)" ]] || chmod 600 /run/lock/giromesa-release.lock

operation=${1:-deploy}
case "$operation" in deploy|rollback) ;; *) echo "TRUST_ENTRYPOINT_OPERATION_INVALID" >&2; exit 1 ;; esac
self=$(readlink -f "${BASH_SOURCE[0]}")
expected_self=${GIROMESA_TRUSTED_ENTRYPOINT_SHA256:-}
actual_self=$(sha256sum "$self" | awk '{print $1}')
[[ $expected_self =~ ^[0-9a-f]{64}$ && $actual_self == "$expected_self" ]] || { echo "TRUST_ENTRYPOINT_HASH_MISMATCH" >&2; exit 1; }
uid=$(id -u); gid=$(id -g)
python3 -I - "$self" <<'PY'
import os,pathlib,stat,sys
path=pathlib.Path(sys.argv[1]); euid=os.geteuid(); info=path.stat()
if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_uid != euid or info.st_mode & 0o222:
    raise SystemExit("TRUST_ENTRYPOINT_PERMISSIONS_INVALID")
cursor=path.parent
while cursor != cursor.parent:
    info=cursor.stat()
    if cursor.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != euid or info.st_mode & 0o022:
        raise SystemExit("TRUST_ENTRYPOINT_ANCESTOR_PERMISSIONS_INVALID")
    cursor=cursor.parent
PY

root=$(readlink -f "${GIROMESA_ROOT:-/srv/apps/giromesa-v2}")
release=$(readlink -f "${GIROMESA_RELEASE_DIRECTORY:?GIROMESA_RELEASE_DIRECTORY_REQUIRED}")
recovery_release=$(readlink -f "${GIROMESA_RECOVERY_RELEASE_DIRECTORY:?GIROMESA_RECOVERY_RELEASE_DIRECTORY_REQUIRED}")
release_sha=$(basename "$release")
recovery_sha=$(basename "$recovery_release")
[[ $release == "$root/releases/$release_sha" && $release_sha =~ ^[0-9a-f]{40}$ ]] || { echo "TRUST_RELEASE_PATH_INVALID" >&2; exit 1; }
[[ $recovery_release == "$root/releases/$recovery_sha" && $recovery_sha =~ ^[0-9a-f]{40}$ ]] || { echo "TRUST_RECOVERY_PATH_INVALID" >&2; exit 1; }
[[ $(dirname "$release") == "$(dirname "$recovery_release")" ]] || { echo "TRUST_RELEASE_ROOT_MISMATCH" >&2; exit 1; }
python3 -I - "$root" "$root/releases" <<'PY'
import os,pathlib,stat,sys
euid=os.geteuid()
paths=[]
for raw in sys.argv[1:]:
    cursor=pathlib.Path(raw)
    while True:
        paths.append(cursor)
        if cursor==cursor.parent: break
        cursor=cursor.parent
for path in dict.fromkeys(paths):
    info=path.stat()
    if path.is_symlink() or not stat.S_ISDIR(info.st_mode) or info.st_uid != euid or info.st_mode & 0o022:
        raise SystemExit("TRUST_RELEASE_PARENT_PERMISSIONS_INVALID")
PY

manifest=${GIROMESA_IMAGE_ATTESTATION_FILE:?GIROMESA_IMAGE_ATTESTATION_FILE_REQUIRED}
bundle=${GIROMESA_IMAGE_ATTESTATION_BUNDLE_FILE:-${manifest}.bundle}
recovery_manifest=${GIROMESA_RECOVERY_IMAGE_ATTESTATION_FILE:?GIROMESA_RECOVERY_IMAGE_ATTESTATION_FILE_REQUIRED}
recovery_bundle=${GIROMESA_RECOVERY_IMAGE_ATTESTATION_BUNDLE_FILE:-${recovery_manifest}.bundle}
recovery_manifest_source_directory=$(cd "$(dirname "$recovery_manifest")" && pwd -P)

trust_stage_root=/run/giromesa-trust
if [[ ! -e $trust_stage_root ]]; then mkdir "$trust_stage_root"; chmod 700 "$trust_stage_root"; fi
[[ -d $trust_stage_root && ! -L $trust_stage_root && $(stat -c '%a:%u' "$trust_stage_root") == "700:$uid" ]] || { echo "TRUST_STAGE_ROOT_INVALID" >&2; exit 1; }
stage=$(mktemp -d --tmpdir="$trust_stage_root" entrypoint.XXXXXXXX); chmod 700 "$stage"; trap 'rm -rf -- "$stage"' EXIT
mkdir "$stage/docker-empty"; chmod 700 "$stage/docker-empty"; printf '{"auths":{}}\n' >"$stage/docker-empty/config.json"; chmod 600 "$stage/docker-empty/config.json"
export DOCKER_CONFIG="$stage/docker-empty"
python3 -I - "$manifest" "$stage/target.json" "$bundle" "$stage/target.bundle" "$recovery_manifest" "$stage/recovery.json" "$recovery_bundle" "$stage/recovery.bundle" <<'PY'
import os, shutil, stat, sys
for source, target in zip(sys.argv[1::2], sys.argv[2::2], strict=True):
    fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size <= 0:
            raise SystemExit("TRUST_EVIDENCE_SOURCE_INVALID")
        out = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(os.dup(fd), "rb") as src, os.fdopen(os.dup(out), "wb") as dst:
                shutil.copyfileobj(src, dst)
                dst.flush()
                os.fsync(dst.fileno())
        finally:
            os.close(out)
    finally:
        os.close(fd)
PY

mapfile -t signed_identity < <(python3 -I - "$stage/target.json" "$stage/recovery.json" "$release_sha" "$recovery_sha" "$operation" <<'PY'
import json, pathlib, re, sys
target = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
recovery = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
release_sha, recovery_sha, operation = sys.argv[3:]
authorization = target.get("authorizedByMain", "")
valid = (
    target.get("schemaVersion") == 1
    and target.get("sourceCommit") == release_sha
    and target.get("role") == "target"
    and authorization == release_sha
    and re.fullmatch(r"[0-9a-f]{40}", authorization)
    and recovery.get("schemaVersion") == 1
    and recovery.get("role") == "recovery"
    and recovery.get("sourceCommit") == recovery_sha
    and recovery.get("authorizedByMain") == authorization
    and recovery.get("workflow") == target.get("workflow") == "publish-images.yml"
)
evidence = recovery.get("validationEvidenceFile", "")
evidence_hash = recovery.get("validationEvidenceSha256", "")
valid = valid and re.fullmatch(r"giromesa-recovery-validation-[0-9a-f]{40}\.json", evidence) and re.fullmatch(r"sha256:[0-9a-f]{64}", evidence_hash)
if not valid:
    raise SystemExit("TRUST_SIGNED_RELEASE_IDENTITY_INVALID")
print(authorization)
print(evidence)
print(evidence_hash)
PY
)
[[ ${#signed_identity[@]} -eq 3 ]] || { echo "TRUST_SIGNED_RELEASE_IDENTITY_INVALID" >&2; exit 1; }
authorization=${signed_identity[0]}
recovery_evidence_name=${signed_identity[1]}
recovery_evidence_hash=${signed_identity[2]}
python3 -I - "$recovery_manifest_source_directory/$recovery_evidence_name" "$stage/recovery-validation.json" <<'PY'
import os, shutil, stat, sys
fd = os.open(sys.argv[1], os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_size <= 0:
        raise SystemExit("TRUST_RECOVERY_EVIDENCE_SOURCE_INVALID")
    out = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(os.dup(fd), "rb") as src, os.fdopen(os.dup(out), "wb") as dst:
            shutil.copyfileobj(src, dst)
            dst.flush(); os.fsync(dst.fileno())
    finally:
        os.close(out)
finally:
    os.close(fd)
PY

cosign=ghcr.io/sigstore/cosign/cosign@sha256:b29487e48205d875c324c79583e2806d9d269c0fa299e0861bbec023d8430c8b
for role in target recovery; do
  docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --user "$uid:$gid" --env HOME=/tmp/cosign-home \
    --volume "$(readlink -f "$stage/$role.json"):/release/manifest.json:ro" --volume "$(readlink -f "$stage/$role.bundle"):/release/manifest.bundle:ro" \
    "$cosign" verify-blob --bundle /release/manifest.bundle \
    --certificate-identity "https://github.com/pendevtsp-star/giro-mesa-v2/.github/workflows/publish-images.yml@refs/heads/main" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-github-workflow-repository pendevtsp-star/giro-mesa-v2 \
    --certificate-github-workflow-sha "$authorization" --certificate-github-workflow-trigger workflow_run /release/manifest.json >/dev/null
done

python3 -I - "$stage/target.json" "$release" "$stage/recovery.json" "$recovery_release" "$stage/recovery-validation.json" "$recovery_evidence_hash" <<'PY'
import hashlib, json, pathlib, re, sys
fixed = {"deploy/vps/deploy-entrypoint.sh","deploy/vps/compose.pilot.yaml","deploy/vps/compose.images.yaml","deploy/vps/compose.observability.yaml","deploy/vps/deploy-pilot.sh","deploy/vps/rollback-app.sh","deploy/vps/verify-image-provenance.sh","deploy/vps/validate-buildkit-attestations.py","deploy/vps/image-lock.json","deploy/vps/rollback-compatibility.json","deploy/vps/recovery-compatibility.json","scripts/backup-production.sh","scripts/restore-drill.sh","packages/db/drizzle/meta/_journal.json"}
target_only = {"package.json","config/fiscal-release.json","scripts/check-fiscal-storage.sh","scripts/fiscal-production-smoke.sql"}
def validate_files(manifest_path, root_raw, role):
    value = json.loads(pathlib.Path(manifest_path).read_text(encoding="utf-8"))
    root = pathlib.Path(root_raw).resolve()
    expected = fixed | (target_only if role == "target" else set()) | {str(path.relative_to(root)).replace("\\", "/") for path in (root / "packages/db/drizzle").glob("[0-9][0-9][0-9][0-9]_*.sql")}
    files = value.get("releaseFiles", {})
    root_info = root.stat()
    if root_info.st_uid != __import__("os").geteuid() or root_info.st_mode & 0o022 or set(files) != expected or not expected - fixed:
        return False
    for name, digest in files.items():
        path = root / name
        resolved = path.resolve()
        info = path.stat()
        if root not in resolved.parents or not path.is_file() or path.is_symlink() or info.st_uid != __import__("os").geteuid() or info.st_mode & 0o022:
            return False
        parent = path.parent
        while parent != root:
            parent_info = parent.stat()
            if parent.is_symlink() or parent_info.st_uid != __import__("os").geteuid() or parent_info.st_mode & 0o022: return False
            parent = parent.parent
        if digest != "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest():
            return False
    return True
target_manifest, target_root, recovery_manifest, recovery_root, evidence_path, evidence_hash = sys.argv[1:]
evidence_file = pathlib.Path(evidence_path)
evidence = json.loads(evidence_file.read_text(encoding="utf-8"))
recovery_sha = pathlib.Path(recovery_root).name
evidence_valid = (
    evidence_hash == "sha256:" + hashlib.sha256(evidence_file.read_bytes()).hexdigest()
    and evidence.get("schemaVersion") == 1
    and evidence.get("role") == "recovery"
    and evidence.get("recoveryArtifact") == "git:" + recovery_sha
    and evidence.get("postgresMajors") == [16, 17]
    and evidence.get("schemaLevels") == [45]
    and evidence.get("targetMigration") == "0045_strong_pride"
    and evidence.get("testedUpgrade") is True
    and evidence.get("doseClubReconciliation") == "legacy-source-upgraded"
    and evidence.get("legacyUpgrade") == {"sourceArtifact":"git:4d408037c3fbcb67e2ad57f8ad47b6300a10ec77","sourceMigration":"0026_doseclub_integration","sourceAppliedAt":"1786493658116","postgresMajors":[16,17],"result":"passed"}
    and evidence.get("result") == "passed"
    and evidence.get("runtime") == {"postgresMajor":17,"schemaLevel":45,"apiHealth":"passed","workerStabilitySeconds":15,"outboxProbe":"passed"}
)
if not (validate_files(target_manifest, target_root, "target") and validate_files(recovery_manifest, recovery_root, "recovery") and evidence_valid):
    raise SystemExit("TRUST_RELEASE_FILES_INVALID")
PY

export GIROMESA_TRUST_BOOTSTRAP_VERIFIED=true
export GIROMESA_RELEASE_ARTIFACT_SHA=$release_sha
export GIROMESA_RECOVERY_RELEASE_SHA=$recovery_sha
rm -rf -- "$stage"
trap - EXIT
case "$operation" in
  deploy) exec "$release/deploy/vps/deploy-pilot.sh" ;;
  rollback)
    [[ ${ROLLBACK_RELEASE_SHA:-$recovery_sha} == "$recovery_sha" ]] || { echo "TRUST_ROLLBACK_TARGET_NOT_RECOVERY" >&2; exit 1; }
    export ROLLBACK_RELEASE_SHA=$recovery_sha
    exec "$release/deploy/vps/rollback-app.sh"
    ;;
esac
