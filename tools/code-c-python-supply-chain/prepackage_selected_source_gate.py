from __future__ import annotations

import json
import os
from pathlib import Path, PurePosixPath

from canonical_evidence import canonical_sha256, write_canonical_json
from evidence_paths import EvidencePathError, runtime_repository_root
from hermetic_pyinstaller import (
    approved_source_entry,
    sha256_file,
    verify_environment_manifest_identity,
)
from msvc_runtime_dependency import (
    MsvcRuntimeEvidenceError,
    build_import_closure,
    capture_msvc_runtime_dependency_request,
    normalize_runtime_name,
    read_pe_facts,
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
    closure_inputs = []
    external_manifest = None
    external_capabilities: set[str] = set()
    external_manifest_path_value = os.environ.get("CODE_C_EXTERNAL_PREREQUISITE_MANIFEST")
    if external_manifest_path_value:
        try:
            external_manifest_path = Path(external_manifest_path_value).resolve(strict=True)
            external_manifest = json.loads(external_manifest_path.read_text(encoding="utf-8"))
            if (
                external_manifest.get("prerequisite_id") != "microsoft-vc-v14-x64-14.51.36247.0"
            or canonical_sha256(external_manifest)
                != "c3dd16982ee2c406aa3795aabc2e18ba3870125f861fea7a06f75111449ebe3b"
                or external_manifest.get("target_disposition") != "EXTERNAL_PREREQUISITE"
            ):
                raise ValueError("external prerequisite manifest identity is not approved")
            external_capabilities = {
                str(name).lower()
                for name in external_manifest["provider"]["provided_capabilities"]
            }
        except (OSError, ValueError, KeyError, json.JSONDecodeError) as error:
            failures.append(f"external prerequisite manifest validation failed: {error}")
    if external_manifest is not None:
        for item in binaries:
            if not isinstance(item, (tuple, list)) or len(item) != 3:
                continue
            destination, source, category = item
            if category not in {"BINARY", "EXTENSION"} or not isinstance(source, str):
                continue
            source_path = Path(source)
            try:
                digest = sha256_file(source_path)
                try:
                    approved = approved_source_entry(source_path, digest, manifest)
                    owner = {
                        "source_kind": approved["source_kind"],
                        "source_artifact_identity": approved["source_artifact_identity"],
                    }
                except RuntimeError:
                    owner = {"source_kind": "UNAPPROVED_SYSTEM_COPY", "source_artifact_identity": None}
                closure_inputs.append(
                    {
                        "internal_path": str(destination).replace("\\", "/"),
                        "selected_source_path": str(source_path),
                        "sha256": digest,
                        "owner": owner,
                        "pe": read_pe_facts(source_path),
                    }
                )
            except (OSError, MsvcRuntimeEvidenceError) as error:
                failures.append(f"{destination}: cannot establish MSVC disposition evidence: {error}")
    required_external_capabilities: set[str] = set()
    if closure_inputs:
        try:
            required_external_capabilities = {
                str(name).lower()
                for name in build_import_closure(closure_inputs)["application_required_msvc_dll_family"]
            }
        except MsvcRuntimeEvidenceError as error:
            failures.append(f"MSVC import closure failed before packaging selection: {error}")
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
            runtime_name = normalize_runtime_name(destination)
            # The approved deployment decision is based on the complete PE
            # import closure, not on whether this particular copy happens to
            # match a CPython/toolchain manifest entry.  This keeps the raw
            # Analysis selection intact while partitioning every required
            # MSVC runtime DLL into the external-prerequisite layer.
            if (
                external_manifest is not None
                and runtime_name in required_external_capabilities
                and runtime_name in external_capabilities
            ):
                entries.append(
                    {
                        **entry,
                        "selected_source_realpath": str(source_path.resolve(strict=True)),
                        "source_provenance_status": "EXTERNAL_PREREQUISITE",
                        "source_kind": "EXTERNAL_PREREQUISITE_RUNTIME_OBSERVATION",
                        "source_artifact_identity": None,
                        "external_prerequisite": {
                            "prerequisite_id": external_manifest["prerequisite_id"],
                            "manifest_sha256": canonical_sha256(external_manifest),
                            "provider_id": external_manifest["provider"]["provider_id"],
                            "capability": runtime_name,
                            "materialized": False,
                            "final": False,
                            "raw_source_approval_implied": False,
                        },
                    }
                )
                continue
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
