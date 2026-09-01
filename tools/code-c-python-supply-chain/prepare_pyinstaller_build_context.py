from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path

from canonical_evidence import canonical_sha256, write_canonical_json
from evidence_paths import (
    EvidencePathError,
    repository_relative_identity,
    resolve_repository_cli_path,
    same_filesystem_identity,
    verify_repository_future_path,
)

import PyInstaller

from collect_stage_b_static_evidence import collect_worker_source_evidence


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
EXPECTED_PYINSTALLER_VERSION = "6.22.2"
SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "toolchain-source-lock.json"
)


def canonical_bytes(value: object) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def git_head(repository_root: Path) -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repository_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def require_baseline(commit: str, repository_root: Path) -> None:
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", commit, "HEAD"],
        cwd=repository_root,
        check=False,
        capture_output=True,
        text=True,
    ).returncode:
        raise SystemExit(f"Code C HEAD does not contain required main quality baseline: {commit}")


def fresh_directory(path: Path, label: str, repository_root: Path) -> None:
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise SystemExit(f"{label} must be a fresh empty directory: {path}")
    path.mkdir(parents=True, exist_ok=True)
    resolved = path.resolve(strict=True)
    try:
        resolved.relative_to(repository_root)
    except ValueError as error:
        raise SystemExit(f"{label} resolves outside the explicit repository root: {resolved}") from error
    if any(path.iterdir()):
        raise SystemExit(f"{label} was not empty after creation: {path}")


def identity(path: Path, repository_root: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    return {
        "path": repository_relative_identity(
            path,
            repository_root=repository_root,
            field="build_context.inputs.wheel_inventories[].path",
        ),
        "sha256": sha256_file(path),
        "inventory_id": value["inventory_id"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["linux", "windows"], required=True)
    parser.add_argument("--repository-root", type=Path, required=True)
    parser.add_argument("--workpath", type=Path, required=True)
    parser.add_argument("--distpath", type=Path, required=True)
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--runtime-inventory", type=Path, required=True)
    parser.add_argument("--worker-build-inventory", type=Path, required=True)
    parser.add_argument("--runtime-identity", type=Path, required=True)
    parser.add_argument("--distribution", type=Path, required=True)
    parser.add_argument("--pip-wheel", type=Path, required=True)
    parser.add_argument("--pyinstaller-wheel", type=Path, required=True)
    parser.add_argument("--approval-binding", type=Path, required=True)
    parser.add_argument("--build-input-closure", type=Path, required=True)
    parser.add_argument("--build-environment-manifest", type=Path)
    parser.add_argument("--main-quality-baseline", required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    try:
        if not arguments.repository_root.is_absolute():
            raise SystemExit("--repository-root must be an explicit absolute path")
        repository_root = arguments.repository_root.resolve(strict=True)
        if not same_filesystem_identity(repository_root, REPOSITORY_ROOT):
            raise SystemExit(
                "explicit repository root does not identify the checkout executing the producer"
            )
        existing_inputs = (
            "spec",
            "runtime_inventory",
            "worker_build_inventory",
            "runtime_identity",
            "distribution",
            "pip_wheel",
            "pyinstaller_wheel",
            "approval_binding",
            "build_input_closure",
        )
        if arguments.build_environment_manifest:
            existing_inputs += ("build_environment_manifest",)
        for name in existing_inputs:
            setattr(
                arguments,
                name,
                resolve_repository_cli_path(
                    getattr(arguments, name),
                    repository_root=repository_root,
                    label=f"--{name.replace('_', '-')}",
                    filesystem_identity=True,
                ),
            )
        for name in ("workpath", "distpath", "output"):
            setattr(
                arguments,
                name,
                resolve_repository_cli_path(
                    getattr(arguments, name),
                    repository_root=repository_root,
                    label=f"--{name.replace('_', '-')}",
                    filesystem_identity=False,
                ),
            )
    except EvidencePathError as error:
        raise SystemExit(str(error)) from error

    if PyInstaller.__version__ != EXPECTED_PYINSTALLER_VERSION:
        raise SystemExit(
            f"build context requires PyInstaller {EXPECTED_PYINSTALLER_VERSION}, got {PyInstaller.__version__}"
        )
    require_baseline(arguments.main_quality_baseline, repository_root)
    approval_binding = json.loads(arguments.approval_binding.read_text(encoding="utf-8"))
    if (
        approval_binding.get("status") != "PASS"
        or approval_binding.get("binding_kind") != "CODE_C_BUILD_TIME_APPROVAL_BINDING"
        or approval_binding.get("code_c_head_sha") != git_head(repository_root)
        or approval_binding.get("main_quality_baseline") != arguments.main_quality_baseline
        or approval_binding.get("counts") != {
            "inventory_subjects": 4,
            "active_inventory_approvals": 4,
            "toolchain_subjects": 2,
            "active_toolchain_approvals": 2,
        }
        or any(value != 0 for value in approval_binding.get("mismatch_counts", {}).values())
    ):
        raise SystemExit("Build Context requires a PASS binding for the current 4+2 approvals")
    if len(approval_binding.get("approvals", [])) != 6 or any(
        entry.get("state") != "ACTIVE" for entry in approval_binding["approvals"]
    ):
        raise SystemExit("Build Context approval binding contains a non-active or incomplete approval set")
    build_input_closure = json.loads(arguments.build_input_closure.read_text(encoding="utf-8"))
    if (
        build_input_closure.get("status") != "PASS"
        or build_input_closure.get("target", {}).get("os") != arguments.target
        or build_input_closure.get("target", {}).get("python_version") != "3.13.15"
        or build_input_closure.get("dependency_reresolution_during_build") != "NO"
        or build_input_closure.get("sdist_or_source_build_used") != "NO"
    ):
        raise SystemExit("Build Context requires a PASS exact build-input inventory closure")
    fresh_directory(arguments.workpath, "PyInstaller workpath", repository_root)
    fresh_directory(arguments.distpath, "PyInstaller distpath", repository_root)
    try:
        arguments.output = verify_repository_future_path(
            arguments.output,
            repository_root=repository_root,
            label="--output",
        )
    except EvidencePathError as error:
        raise SystemExit(str(error)) from error

    source_lock = json.loads(
        (repository_root / SOURCE_LOCK.relative_to(REPOSITORY_ROOT)).read_text(encoding="utf-8")
    )
    target_lock = source_lock["targets"][arguments.target]
    if (
        sha256_file(arguments.distribution) != target_lock["cpython_distribution"]["sha256"]
        or sha256_file(arguments.pip_wheel) != source_lock["pip"]["sha256"]
        or sha256_file(arguments.pyinstaller_wheel) != target_lock["pyinstaller"]["sha256"]
    ):
        raise SystemExit("Build Context input bytes differ from the locked toolchain")
    worker_build = json.loads(arguments.worker_build_inventory.read_text(encoding="utf-8"))
    hooks = [
        package
        for package in worker_build["packages"]
        if str(package["package_name"]).lower().replace("_", "-")
        == "pyinstaller-hooks-contrib"
    ]
    if len(hooks) != 1:
        raise SystemExit("worker-build inventory must contain one pyinstaller-hooks-contrib artifact")
    wheel_inventories = [
        identity(arguments.runtime_inventory, repository_root),
        identity(arguments.worker_build_inventory, repository_root),
    ]
    source_graph = collect_worker_source_evidence()

    build_environment = None
    if arguments.build_environment_manifest:
        environment_path = arguments.build_environment_manifest.resolve()
        environment_document = json.loads(environment_path.read_text(encoding="utf-8"))
        environment_identity = {
            key: value
            for key, value in environment_document.items()
            if key
            not in {
                "build_environment_manifest_id",
                "build_environment_identity_sha256",
                "created_at",
                "summary",
            }
        }
        expected_identity_sha256 = canonical_sha256(environment_identity)
        if (
            arguments.target != "windows"
            or environment_document.get("target")
            != {"os": "windows", "architecture": "x86_64"}
            or not str(environment_document.get("build_environment_manifest_id", "")).startswith(
                "code-c-build-environment-"
            )
            or environment_document.get("validations", {}).get("unapproved_search_root_count") != 0
            or environment_document.get("build_environment_identity_sha256")
            != expected_identity_sha256
            or environment_document.get("build_environment_manifest_id")
            != f"code-c-build-environment-{expected_identity_sha256[:32]}"
            or not same_filesystem_identity(
                environment_document.get("runtime_anchors", {}).get("repository_root", ""),
                repository_root,
            )
            or not same_filesystem_identity(
                environment_document.get("environment", {})
                .get("effective", {})
                .get("CODE_C_REPOSITORY_ROOT", ""),
                repository_root,
            )
            or Path(environment_document.get("locked_python", {}).get("executable", "")).resolve()
            != Path(sys.executable).resolve()
            or environment_document.get("locked_python", {}).get("executable_sha256")
            != sha256_file(Path(sys.executable))
            or Path(environment_document.get("pyinstaller", {}).get("spec", "")).resolve()
            != arguments.spec.resolve()
            or environment_document.get("pyinstaller", {}).get("spec_sha256")
            != sha256_file(arguments.spec)
            or Path(environment_document.get("pyinstaller", {}).get("workpath", "")).resolve()
            != arguments.workpath.resolve()
            or Path(environment_document.get("pyinstaller", {}).get("distpath", "")).resolve()
            != arguments.distpath.resolve()
        ):
            raise SystemExit("Build Environment Manifest is not an approved Windows x64 environment")
        build_environment = {
            "path": repository_relative_identity(
                environment_path,
                repository_root=repository_root,
                field="build_context.inputs.build_environment_manifest.path",
            ),
            "sha256": sha256_file(environment_path),
            "build_environment_manifest_id": environment_document[
                "build_environment_manifest_id"
            ],
        }
    elif arguments.target == "windows":
        raise SystemExit("Windows Build Context requires a Build Environment Manifest")

    build_inputs = {
        "code_c_commit": git_head(repository_root),
        "main_quality_baseline": arguments.main_quality_baseline,
        "target": {
            "os": arguments.target,
            "architecture": "x86_64",
            "python_version": platform.python_version(),
            "implementation": platform.python_implementation(),
        },
        "cpython_distribution": {
            "filename": arguments.distribution.name,
            "sha256": sha256_file(arguments.distribution),
        },
        "cpython_artifact": {
            "filename": target_lock["cpython_distribution"]["interpreter_payload"],
            "sha256": target_lock["cpython_distribution"]["interpreter_payload_sha256"],
        },
        "pip_artifact": {
            "filename": arguments.pip_wheel.name,
            "sha256": sha256_file(arguments.pip_wheel),
        },
        "pyinstaller_artifact": {
            "filename": arguments.pyinstaller_wheel.name,
            "sha256": sha256_file(arguments.pyinstaller_wheel),
            "version": PyInstaller.__version__,
        },
        "pyinstaller_hooks_contrib_artifact": {
            "package_name": hooks[0]["package_name"],
            "version": hooks[0]["version"],
            "filename": hooks[0]["filename"],
            "sha256": hooks[0]["sha256"],
            "purl": hooks[0]["purl"],
        },
        "wheel_inventories": wheel_inventories,
        "wheel_graph_sha256": hashlib.sha256(canonical_bytes(wheel_inventories)).hexdigest(),
        "approval_binding": {
            "path": repository_relative_identity(
                arguments.approval_binding,
                repository_root=repository_root,
                field="build_context.inputs.approval_binding.path",
            ),
            "sha256": sha256_file(arguments.approval_binding),
            "review_snapshot_sha256": approval_binding["review_snapshot"]["sha256"],
            "approval_contract_sha256": approval_binding["approval_contract"]["sha256"],
            "active_inventory_approval_count": approval_binding["counts"]["active_inventory_approvals"],
            "active_toolchain_approval_count": approval_binding["counts"]["active_toolchain_approvals"],
        },
        "build_input_closure": {
            "path": repository_relative_identity(
                arguments.build_input_closure,
                repository_root=repository_root,
                field="build_context.inputs.build_input_closure.path",
            ),
            "sha256": sha256_file(arguments.build_input_closure),
        },
        "source_import_graph_sha256": source_graph["source_import_graph_sha256"],
        "sidecar_command_surface_sha256": source_graph[
            "sidecar_command_surface_sha256"
        ],
        "runtime_identity": {
            "path": repository_relative_identity(
                arguments.runtime_identity,
                repository_root=repository_root,
                field="build_context.inputs.runtime_identity.path",
            ),
            "sha256": sha256_file(arguments.runtime_identity),
        },
        "specification": {
            "path": repository_relative_identity(
                arguments.spec,
                repository_root=repository_root,
                field="build_context.inputs.specification.path",
            ),
            "sha256": sha256_file(arguments.spec),
        },
        "build_environment_manifest": build_environment,
        "build_settings": {
            "clean": True,
            "noconfirm": True,
            "strip": False,
            "upx": False,
            "onefile": True,
            "workpath": repository_relative_identity(
                arguments.workpath,
                repository_root=repository_root,
                field="build_context.inputs.build_settings.workpath",
            ),
            "distpath": repository_relative_identity(
                arguments.distpath,
                repository_root=repository_root,
                field="build_context.inputs.build_settings.distpath",
            ),
        },
    }
    build_context_id = f"code-c-pyinstaller-{hashlib.sha256(canonical_bytes(build_inputs)).hexdigest()[:32]}"
    document = {
        "schema_version": "1",
        "build_context_id": build_context_id,
        "created_before_build": True,
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "clean_isolated_buildpath": "PASS",
        "evidence_capture_alters_build_inputs": "NO",
        "inputs": build_inputs,
    }
    write_canonical_json(arguments.output, document)
    print(f"pyinstaller-build-context: PASS ({build_context_id})")


if __name__ == "__main__":
    main()
