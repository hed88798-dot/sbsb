from __future__ import annotations

import copy
from pathlib import Path

from canonical_evidence import canonical_sha256, write_canonical_json
from hermetic_pyinstaller import normalized_realpath, sha256_file
from msvc_runtime_dependency import validate_msvc_evidence_pointers


SYNTHETIC_MANIFEST_SCHEMA = "code-c-pyinstaller-build-environment-v1"
SYNTHETIC_PYINSTALLER_SHA256 = "9" * 64
SYNTHETIC_PYINSTALLER_FILENAME = "pyinstaller-6.22.2-py3-none-win_amd64.whl"


def _write_build_context(
    manifest: dict[str, object], manifest_path: Path, build_context_path: Path
) -> dict[str, object]:
    pyinstaller = manifest["pyinstaller"]
    toolchain = manifest["toolchain_artifact_identities"]["pyinstaller_wheel"]
    context = {
        "schema_version": "1",
        "build_context_id": "synthetic-windows-pyinstaller-build-context-v1",
        "created_before_build": True,
        "clean_isolated_buildpath": "PASS",
        "evidence_capture_alters_build_inputs": "NO",
        "inputs": {
            "code_c_commit": "1" * 40,
            "target": {
                "os": "windows",
                "architecture": "x86_64",
                "python_version": "3.13.15",
                "implementation": "CPython",
            },
            "build_environment_manifest": {
                "path": manifest_path.name,
                "sha256": sha256_file(manifest_path),
                "build_environment_manifest_id": manifest[
                    "build_environment_manifest_id"
                ],
            },
            "pyinstaller_artifact": {
                "filename": toolchain["filename"],
                "sha256": toolchain["sha256"],
                "version": toolchain["version"],
            },
            "pyinstaller_hooks_contrib_artifact": {
                "filename": "pyinstaller_hooks_contrib-2026.7-py3-none-any.whl",
                "sha256": "8" * 64,
                "version": "2026.7",
                "purl": "pkg:pypi/pyinstaller-hooks-contrib@2026.7",
            },
            "specification": {
                "path": pyinstaller["spec"],
                "sha256": pyinstaller["spec_sha256"],
            },
            "build_settings": {
                "clean": True,
                "noconfirm": True,
                "onefile": True,
                "strip": False,
                "upx": False,
                "workpath": pyinstaller["workpath"],
                "distpath": pyinstaller["distpath"],
            },
        },
    }
    write_canonical_json(build_context_path, context)
    return context


def build_synthetic_pyinstaller_evidence_fixture(
    root: Path,
    approved_root: Path,
    approved_file: Path,
) -> dict[str, object]:
    spec = root / "media-worker.spec"
    spec.write_bytes(b"# synthetic one-file Worker specification\n")
    workpath = root / "work"
    distpath = root / "dist"
    workpath.mkdir()
    distpath.mkdir()
    manifest_path = root / "build-environment-manifest.json"
    build_context_path = root / "build-context.json"
    selected_evidence = root / "prepackage-selected-native-provenance.json"
    msvc_evidence = root / "msvc-runtime-dependency-request.v1.json"
    msvc_request = root / "DEPENDENCY_APPROVAL_REQUEST_MSVC_RUNTIME_V1.md"
    approved_digest = sha256_file(approved_file)
    identity = {
        "schema_version": SYNTHETIC_MANIFEST_SCHEMA,
        "target": {"os": "windows", "architecture": "x86_64"},
        "packaging_approved_source_roots": [
            {"kind": "TEST_APPROVED_ROOT", "realpath": normalized_realpath(approved_root)}
        ],
        "approved_source_file_manifest": [
            {
                "resolved_path": str(approved_file.resolve(strict=True)),
                "resolved_path_key": normalized_realpath(approved_file),
                "sha256": approved_digest,
                "source_kind": "SYNTHETIC_APPROVED_NATIVE",
                "source_artifact_identity": {
                    "filename": "synthetic-approved-native.whl",
                    "artifact_sha256": "a" * 64,
                    "member_relative_path": approved_file.name,
                    "member_sha256": approved_digest,
                    "purl": "pkg:pypi/synthetic-approved-native@1.0.0",
                },
            }
        ],
        "toolchain_artifact_identities": {
            "pyinstaller_wheel": {
                "filename": SYNTHETIC_PYINSTALLER_FILENAME,
                "sha256": SYNTHETIC_PYINSTALLER_SHA256,
                "purl": "pkg:pypi/pyinstaller@6.22.2",
                "version": "6.22.2",
                "functional_role": "WORKER_ONEFILE_PACKAGER",
                "usage_binding": "SYNTHETIC_WINDOWS_WORKER_BUILD",
            }
        },
        "pyinstaller": {
            "version": "6.22.2",
            "workpath": str(workpath.resolve()),
            "distpath": str(distpath.resolve()),
            "spec": str(spec.resolve(strict=True)),
            "spec_sha256": sha256_file(spec),
            "selected_evidence": str(selected_evidence.resolve()),
            "build_context": str(build_context_path.resolve()),
            "msvc_runtime_evidence": str(msvc_evidence.resolve()),
            "msvc_runtime_approval_request": str(msvc_request.resolve()),
        },
    }
    identity_sha256 = canonical_sha256(identity)
    manifest = {
        **identity,
        "build_environment_manifest_id": (
            f"code-c-build-environment-{identity_sha256[:32]}"
        ),
        "build_environment_identity_sha256": identity_sha256,
    }
    write_canonical_json(manifest_path, manifest)
    context = _write_build_context(manifest, manifest_path, build_context_path)
    validate_msvc_evidence_pointers(manifest, manifest_path)
    return {
        "manifest": manifest,
        "manifest_path": manifest_path,
        "build_context": context,
        "build_context_path": build_context_path,
        "selected_evidence_path": selected_evidence,
        "msvc_evidence_path": msvc_evidence,
        "msvc_request_path": msvc_request,
    }


def mutate_synthetic_fixture(
    fixture: dict[str, object], mutation: str
) -> tuple[dict[str, object], Path]:
    manifest = copy.deepcopy(fixture["manifest"])
    manifest_path = fixture["manifest_path"]
    context_path = fixture["build_context_path"]
    context = copy.deepcopy(fixture["build_context"])
    if mutation == "MISSING_POINTER":
        del manifest["pyinstaller"]
        write_canonical_json(manifest_path, manifest)
    elif mutation == "WRONG_HASH":
        context["inputs"]["build_environment_manifest"]["sha256"] = "0" * 64
        write_canonical_json(context_path, context)
    elif mutation == "WRONG_BUILD_CONTEXT":
        context["inputs"]["build_environment_manifest"][
            "build_environment_manifest_id"
        ] = "code-c-build-environment-wrong-context"
        write_canonical_json(context_path, context)
    elif mutation == "WRONG_ARTIFACT":
        context["inputs"]["pyinstaller_artifact"]["sha256"] = "7" * 64
        write_canonical_json(context_path, context)
    elif mutation == "WRONG_USAGE_BINDING":
        context["inputs"]["build_settings"]["onefile"] = False
        write_canonical_json(context_path, context)
    else:
        raise ValueError(f"unknown synthetic fixture mutation: {mutation}")
    return manifest, manifest_path
