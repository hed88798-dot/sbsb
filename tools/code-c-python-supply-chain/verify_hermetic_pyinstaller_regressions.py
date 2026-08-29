from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hermetic_pyinstaller import (
    HermeticBuildError,
    approved_source_entry,
    attest_python_search_path,
    build_child_environment,
    sha256_file,
)
from prepackage_selected_source_gate import validate_selected_sources
from msvc_runtime_dependency import (
    MsvcRuntimeEvidenceError,
    build_import_closure,
    normalize_runtime_name,
    validate_msvc_evidence_pointers,
)
from synthetic_pyinstaller_evidence_fixture import (
    SYNTHETIC_MANIFEST_SCHEMA,
    build_synthetic_pyinstaller_evidence_fixture,
    mutate_synthetic_fixture,
)


def expect_rejected(path: Path, digest: str, manifest: dict[str, object]) -> None:
    try:
        approved_source_entry(path, digest, manifest)
    except HermeticBuildError:
        return
    raise AssertionError(f"unapproved source unexpectedly passed: {path}")


def make_escape(link: Path, target: Path) -> None:
    if os.name == "nt":
        result = subprocess.run(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
            shell=False,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            raise AssertionError(result.stderr or result.stdout or "junction creation failed")
    else:
        link.symlink_to(target, target_is_directory=True)


def main() -> None:
    synthetic_owner = {
        "source_kind": "HASH_LOCKED_WHEEL_NATIVE",
        "source_artifact_identity": {"artifact_sha256": "b" * 64},
    }
    synthetic_graph = build_import_closure(
        [
            {
                "internal_path": "package/app.pyd",
                "selected_source_path": "approved/package/app.pyd",
                "sha256": "1" * 64,
                "owner": synthetic_owner,
                "pe": {"machine": "x86_64", "imports": ["core.dll"]},
            },
            {
                "internal_path": "package/core.dll",
                "selected_source_path": "approved/package/core.dll",
                "sha256": "2" * 64,
                "owner": synthetic_owner,
                "pe": {
                    "machine": "x86_64",
                    "imports": ["MSVCP140.dll", "VCRUNTIME140_1.dll"],
                },
            },
            {
                "internal_path": "msvcp140.dll",
                "selected_source_path": "unapproved/System32/msvcp140.dll",
                "sha256": "3" * 64,
                "owner": {
                    "source_kind": "UNAPPROVED_SYSTEM_COPY",
                    "source_artifact_identity": None,
                },
                "pe": {"machine": "x86_64", "imports": []},
            },
            {
                "internal_path": "MSVCP140_1.dll",
                "selected_source_path": "unapproved/System32/MSVCP140_1.dll",
                "sha256": "4" * 64,
                "owner": {
                    "source_kind": "UNAPPROVED_SYSTEM_COPY",
                    "source_artifact_identity": None,
                },
                "pe": {"machine": "x86_64", "imports": []},
            },
        ]
    )
    assert normalize_runtime_name("path/MSVCP140_2.DLL") == "msvcp140_2.dll"
    assert (
        normalize_runtime_name("path/msvcp140_atomic_wait.dll")
        == "msvcp140_atomic_wait.dll"
    )
    assert normalize_runtime_name("kernel32.dll") is None
    assert synthetic_graph["status"] == "PASS"
    assert synthetic_graph["direct_importer_count"] == 1
    assert synthetic_graph["transitive_importer_count"] == 1
    assert synthetic_graph["pyinstaller_selected_msvc_dll_family"] == [
        "msvcp140.dll",
        "msvcp140_1.dll",
    ]
    assert synthetic_graph["pe_import_closure_required_msvc_dll_family"] == [
        "msvcp140.dll",
        "vcruntime140_1.dll",
    ]
    assert synthetic_graph["selected_but_not_import_closure_required"] == ["msvcp140_1.dll"]
    assert synthetic_graph["required_but_not_pyinstaller_selected"] == ["vcruntime140_1.dll"]
    ambiguous_graph = build_import_closure(
        [
            {
                "internal_path": "app.pyd",
                "selected_source_path": "approved/app.pyd",
                "sha256": "5" * 64,
                "owner": synthetic_owner,
                "pe": {"machine": "x86_64", "imports": ["shared.dll"]},
            },
            {
                "internal_path": "a/shared.dll",
                "selected_source_path": "approved/a/shared.dll",
                "sha256": "6" * 64,
                "owner": synthetic_owner,
                "pe": {"machine": "x86_64", "imports": ["msvcp140.dll"]},
            },
            {
                "internal_path": "b/shared.dll",
                "selected_source_path": "approved/b/shared.dll",
                "sha256": "7" * 64,
                "owner": synthetic_owner,
                "pe": {"machine": "x86_64", "imports": ["msvcp140.dll"]},
            },
        ]
    )
    assert ambiguous_graph["status"] == "FAIL"
    assert len(ambiguous_graph["ambiguous_selected_dependency_resolutions"]) == 1

    with tempfile.TemporaryDirectory(prefix="code-c-hermetic-pyinstaller-") as directory:
        root = Path(directory)
        approved = root / "approved worker"
        ambient = root / "ambient toolchain"
        cache = root / "cache"
        approved.mkdir()
        ambient.mkdir()
        cache.mkdir()

        optional_zip = approved / "python313.zip"
        optional_attestation = attest_python_search_path(
            optional_zip,
            worker_root=approved,
            base_root=approved,
            optional_standard_library_zip_name="python313.zip",
        )
        assert optional_attestation["status"] == "NOT_PRESENT_OPTIONAL_STANDARD_LIBRARY_ZIP"
        for rejected_missing in (
            approved / "ambient.zip",
            ambient / "python313.zip",
        ):
            try:
                attest_python_search_path(
                    rejected_missing,
                    worker_root=approved,
                    base_root=approved,
                    optional_standard_library_zip_name="python313.zip",
                )
            except HermeticBuildError:
                pass
            else:
                raise AssertionError(f"unapproved missing Python search root passed: {rejected_missing}")
        approved_file = approved / "same-name.dll"
        ambient_file = ambient / "same-name.dll"
        source_pe = Path(sys.base_prefix) / "python313.dll"
        if not source_pe.is_file():
            source_pe = Path(sys.executable)
        approved_file.write_bytes(source_pe.read_bytes())
        ambient_file.write_bytes(approved_file.read_bytes())
        digest = sha256_file(approved_file)
        fixture = build_synthetic_pyinstaller_evidence_fixture(root, approved, approved_file)
        manifest = fixture["manifest"]
        approved_source_entry(approved_file, digest, manifest)
        expect_rejected(ambient_file, digest, manifest)
        manifest_path = fixture["manifest_path"]
        selected_path = fixture["selected_evidence_path"]
        validate_msvc_evidence_pointers(manifest, manifest_path)
        approved_gate = validate_selected_sources(
            [(approved_file.name, str(approved_file), "BINARY")],
            manifest_path,
            selected_path,
        )
        assert approved_gate["status"] == "PASS"
        try:
            validate_selected_sources(
                [(ambient_file.name, str(ambient_file), "BINARY")],
                manifest_path,
                selected_path,
            )
        except SystemExit:
            assert json.loads(selected_path.read_text(encoding="utf-8"))["status"] == "FAIL"
        else:
            raise AssertionError("same-byte ambient source passed the pre-package gate")

        escape = approved / "escape"
        make_escape(escape, ambient)
        expect_rejected(escape / ambient_file.name, digest, manifest)
        try:
            validate_selected_sources(
                [(ambient_file.name, str(escape / ambient_file.name), "BINARY")],
                manifest_path,
                selected_path,
            )
        except SystemExit:
            assert json.loads(selected_path.read_text(encoding="utf-8"))["status"] == "FAIL"
        else:
            raise AssertionError("realpath escape passed the pre-package gate")

        parent = {
            "PATH": os.pathsep.join([str(ambient), str(approved)]),
            "JAVA_HOME": str(ambient / "jdk"),
            "MAGICK_HOME": str(ambient / "imagemagick"),
            "PYTHONPATH": str(ambient / "bootstrap-python"),
        }
        child, audit = build_child_environment(
            parent,
            path_entries=[str(approved)],
            cache_root=cache,
            worker_root=approved,
            manifest_path=manifest_path,
            selected_evidence_path=selected_path,
        )
        assert child["PATH"] == str(approved)
        assert all(not entry["present_in_child"] for entry in audit["forbidden_ambient_toolchain_environment"])
        assert not any(str(ambient) in value for value in child.values())

        for mutation in (
            "MISSING_POINTER",
            "WRONG_HASH",
            "WRONG_BUILD_CONTEXT",
            "WRONG_ARTIFACT",
            "WRONG_USAGE_BINDING",
        ):
            mutation_root = root / mutation.lower()
            mutation_root.mkdir()
            mutation_approved = mutation_root / "approved"
            mutation_approved.mkdir()
            mutation_file = mutation_approved / "fixture.dll"
            mutation_file.write_bytes(approved_file.read_bytes())
            mutation_fixture = build_synthetic_pyinstaller_evidence_fixture(
                mutation_root, mutation_approved, mutation_file
            )
            mutated_manifest, mutated_manifest_path = mutate_synthetic_fixture(
                mutation_fixture, mutation
            )
            try:
                validate_msvc_evidence_pointers(mutated_manifest, mutated_manifest_path)
            except MsvcRuntimeEvidenceError:
                pass
            else:
                raise AssertionError(f"synthetic PyInstaller mutation passed: {mutation}")

    print(
        json.dumps(
            {
                "HOSTILE_AMBIENT_PATH_REGRESSION": "PASS",
                "SAME_BYTES_UNAPPROVED_SOURCE_FAIL_CLOSED": "PASS",
                "APPROVED_ROOT_REPARSE_ESCAPE_REGRESSION": "PASS",
                "OPTIONAL_CPYTHON_STDLIB_ZIP_ATTESTATION": "PASS",
                "ARBITRARY_MISSING_PYTHON_SEARCH_ROOT_FAIL_CLOSED": "PASS",
                "MSVC_RUNTIME_IMPORT_CLOSURE_REGRESSION": "PASS",
                "SYNTHETIC_MANIFEST_SCHEMA": SYNTHETIC_MANIFEST_SCHEMA,
                "SYNTHETIC_FIXTURE_SCHEMA_PARITY": "PASS",
                "POSITIVE_FIXTURE_ROUNDTRIP": "PASS",
                "SYNTHETIC_PYINSTALLER_EVIDENCE": "PASS",
                "MISSING_POINTER_FAIL_CLOSED": "PASS",
                "WRONG_HASH_FAIL_CLOSED": "PASS",
                "WRONG_BUILD_CONTEXT_FAIL_CLOSED": "PASS",
                "WRONG_ARTIFACT_REFERENCE_FAIL_CLOSED": "PASS",
                "WRONG_USAGE_BINDING_FAIL_CLOSED": "PASS",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
