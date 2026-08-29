from __future__ import annotations

import json
import os
from pathlib import Path, PurePosixPath

from canonical_evidence import write_canonical_json
from evidence_paths import EvidencePathError, runtime_repository_root
from hermetic_pyinstaller import (
    approved_source_entry,
    sha256_file,
    verify_environment_manifest_identity,
)
from msvc_runtime_dependency import (
    MsvcRuntimeEvidenceError,
    capture_msvc_runtime_dependency_request,
)
from machine_output import log_status


def validate_selected_sources(
    binaries: object,
    manifest_path: Path,
    output_path: Path,
    *,
    repository_root: Path,
    capture_msvc_runtime: bool | None = None,
) -> dict[str, object]:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    verify_environment_manifest_identity(manifest)
    try:
        frozen_repository_root = runtime_repository_root(
            manifest, explicit_repository_root=repository_root
        )
    except EvidencePathError as error:
        raise SystemExit(str(error)) from error
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
            entry = {
                "internal_path": destination.replace("\\", "/"),
                "filename": PurePosixPath(destination.replace("\\", "/")).name,
                "category": category,
                "selected_source_path": str(source_path),
                "selected_source_sha256": digest,
            }
            try:
                approved = approved_source_entry(source_path, digest, manifest)
                entries.append(
                    {
                        **entry,
                        "selected_source_realpath": approved["resolved_path"],
                        "source_provenance_status": "APPROVED",
                        "source_kind": approved["source_kind"],
                        "source_artifact_identity": approved["source_artifact_identity"],
                    }
                )
            except RuntimeError as error:
                entries.append(
                    {
                        **entry,
                        "selected_source_realpath": str(source_path.resolve(strict=True)),
                        "source_provenance_status": "UNAPPROVED",
                        "source_kind": "UNAPPROVED_SELECTED_SOURCE",
                        "source_artifact_identity": None,
                    }
                )
                failures.append(f"{destination}: {error}")
        except OSError as error:
            failures.append(f"{destination}: {error}")
    entries.sort(key=lambda entry: str(entry["internal_path"]))
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
        "msvc_runtime_dependency_request": {
            "capture_lifecycle": "SEPARATE_EVIDENCE_BINDS_THIS_IMMUTABLE_MANIFEST",
            "path": manifest["pyinstaller"].get("msvc_runtime_evidence"),
        },
        "failures": failures,
    }
    # Freeze the exact raw Analysis selection before producing any derived
    # dependency evidence. The closure bundle binds this immutable file by hash.
    write_canonical_json(output_path, document)
    if capture_msvc_runtime is False and not any(
        root.get("kind") == "TEST_APPROVED_ROOT"
        for root in manifest.get("packaging_approved_source_roots", [])
    ):
        raise SystemExit("production MSVC Runtime evidence capture cannot be disabled")
    should_capture_msvc = os.name == "nt" if capture_msvc_runtime is None else capture_msvc_runtime
    if should_capture_msvc:
        try:
            msvc_output = Path(manifest["pyinstaller"]["msvc_runtime_evidence"])
            request = capture_msvc_runtime_dependency_request(
                binaries,
                manifest,
                manifest_path,
                msvc_output,
                Path(manifest["pyinstaller"]["msvc_runtime_approval_request"]),
                frozen_repository_root,
                selected_manifest_path=output_path,
            )
            log_status(
                "msvc-runtime-dependency-request: "
                f"{request['status']} ({request['evidence_id']})"
            )
            if request["status"] != "READY":
                failures.append("MSVC Runtime dependency evidence is incomplete")
        except (OSError, KeyError, ValueError, MsvcRuntimeEvidenceError) as error:
            failures.append(f"MSVC Runtime dependency evidence capture failed: {error}")
    # Do not rewrite output_path here: doing so would invalidate the exact
    # Selected Native Manifest SHA captured by the derived closure evidence.
    if failures:
        raise SystemExit(
            "pre-package selected-source provenance failed closed:\n" + "\n".join(failures)
        )
    return document


def validate_analysis_binaries(binaries: object) -> None:
    manifest_value = os.environ.get("CODE_C_BUILD_ENVIRONMENT_MANIFEST")
    output_value = os.environ.get("CODE_C_PREPACKAGE_SELECTED_EVIDENCE")
    repository_root_value = os.environ.get("CODE_C_REPOSITORY_ROOT")
    if not manifest_value or not output_value or not repository_root_value:
        if os.name == "nt":
            raise SystemExit("Windows PyInstaller build lacks hermetic provenance gate configuration")
        return
    document = validate_selected_sources(
        binaries,
        Path(manifest_value),
        Path(output_value),
        repository_root=Path(repository_root_value),
    )
    log_status(
        "pre-package-selected-source-provenance: PASS "
        f"({document['selected_native_count']} selected native sources)"
    )
