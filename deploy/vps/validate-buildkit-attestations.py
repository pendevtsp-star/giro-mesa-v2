#!/usr/bin/env python3
import json
import sys


def views(value, marker):
    if not isinstance(value, dict) or not value:
        return None
    if marker in value:
        return {"single": value}
    if not all(isinstance(item, dict) and marker in item for item in value.values()):
        return None
    return value


def valid(provenance, sbom):
    provenance_views = views(provenance, "SLSA")
    sbom_views = views(sbom, "SPDX")
    if provenance_views is None or sbom_views is None or set(provenance_views) != set(sbom_views):
        return False
    for platform in provenance_views:
        slsa = provenance_views[platform]["SLSA"]
        spdx = sbom_views[platform]["SPDX"]
        legacy_slsa = (
            isinstance(slsa, dict)
            and bool(slsa)
            and isinstance(slsa.get("builder"), dict)
            and bool(slsa["builder"])
            and isinstance(slsa.get("buildType"), str)
            and bool(slsa["buildType"])
            and isinstance(slsa.get("materials"), list)
            and isinstance(slsa.get("metadata"), dict)
            and bool(slsa["metadata"])
        )
        build_definition = slsa.get("buildDefinition", {}) if isinstance(slsa, dict) else {}
        run_details = slsa.get("runDetails", {}) if isinstance(slsa, dict) else {}
        slsa_v1 = (
            isinstance(build_definition, dict)
            and isinstance(run_details, dict)
            and isinstance(build_definition.get("buildType"), str)
            and bool(build_definition["buildType"])
            and isinstance(build_definition.get("resolvedDependencies"), list)
            and isinstance(run_details.get("builder"), dict)
            and bool(run_details["builder"])
            and isinstance(run_details.get("metadata"), dict)
            and bool(run_details["metadata"])
        )
        if not (
            (legacy_slsa or slsa_v1)
            and isinstance(spdx, dict)
            and spdx.get("SPDXID") == "SPDXRef-DOCUMENT"
            and isinstance(spdx.get("spdxVersion"), str)
            and spdx["spdxVersion"].startswith("SPDX-")
            and isinstance(spdx.get("packages"), list)
        ):
            return False
    return True


try:
    with open(sys.argv[1], encoding="utf-8") as provenance_file:
        provenance_value = json.load(provenance_file)
    with open(sys.argv[2], encoding="utf-8") as sbom_file:
        sbom_value = json.load(sbom_file)
except (IndexError, OSError, json.JSONDecodeError):
    raise SystemExit("IMAGE_BUILDKIT_ATTESTATIONS_INVALID")

if not valid(provenance_value, sbom_value):
    raise SystemExit("IMAGE_BUILDKIT_ATTESTATIONS_INVALID")
