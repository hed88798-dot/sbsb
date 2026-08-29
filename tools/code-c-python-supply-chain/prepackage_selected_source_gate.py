from __future__ import annotations

import json
import os
from pathlib import Path, PurePosixPath

from canonical_evidence import write_canonical_json
from hermetic_pyinstaller import (
    approved_source_entry,
    sha256_file,
    verify_environment_manifest_identity,
)
from msvc_runtime_dependency import (
    MsvcRuntimeEvidenceError,
    capture_msvc_runtime_dependency_request,
)


def validate_selected_sources(
    binaries: object,
    manifest_path: Path,
    output_path: Path,
) -> dict[str, object]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    verify_environment_manifest_identity(manifest)
    entries = []
    failures = []
    for index, item in enumerate(binaries):
        if not isinstance(item, (tuple, list)) or len(item) != 3:
            failures.append(f"Analysis.binaries[{index}] is not a three-field entry")
            continue
        destination, source, category = item
        if category not in {"BINARY", "EXTENSION"}:
            continue
        if not isinstance(destination, str) or not isinstance(source, str):
            failures.append(f"Analysis.binaries[{index}] has no source path")
            continue
        source_path = Path(source)
        try:
            digest = sha256_file(source_path)
            approved = approved_source_entry(source_path, digest, manifest)
            entries.append(
                {
                    "internal_path": destination.replace("\\", "/"),
                    "filename": PurePosixPath(destination.replace("\\", "/")).name,
                    "category": category,
                    "selected_source_path": str(source_path),
                    "selected_source_realpath": approved["resolved_path"],
                    "selected_source_sha256": digest,
                    "source_kind": approved["source_kind"],
                    "source_artifact_identity": approved["source_artifact_identity"],
                }
            )
        except (OSError, RuntimeError) as error:
            failures.append(f"{destination}: {error}")
    entries.sort(key=lambda entry: str(entry["internal_path"]))
    msvc_request_binding = None
    document = {
        "schema_version": "code-c-prepackage-selected-native-provenance-v1",
        "build_environment_manifest_id": manifest["build_environment_manifest_id"],
        "build_environment_manifest_sha256": sha256_file(manifest_path),
        "status": "PASS" if not failures else "FAIL",
        "selected_native_count": len(entries),
        "ambient_temurin_selected_count": 0 if not failures else None,
        "ambient_bootstrap_python_selected_count": 0 if not failures else None,
        "ambient_image_magick_selected_count": 0 if not failures else None,
        "other_unapproved_source_root_count": 0 if not failures else len(failures),
        "entries": entries,
        "failures": failures,
    }
    if os.name == "nt":
        try:
            msvc_output = Path(manifest["pyinstaller"]["msvc_runtime_evidence"])
            request = capture_msvc_runtime_dependency_request(
                binaries,
                manifest,
                manifest_path,
                msvc_output,
                Path(manifest["pyinstaller"]["msvc_runtime_approval_request"]),
            )
            msvc_request_binding = {
                "evidence_id": request["evidence_id"],
                "status": request["status"],
                "sha256": sha256_file(msvc_output),
            }
            print(
                "msvc-runtime-dependency-request: "
                f"{request['status']} ({request['evidence_id']})"
            )
            if request["status"] != "READY":
                failures.append("MSVC Runtime dependency evidence is incomplete")
        except (OSError, KeyError, ValueError, MsvcRuntimeEvidenceError) as error:
            failures.append(f"MSVC Runtime dependency evidence capture failed: {error}")
    document = {
        **document,
        "status": "PASS" if not failures else "FAIL",
        "ambient_temurin_selected_count": 0 if not failures else None,
        "ambient_bootstrap_python_selected_count": 0 if not failures else None,
        "ambient_image_magick_selected_count": 0 if not failures else None,
        "other_unapproved_source_root_count": 0 if not failures else len(failures),
        "msvc_runtime_dependency_request": msvc_request_binding,
        "failures": failures,
    }
    write_canonical_json(output_path, document)
    if failures:
        raise SystemExit(
            "pre-package selected-source provenance failed closed:\n" + "\n".join(failures)
        )
    return document


def validate_analysis_binaries(binaries: object) -> None:
    manifest_value = os.environ.get("CODE_C_BUILD_ENVIRONMENT_MANIFEST")
    output_value = os.environ.get("CODE_C_PREPACKAGE_SELECTED_EVIDENCE")
    if not manifest_value or not output_value:
        if os.name == "nt":
            raise SystemExit("Windows PyInstaller build lacks hermetic provenance gate configuration")
        return
    document = validate_selected_sources(binaries, Path(manifest_value), Path(output_value))
    print(
        "pre-package-selected-source-provenance: PASS "
        f"({document['selected_native_count']} selected native sources)"
    )
