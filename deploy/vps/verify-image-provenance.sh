#!/usr/bin/env bash
set -Eeuo pipefail

attestation=${GIROMESA_IMAGE_ATTESTATION_FILE:-}
if [[ -z $attestation || ! -f $attestation || -L $attestation ]]; then
  echo "IMAGE_PROVENANCE_ATTESTATION_REQUIRED" >&2
  exit 1
fi
for tool in gh docker python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "IMAGE_PROVENANCE_TOOL_REQUIRED:$tool" >&2
    exit 1
  fi
done

python3 - "$attestation" "${GIROMESA_RELEASE_ARTIFACT_SHA:-}" \
  "${GIROMESA_API_IMAGE:-}" "${GIROMESA_WORKER_IMAGE:-}" "${GIROMESA_SITE_IMAGE:-}" \
  "${GIROMESA_CUSTOMER_IMAGE:-}" "${GIROMESA_OPS_IMAGE:-}" <<'PY'
import json, pathlib, re, sys
path, artifact, *images = sys.argv[1:]
digest = re.compile(r"^ghcr\.io/pendevtsp-star/giro-mesa-v2-(?:api|worker|site|customer|ops)@sha256:[0-9a-f]{64}$")
try:
    value = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    valid = (
        re.fullmatch(r"[0-9a-f]{40}", artifact)
        and value.get("schemaVersion") == 1
        and value.get("sourceCommit") == artifact
        and value.get("workflow") == "publish-images.yml"
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

for image in "$GIROMESA_API_IMAGE" "$GIROMESA_WORKER_IMAGE" "$GIROMESA_SITE_IMAGE" "$GIROMESA_CUSTOMER_IMAGE" "$GIROMESA_OPS_IMAGE"; do
  docker image inspect "$image" --format '{{json .RepoDigests}}' >/dev/null
  gh attestation verify "oci://$image" \
    --repo pendevtsp-star/giro-mesa-v2 \
    --signer-workflow pendevtsp-star/giro-mesa-v2/.github/workflows/publish-images.yml \
    --source-digest "$GIROMESA_RELEASE_ARTIFACT_SHA" \
    --deny-self-hosted-runners >/dev/null
done
echo "Proveniência criptográfica e digests de imagens validados sem exibir credenciais."
