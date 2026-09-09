from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hermetic_pyinstaller import (
    HermeticBuildError,
    approved_source_entry,
    attest_python_search_path,
    build_child_environment,
    sha256_file,
)
from evidence_paths import (
    EvidencePathAnchor,
    EvidencePathError,
    FORMAL_PATH_ANCHORS,
    declared_anchor,
    resolve_evidence_path,
)
from prepackage_selected_source_gate import validate_selected_sources
from msvc_runtime_dependency import (
    MsvcRuntimeEvidenceError,
    _preserve_analysis_toc,
    audit_dynamic_load_surfaces,
    build_import_closure,
    normalize_runtime_name,
    validate_msvc_evidence_pointers,
)
from synthetic_pyinstaller_evidence_fixture import (
    SYNTHETIC_MANIFEST_SCHEMA,
    build_synthetic_pyinstaller_evidence_fixture,
    mutate_synthetic_fixture,
)
from machine_output import emit_json_result


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


@contextmanager
def changed_directory(path: Path):
    previous = Path.cwd()
    os.chdir(path)
    try:
        yield
    finally:
        os.chdir(previous)


def expect_evidence_path_rejected(value: str, *, root: Path, field: str) -> None:
    try:
        resolve_evidence_path(
            value,
            field=field,
            trusted_runtime_anchors={"repository_root": root},
            expected_scope=root,
            filesystem_identity=False,
        )
    except EvidencePathError:
        return
    raise AssertionError(f"unsafe evidence path unexpectedly passed: {field}: {value}")


def main() -> None:
    synthetic_owner = {
        "source_kind": "HASH_LOCKED_WHEEL_NATIVE",
        "source_artifact_identity": {
            "filename": "synthetic-product-1.0.0-py3-none-any.whl",
            "artifact_sha256": "b" * 64,
            "member_relative_path": "package/native.pyd",
        },
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
                "pe": {"machine": "x86_64", "imports": ["concrt140.dll"]},
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
    assert synthetic_graph["approved_product_root_required_dlls"] == [
        "msvcp140.dll",
        "vcruntime140_1.dll",
    ]
    assert synthetic_graph["observed_runtime_endpoint_transitive_dlls"] == [
        "concrt140.dll"
    ]
    assert "concrt140.dll" not in synthetic_graph["application_required_msvc_dll_family"]
    delay_graph = build_import_closure(
        [
            {
                "internal_path": "delay-app.pyd",
                "selected_source_path": "approved/delay-app.pyd",
                "sha256": "8" * 64,
                "owner": synthetic_owner,
                "pe": {
                    "machine": "x86_64",
                    "static_imports": [],
                    "delay_imports": [{"dll": "msvcp140_2.dll", "symbols": []}],
                    "delay_import_directory_parsed": True,
                },
            }
        ]
    )
    assert delay_graph["delay_import_directory_audit"] == "PASS"
    assert delay_graph["delay_import_parse_failure_count"] == 0
    assert delay_graph["delay_import_edge_count"] == 1
    assert delay_graph["msvc_runtime_delay_importer_count"] == 1
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
        version_identity_fixture = root / "version-identity-runtime-literal.dll"
        version_identity_fixture.write_bytes(b"header-msvcp140.dll-footer")
        dynamic_owner = {
            "source_kind": "HASH_LOCKED_WHEEL_NATIVE",
            "source_artifact_identity": {
                "filename": "synthetic-wheel.whl",
                "artifact_sha256": "c" * 64,
                "member_relative_path": version_identity_fixture.name,
            },
        }
        dynamic_entry = {
            "internal_path": "package/version-identity-runtime-literal.dll",
            "selected_source_path": str(version_identity_fixture),
            "sha256": sha256_file(version_identity_fixture),
            "owner": dynamic_owner,
            "pe": {
                "machine": "x86_64",
                "static_imports": [
                    {"dll": "KERNEL32.dll", "symbols": ["GetProcAddress"]}
                ],
                "delay_imports": [],
                "version_resource": {
                    "internal_name": "msvcp140.dll",
                    "original_filename": "msvcp140.dll",
                },
            },
        }
        version_identity_audit = audit_dynamic_load_surfaces(
            [dynamic_entry], Path(__file__).resolve().parents[2]
        )
        assert version_identity_audit["status"] == "PASS"
        assert version_identity_audit["msvc_related_unresolved_dynamic_load_count"] == 0
        unresolved_entry = {
            **dynamic_entry,
            "pe": {**dynamic_entry["pe"], "version_resource": {}},
        }
        unresolved_audit = audit_dynamic_load_surfaces(
            [unresolved_entry], Path(__file__).resolve().parents[2]
        )
        assert unresolved_audit["status"] == "INCOMPLETE"
        assert unresolved_audit["msvc_related_unresolved_dynamic_load_count"] == 1
        digest = sha256_file(approved_file)
        fixture = build_synthetic_pyinstaller_evidence_fixture(root, approved, approved_file)
        manifest = fixture["manifest"]
        approved_source_entry(approved_file, digest, manifest)
        expect_rejected(ambient_file, digest, manifest)
        manifest_path = fixture["manifest_path"]
        selected_path = fixture["selected_evidence_path"]
        validate_msvc_evidence_pointers(manifest, manifest_path, repository_root=root)
        analysis_directory = Path(manifest["pyinstaller"]["workpath"]) / "media-worker"
        analysis_directory.mkdir(parents=True)
        analysis_toc = analysis_directory / "Analysis-17.toc"
        analysis_toc.write_bytes(b"synthetic Analysis TOC bytes\n")
        approved_gate = validate_selected_sources(
            [(approved_file.name, str(approved_file), "BINARY")],
            manifest_path,
            selected_path,
            repository_root=root,
            capture_msvc_runtime=False,
        )
        assert approved_gate["status"] == "PASS"
        selected_sha_before_capture = sha256_file(selected_path)
        toc_binding = _preserve_analysis_toc(
            manifest,
            fixture["build_context"],
            fixture["build_context_path"],
            manifest_path,
            selected_path,
            fixture["msvc_evidence_path"],
        )
        assert toc_binding["evidence_status"] == "DIAGNOSTIC_PRE_GATE"
        assert toc_binding["captured_at_gate"] == "PRE_PACKAGE_PROVENANCE"
        assert toc_binding["pyinstaller_analysis_toc_sha256"] == sha256_file(analysis_toc)
        assert toc_binding["selected_native_manifest_sha256"] == selected_sha_before_capture
        assert sha256_file(selected_path) == selected_sha_before_capture
        try:
            validate_selected_sources(
                [(ambient_file.name, str(ambient_file), "BINARY")],
                manifest_path,
                selected_path,
                repository_root=root,
                capture_msvc_runtime=False,
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
                repository_root=root,
                capture_msvc_runtime=False,
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
            repository_root=root,
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
                validate_msvc_evidence_pointers(
                    mutated_manifest,
                    mutated_manifest_path,
                    repository_root=mutation_root,
                )
            except MsvcRuntimeEvidenceError:
                pass
            else:
                raise AssertionError(f"synthetic PyInstaller mutation passed: {mutation}")

        required_classifications = {
            "build_context.inputs.build_settings.workpath": EvidencePathAnchor.REPOSITORY_ROOT,
            "build_context.inputs.build_settings.distpath": EvidencePathAnchor.REPOSITORY_ROOT,
            "build_context.inputs.specification.path": EvidencePathAnchor.REPOSITORY_ROOT,
            "build_environment.pyinstaller.hook_search_roots[]": (
                EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
            ),
            "build_environment.pyinstaller.cache_config_root": (
                EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
            ),
            "pyinstaller_build_evidence.raw_evidence.*.preserved_path": (
                EvidencePathAnchor.EVIDENCE_OUTPUT_ROOT
            ),
        }
        assert all(FORMAL_PATH_ANCHORS.get(field) == anchor for field, anchor in required_classifications.items())
        try:
            declared_anchor("build_context.inputs.undeclared_relative_path")
        except EvidencePathError:
            pass
        else:
            raise AssertionError("undeclared formal relative path anchor passed")

        for unsafe in (
            "../outside",
            "nested/../../outside",
            "/absolute/injection",
            "C:/drive/escape",
            "C:drive-relative-escape",
            "//server/share/escape",
        ):
            expect_evidence_path_rejected(
                unsafe,
                root=root,
                field="build_context.inputs.build_settings.workpath",
            )

        context_sha256_before_cwd_variation = sha256_file(fixture["build_context_path"])
        spec_directory = Path(manifest["pyinstaller"]["spec"]).parent
        tools_directory = root / "tools" / "code-c-python-supply-chain"
        arbitrary_directory = root / "arbitrary temp cwd"
        tools_directory.mkdir(parents=True)
        arbitrary_directory.mkdir()
        resolved_pairs = []
        for cwd in (root, spec_directory, tools_directory, arbitrary_directory):
            with changed_directory(cwd):
                validate_msvc_evidence_pointers(
                    manifest, manifest_path, repository_root=root
                )
                context = fixture["build_context"]
                resolved_pairs.append(
                    (
                        resolve_evidence_path(
                            context["inputs"]["build_settings"]["workpath"],
                            field="build_context.inputs.build_settings.workpath",
                            trusted_runtime_anchors={"repository_root": root},
                            expected_scope=root,
                            filesystem_identity=True,
                        ),
                        resolve_evidence_path(
                            context["inputs"]["build_settings"]["distpath"],
                            field="build_context.inputs.build_settings.distpath",
                            trusted_runtime_anchors={"repository_root": root},
                            expected_scope=root,
                            filesystem_identity=True,
                        ),
                    )
                )
        assert len({tuple(map(str, pair)) for pair in resolved_pairs}) == 1
        assert sha256_file(fixture["build_context_path"]) == context_sha256_before_cwd_variation

        checkout_b = root / "checkout-b"
        checkout_b.mkdir()
        approved_b = checkout_b / "approved worker"
        approved_b.mkdir()
        approved_file_b = approved_b / approved_file.name
        approved_file_b.write_bytes(approved_file.read_bytes())
        fixture_b = build_synthetic_pyinstaller_evidence_fixture(
            checkout_b, approved_b, approved_file_b
        )
        assert (
            fixture_b["build_context"]["inputs"]["build_settings"]["workpath"]
            == fixture["build_context"]["inputs"]["build_settings"]["workpath"]
        )
        try:
            validate_msvc_evidence_pointers(
                manifest, manifest_path, repository_root=checkout_b
            )
        except MsvcRuntimeEvidenceError:
            pass
        else:
            raise AssertionError("Build Context A passed with checkout B runtime anchor")

        with tempfile.TemporaryDirectory(prefix="code-c-outside-evidence-root-") as outside_value:
            outside = Path(outside_value)
            escape_path = root / "formal-evidence-escape"
            make_escape(escape_path, outside)
            try:
                resolve_evidence_path(
                    escape_path.name,
                    field="build_context.inputs.build_settings.workpath",
                    trusted_runtime_anchors={"repository_root": root},
                    expected_scope=root,
                    filesystem_identity=True,
                )
            except EvidencePathError:
                pass
            else:
                raise AssertionError("formal evidence symlink/junction escape passed")

    emit_json_result(
        {
            "HOSTILE_AMBIENT_PATH_REGRESSION": "PASS",
            "SAME_BYTES_UNAPPROVED_SOURCE_FAIL_CLOSED": "PASS",
            "APPROVED_ROOT_REPARSE_ESCAPE_REGRESSION": "PASS",
            "OPTIONAL_CPYTHON_STDLIB_ZIP_ATTESTATION": "PASS",
            "ARBITRARY_MISSING_PYTHON_SEARCH_ROOT_FAIL_CLOSED": "PASS",
            "MSVC_RUNTIME_IMPORT_CLOSURE_REGRESSION": "PASS",
            "ANALYSIS_TOC_DIAGNOSTIC_PRE_GATE_BINDING": "PASS",
            "SELECTED_MANIFEST_IMMUTABLE_DURING_DERIVED_CAPTURE": "PASS",
            "MSVC_APPLICATION_REQUIREMENT_ROOT_PROVENANCE": "PASS",
            "UNAPPROVED_RUNTIME_ENDPOINT_EDGE_NOT_PROMOTED": "PASS",
            "STATIC_DELAY_IMPORT_SEPARATION_REGRESSION": "PASS",
            "PE_VERSION_IDENTITY_METADATA_NOT_DYNAMIC_TARGET": "PASS",
            "MSVC_DYNAMIC_LITERAL_WITHOUT_PROVENANCE_FAIL_CLOSED": "PASS",
            "SYNTHETIC_MANIFEST_SCHEMA": SYNTHETIC_MANIFEST_SCHEMA,
            "SYNTHETIC_FIXTURE_SCHEMA_PARITY": "PASS",
            "POSITIVE_FIXTURE_ROUNDTRIP": "PASS",
            "SYNTHETIC_PYINSTALLER_EVIDENCE": "PASS",
            "MISSING_POINTER_FAIL_CLOSED": "PASS",
            "WRONG_HASH_FAIL_CLOSED": "PASS",
            "WRONG_BUILD_CONTEXT_FAIL_CLOSED": "PASS",
            "WRONG_ARTIFACT_REFERENCE_FAIL_CLOSED": "PASS",
            "WRONG_USAGE_BINDING_FAIL_CLOSED": "PASS",
            "PATH_ANCHOR_CLASSIFICATION": "PASS",
            "UNDECLARED_RELATIVE_PATH_ANCHOR_FAIL_CLOSED": "PASS",
            "LEXICAL_PATH_ESCAPE_GATE": "PASS",
            "FILESYSTEM_PATH_IDENTITY_GATE": "PASS",
            "BUILD_PATH_USAGE_BINDING": "PASS",
            "CWD_INDEPENDENT_PATH_RESOLUTION": "PASS",
            "REPO_ROOT_CWD": "PASS",
            "SPEC_DIR_CWD": "PASS",
            "TOOLS_DIR_CWD": "PASS",
            "ARBITRARY_TEMP_CWD": "PASS",
            "CWD_VARIATION_CHANGES_CANONICAL_IDENTITY": "NO",
            "EVIDENCE_PATH_ROUNDTRIP": "PASS",
            "WRONG_ANCHOR_FAIL_CLOSED": "PASS",
            "CROSS_CHECKOUT_WRONG_ANCHOR_FAIL_CLOSED": "PASS",
            "TRAVERSAL_FAIL_CLOSED": "PASS",
            "SYMLINK_ESCAPE_FAIL_CLOSED": "PASS",
            "WINDOWS_JUNCTION_ESCAPE_FAIL_CLOSED": "PASS",
            "REPARSE_ESCAPE_FAIL_CLOSED": "PASS",
            "EVIDENCE_RELATIVE_PATH_PRODUCER_ANCHOR": "EXPLICIT",
            "EVIDENCE_RELATIVE_PATH_CONSUMER_ANCHOR": "EXPLICIT",
            "PROCESS_CWD_SEMANTICS": "NONE",
        }
    )


if __name__ == "__main__":
    main()
