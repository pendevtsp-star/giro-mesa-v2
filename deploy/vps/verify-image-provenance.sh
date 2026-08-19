#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

for tool in basename mktemp chmod rm python3 id; do
  command -v "$tool" >/dev/null 2>&1 || { echo "IMAGE_PROVENANCE_TOOL_REQUIRED:$tool" >&2; exit 1; }
done

attestation=${GIROMESA_IMAGE_ATTESTATION_FILE:-}
if [[ -z $attestation || ! -f $attestation || -L $attestation ]]; then
  echo "IMAGE_PROVENANCE_ATTESTATION_REQUIRED" >&2
  exit 1
fi
workflow_identity="https://github.com/pendevtsp-star/giro-mesa-v2/.github/workflows/publish-images.yml@refs/heads/main"
workflow_trigger=workflow_run
attestation_bundle=${GIROMESA_IMAGE_ATTESTATION_BUNDLE_FILE:-${attestation}.bundle}
if [[ ! -f $attestation_bundle || -L $attestation_bundle ]]; then
  echo "IMAGE_PROVENANCE_ATTESTATION_BUNDLE_REQUIRED" >&2
  exit 1
fi
attestation_checksum=${GIROMESA_IMAGE_ATTESTATION_CHECKSUM_FILE:-${attestation}.sha256}
if [[ ! -f $attestation_checksum || -L $attestation_checksum ]]; then
  echo "IMAGE_PROVENANCE_ATTESTATION_CHECKSUM_REQUIRED" >&2
  exit 1
fi
attestation_original_name=$(basename "$attestation")
attestation_source_directory=$(cd "$(dirname "$attestation")" && pwd -P)
attestation_stage=$(mktemp -d)
chmod 700 "$attestation_stage"
cleanup_attestation_stage() { rm -rf -- "$attestation_stage"; }
trap cleanup_attestation_stage EXIT
python3 - "$attestation" "$attestation_stage/attestation.json" \
  "$attestation_bundle" "$attestation_stage/attestation.bundle" \
  "$attestation_checksum" "$attestation_stage/attestation.sha256" <<'PY'
import os, shutil, stat, sys
for source_name, target_name in zip(sys.argv[1::2], sys.argv[2::2], strict=True):
    source_fd = os.open(source_name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        source_stat = os.fstat(source_fd)
        if not stat.S_ISREG(source_stat.st_mode) or source_stat.st_size <= 0:
            raise SystemExit("IMAGE_PROVENANCE_ATTESTATION_SOURCE_INVALID")
        target_fd = os.open(target_name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(os.dup(source_fd), "rb") as source, os.fdopen(os.dup(target_fd), "wb") as target:
                shutil.copyfileobj(source, target)
                target.flush()
                os.fsync(target.fileno())
        finally:
            os.close(target_fd)
    finally:
        os.close(source_fd)
PY
attestation="$attestation_stage/attestation.json"
attestation_bundle="$attestation_stage/attestation.bundle"
attestation_checksum="$attestation_stage/attestation.sha256"
if [[ ! -s $attestation || ! -s $attestation_bundle || ! -s $attestation_checksum ]]; then
  echo "IMAGE_PROVENANCE_ATTESTATION_EMPTY" >&2
  exit 1
fi
mapfile -t signed_metadata < <(python3 - "$attestation" <<'PY'
import json, pathlib, re, sys
value = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
role = value.get("role", "")
source = value.get("sourceCommit", "")
authorization = value.get("authorizedByMain", "")
if role not in {"target", "recovery"} or not re.fullmatch(r"[0-9a-f]{40}", source) or not re.fullmatch(r"[0-9a-f]{40}", authorization):
    raise SystemExit("IMAGE_PROVENANCE_SIGNED_IDENTITY_INVALID")
evidence_file = value.get("validationEvidenceFile", "")
evidence_hash = value.get("validationEvidenceSha256", "")
if role == "recovery":
    if not re.fullmatch(r"giromesa-recovery-validation-[0-9a-f]{40}\.json", evidence_file) or not re.fullmatch(r"sha256:[0-9a-f]{64}", evidence_hash):
        raise SystemExit("IMAGE_PROVENANCE_RECOVERY_EVIDENCE_IDENTITY_INVALID")
elif evidence_file or evidence_hash:
    raise SystemExit("IMAGE_PROVENANCE_TARGET_EVIDENCE_FORBIDDEN")
print(role)
print(source)
print(authorization)
print(evidence_file)
print(evidence_hash)
PY
)
if [[ ${#signed_metadata[@]} -ne 5 ]]; then
  echo "IMAGE_PROVENANCE_SIGNED_IDENTITY_INVALID" >&2
  exit 1
fi
provenance_role=${signed_metadata[0]}
signed_source_sha=${signed_metadata[1]}
authorization_sha=${signed_metadata[2]}
recovery_evidence_name=${signed_metadata[3]}
recovery_evidence_hash=${signed_metadata[4]}
if [[ -n ${GIROMESA_EXPECTED_PROVENANCE_ROLE:-} && ${GIROMESA_EXPECTED_PROVENANCE_ROLE} != "$provenance_role" ]]; then
  echo "IMAGE_PROVENANCE_ROLE_INVALID" >&2
  exit 1
fi
if [[ -z ${GIROMESA_RELEASE_ARTIFACT_SHA:-} || ${GIROMESA_RELEASE_ARTIFACT_SHA} != "$signed_source_sha" ]]; then
  echo "IMAGE_PROVENANCE_RELEASE_ARTIFACT_MISMATCH" >&2
  exit 1
fi
recovery_evidence_path=
if [[ $provenance_role == recovery ]]; then
  recovery_evidence_source="$attestation_source_directory/$recovery_evidence_name"
  recovery_evidence_path="$attestation_stage/recovery-validation.json"
  python3 - "$recovery_evidence_source" "$recovery_evidence_path" <<'PY'
import os, shutil, stat, sys
source_fd = os.open(sys.argv[1], os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    source_stat = os.fstat(source_fd)
    if not stat.S_ISREG(source_stat.st_mode) or source_stat.st_size <= 0:
        raise SystemExit("IMAGE_PROVENANCE_RECOVERY_EVIDENCE_INVALID")
    target_fd = os.open(sys.argv[2], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(os.dup(source_fd), "rb") as source, os.fdopen(os.dup(target_fd), "wb") as target:
            shutil.copyfileobj(source, target)
            target.flush()
            os.fsync(target.fileno())
    finally:
        os.close(target_fd)
finally:
    os.close(source_fd)
PY
fi
for tool in docker python3 stat realpath; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "IMAGE_PROVENANCE_TOOL_REQUIRED:$tool" >&2
    exit 1
  fi
done
docker buildx version >/dev/null 2>&1 || { echo "IMAGE_PROVENANCE_BUILDX_REQUIRED" >&2; exit 1; }
lock_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/image-lock.json"
attestation_validator="$(dirname "$lock_file")/validate-buildkit-attestations.py"
if [[ ! -f $lock_file || -L $lock_file || ! -f $attestation_validator || -L $attestation_validator ]]; then
  echo "IMAGE_PROVENANCE_LOCK_REQUIRED" >&2
  exit 1
fi
docker_config_directory=${GIROMESA_DOCKER_CONFIG_DIRECTORY:-}
if [[ -z $docker_config_directory || ! -d $docker_config_directory || -L $docker_config_directory || ! -f $docker_config_directory/config.json || -L $docker_config_directory/config.json ]]; then
  echo "IMAGE_PROVENANCE_DOCKER_CONFIG_REQUIRED" >&2
  exit 1
fi
config_dir_mode=$(stat -c '%a' "$docker_config_directory")
config_file_mode=$(stat -c '%a' "$docker_config_directory/config.json")
operator_uid=$(id -u); operator_gid=$(id -g)
config_dir_uid=$(stat -c '%u' "$docker_config_directory")
config_file_uid=$(stat -c '%u' "$docker_config_directory/config.json")
if [[ $config_dir_mode != 700 || $config_file_mode != 600 || $config_dir_uid != "$operator_uid" || $config_file_uid != "$operator_uid" ]]; then
  echo "IMAGE_PROVENANCE_DOCKER_CONFIG_PERMISSIONS_INVALID" >&2
  exit 1
fi
export DOCKER_CONFIG=$docker_config_directory
python3 - "$docker_config_directory/config.json" <<'PY'
import json, pathlib, sys
try:
    value = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    auths = value.get("auths")
    valid = (
        set(value) == {"auths"} and isinstance(auths, dict) and set(auths) == {"ghcr.io"}
        and isinstance(auths["ghcr.io"], dict) and bool(auths["ghcr.io"].get("auth"))
        and "credsStore" not in value and "credHelpers" not in value
    )
except Exception:
    valid = False
if not valid: raise SystemExit("IMAGE_PROVENANCE_DEDICATED_GHCR_CONFIG_INVALID")
PY
cosign_image=$(python3 - "$lock_file" <<'PY'
import json, re, sys
value = json.load(open(sys.argv[1], encoding="utf-8"))["images"]["cosign"]
reference = value.get("reference", "")
if not re.fullmatch(r"ghcr\.io/sigstore/cosign/cosign@sha256:[0-9a-f]{64}", reference): raise SystemExit(1)
print(reference, end="")
PY
)

attestation_path=$(realpath "$attestation")
attestation_bundle_path=$(realpath "$attestation_bundle")
python3 - "$attestation_path" "$attestation_checksum" "$attestation_original_name" <<'PY'
import hashlib, pathlib, re, sys
artifact, checksum_path = map(pathlib.Path, sys.argv[1:3])
expected_name = sys.argv[3]
value = checksum_path.read_text(encoding="ascii")
match = re.fullmatch(r"([0-9a-f]{64})  ([^/\\\r\n]+)\n?", value)
if not match or match.group(2) != expected_name or hashlib.sha256(artifact.read_bytes()).hexdigest() != match.group(1):
    raise SystemExit("IMAGE_PROVENANCE_ATTESTATION_CHECKSUM_INVALID")
PY
docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,size=16m --user "$operator_uid:$operator_gid" \
  --volume "$attestation_path:/release/attestation.json:ro" \
  --volume "$attestation_bundle_path:/release/attestation.bundle:ro" \
  --volume "$docker_config_directory:/cosign-home/.docker:ro" \
  --env HOME=/tmp/cosign-home --env DOCKER_CONFIG=/cosign-home/.docker "$cosign_image" verify-blob \
  --bundle /release/attestation.bundle \
  --certificate-identity "$workflow_identity" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
  --certificate-github-workflow-repository "pendevtsp-star/giro-mesa-v2" \
  --certificate-github-workflow-sha "$authorization_sha" \
  --certificate-github-workflow-trigger "$workflow_trigger" \
  /release/attestation.json >/dev/null

python3 - "$attestation" "$lock_file" "$signed_source_sha" "$authorization_sha" "${GIROMESA_POSTGRES_IMAGE:-}" "$provenance_role" "${GIROMESA_RELEASE_DIRECTORY:-}" "$recovery_evidence_path" "$recovery_evidence_hash" \
  "${GIROMESA_API_IMAGE:-}" "${GIROMESA_WORKER_IMAGE:-}" "${GIROMESA_SITE_IMAGE:-}" \
  "${GIROMESA_CUSTOMER_IMAGE:-}" "${GIROMESA_OPS_IMAGE:-}" <<'PY'
import hashlib,json, pathlib, re, sys
path, lock_path, artifact, authorization, postgres, role, release_root, evidence_path, evidence_hash, *images = sys.argv[1:]
digest = re.compile(r"^ghcr\.io/pendevtsp-star/giro-mesa-v2-(?:api|worker|site|customer|ops)@sha256:[0-9a-f]{64}$")
try:
    value = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    lock = json.loads(pathlib.Path(lock_path).read_text(encoding="utf-8"))
    postgres_lock = lock["images"]["postgres"]
    expected_files={"deploy/vps/deploy-entrypoint.sh","deploy/vps/compose.pilot.yaml","deploy/vps/compose.images.yaml","deploy/vps/compose.observability.yaml","deploy/vps/deploy-pilot.sh","deploy/vps/rollback-app.sh","deploy/vps/verify-image-provenance.sh","deploy/vps/validate-buildkit-attestations.py","deploy/vps/image-lock.json","deploy/vps/rollback-compatibility.json","deploy/vps/recovery-compatibility.json","scripts/backup-production.sh","scripts/restore-drill.sh","packages/db/drizzle/meta/_journal.json"}
    files=value.get("releaseFiles",{}); root=pathlib.Path(release_root).resolve()
    expected_files.update(str(path.relative_to(root)).replace("\\", "/") for path in (root / "packages/db/drizzle").glob("[0-9][0-9][0-9][0-9]_*.sql"))
    files_valid=set(files)==expected_files and all((root/name).is_file() and not (root/name).is_symlink() and digest=="sha256:"+hashlib.sha256((root/name).read_bytes()).hexdigest() for name,digest in files.items())
    evidence_valid = not evidence_path and not evidence_hash and role == "target"
    if role == "recovery":
        evidence_file = pathlib.Path(evidence_path)
        evidence = json.loads(evidence_file.read_text(encoding="utf-8"))
        evidence_valid = (
            evidence_hash == "sha256:" + hashlib.sha256(evidence_file.read_bytes()).hexdigest()
            and evidence.get("schemaVersion") == 1
            and evidence.get("role") == "recovery"
            and evidence.get("recoveryArtifact") == "git:" + artifact
            and evidence.get("postgresMajors") == [16, 17]
            and evidence.get("schemaLevels") == [42]
            and evidence.get("targetMigration") == "0042_shallow_lenny_balinger"
            and evidence.get("testedUpgrade") is True
            and evidence.get("doseClubReconciliation") == "legacy-source-upgraded"
            and evidence.get("legacyUpgrade") == {"sourceArtifact":"git:4d408037c3fbcb67e2ad57f8ad47b6300a10ec77","sourceMigration":"0026_doseclub_integration","sourceAppliedAt":"1786493658116","postgresMajors":[16,17],"result":"passed"}
            and evidence.get("result") == "passed"
            and evidence.get("runtime") == {"postgresMajor":17,"schemaLevel":42,"apiHealth":"passed","workerStabilitySeconds":15,"outboxProbe":"passed"}
        )
    valid = (
        re.fullmatch(r"[0-9a-f]{40}", artifact)
        and value.get("schemaVersion") == 1
        and lock.get("schemaVersion") == 1
        and postgres_lock.get("reference") == postgres
        and postgres_lock.get("upstreamRepository") == "docker.io/library/postgres"
        and postgres_lock.get("upstreamTag") == "17-alpine"
        and value.get("sourceCommit") == artifact
        and value.get("role") == role
        and value.get("authorizedByMain") == authorization
        and value.get("workflow") == "publish-images.yml"
        and files_valid
        and evidence_valid
        and sorted(value.get("images", [])) == sorted(images)
        and len(images) == 5
        and len(set(images)) == 5
        and all(digest.fullmatch(image) for image in images)
    )
except Exception:
    valid = False
if not valid:
    print("IMAGE_PROVENANCE_ATTESTATION_INVALID", file=sys.stderr)
    raise SystemExit(1)
PY
docker image inspect "$GIROMESA_POSTGRES_IMAGE" --format '{{json .RepoDigests}}' >/dev/null

image_index=0
for image in "$GIROMESA_API_IMAGE" "$GIROMESA_WORKER_IMAGE" "$GIROMESA_SITE_IMAGE" "$GIROMESA_CUSTOMER_IMAGE" "$GIROMESA_OPS_IMAGE"; do
  if [[ ${GIROMESA_PROVENANCE_REQUIRE_LOCAL_IMAGE:-true} == true ]]; then
    docker image inspect "$image" --format '{{json .RepoDigests}}' >/dev/null
  fi
  docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp:rw,noexec,nosuid,size=16m --user "$operator_uid:$operator_gid" --volume "$docker_config_directory:/cosign-home/.docker:ro" \
    --env HOME=/tmp/cosign-home --env DOCKER_CONFIG=/cosign-home/.docker "$cosign_image" verify \
    --certificate-identity "$workflow_identity" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
    --certificate-github-workflow-repository "pendevtsp-star/giro-mesa-v2" \
    --certificate-github-workflow-sha "$authorization_sha" \
    --certificate-github-workflow-trigger "$workflow_trigger" \
    -a "role=$provenance_role" \
    -a "sourceCommit=$signed_source_sha" \
    -a "authorizedByMain=$authorization_sha" \
    "$image" >/dev/null
  provenance_file="$attestation_stage/provenance-$image_index.json"
  sbom_file="$attestation_stage/sbom-$image_index.json"
  docker buildx imagetools inspect "$image" --format '{{json .Provenance}}' >"$provenance_file"
  docker buildx imagetools inspect "$image" --format '{{json .SBOM}}' >"$sbom_file"
  chmod 600 "$provenance_file" "$sbom_file"
  python3 "$attestation_validator" "$provenance_file" "$sbom_file"
  image_index=$((image_index + 1))
done
echo "Proveniência criptográfica e digests de imagens validados sem exibir credenciais."
