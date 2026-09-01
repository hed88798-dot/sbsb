from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


REQUIRED = {
    "msvcp140.dll",
    "msvcp140_1.dll",
    "vcruntime140.dll",
    "vcruntime140_1.dll",
}
MANIFEST_ID = "microsoft-vc-v14-x64-14.51.36247.0"
MANIFEST_SHA = "c3dd16982ee2c406aa3795aabc2e18ba3870125f861fea7a06f75111449ebe3b"


def file_sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def version_tuple(value: str) -> tuple[int, ...]:
    try:
        return tuple(int(part) for part in value.split("."))
    except ValueError as error:
        raise SystemExit(f"invalid runtime version: {value}") from error


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--attestation", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    manifest = json.loads(arguments.manifest.read_text(encoding="utf-8"))
    attestation = json.loads(arguments.attestation.read_text(encoding="utf-8"))
    if arguments.manifest.read_bytes() and file_sha(arguments.manifest) != MANIFEST_SHA:
        raise SystemExit("external prerequisite manifest hash mismatch")
    if manifest.get("prerequisite_id") != MANIFEST_ID:
        raise SystemExit("external prerequisite manifest ID mismatch")
    if (
        attestation.get("schema_version") != "1"
        or attestation.get("attestation_kind") != "PREINSTALLED_COMPATIBLE_RUNTIME_ONLY"
        or attestation.get("prerequisite_id") != MANIFEST_ID
        or attestation.get("manifest_sha256") != MANIFEST_SHA
        or attestation.get("observed_before_build") is not True
        or attestation.get("VC_REDIST_DOWNLOADED_BY_CODE_C") != "NO"
        or attestation.get("VC_REDIST_BUNDLED_BY_CODE_C") != "NO"
        or attestation.get("VC_REDIST_INSTALLED_BY_CODE_C") != "NO"
    ):
        raise SystemExit("preinstalled runtime attestation is not fail-closed or is not bound to the approved manifest")
    minimum = version_tuple(str(manifest["compatibility_policy"]["minimum_accepted_version"]))
    installed = version_tuple(str(attestation.get("installed_runtime_version", "")))
    if installed < minimum:
        raise SystemExit("preinstalled runtime is older than the approved minimum")
    entries = attestation.get("capabilities")
    if not isinstance(entries, list) or {str(entry.get("capability", "")).lower() for entry in entries} != REQUIRED:
        raise SystemExit("preinstalled runtime capability closure is incomplete")
    for entry in entries:
        if version_tuple(str(entry.get("file_version", ""))) < minimum:
            raise SystemExit(f"preinstalled capability is older than minimum: {entry.get('capability')}")
        if not str(entry.get("installed_path", "")).startswith("%WINDIR%/System32/"):
            raise SystemExit("preinstalled capability path is not a Windows System32 observation")
        if not str(entry.get("sha256", "")).islower() or len(str(entry.get("sha256", ""))) != 64:
            raise SystemExit("preinstalled capability hash is malformed")
    result = {
        "schema_version": "1",
        "status": "PASS",
        "validation_mode": "PREINSTALLED_COMPATIBLE_RUNTIME_ONLY",
        "prerequisite_id": MANIFEST_ID,
        "manifest_sha256": MANIFEST_SHA,
        "installed_runtime_version": attestation["installed_runtime_version"],
        "installed_runtime_compatibility": "PASS",
        "capabilities": entries,
        "VC_REDIST_DOWNLOADED_BY_CODE_C": "NO",
        "VC_REDIST_BUNDLED_BY_CODE_C": "NO",
        "VC_REDIST_INSTALLED_BY_CODE_C": "NO",
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"preinstalled-msvc-runtime: PASS ({attestation['installed_runtime_version']})")


if __name__ == "__main__":
    main()
