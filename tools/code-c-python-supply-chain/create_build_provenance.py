from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

from canonical_evidence import write_canonical_json
from policy import sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
TOOLCHAIN_SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "toolchain-source-lock.json"
)
INSPECT_ONEFILE = (
    REPOSITORY_ROOT / "tools" / "python-supply-chain" / "inspect-pyinstaller-onefile.py"
)


def inventory_path(target: str, scope_name: str) -> Path:
    inventory_root = REPOSITORY_ROOT / "compliance" / "python-artifacts" / target
    for schema_version in ("v3", "v2"):
        candidate = inventory_root / f"{scope_name}.{schema_version}.json"
        if candidate.is_file():
            return candidate
    raise SystemExit(
        f"approved inventory is missing for {target}/{scope_name} (expected v3 or v2 subject)"
    )


def component_id(component: dict[str, object], target: str) -> str:
    if component.get("component_id"):
        return str(component["component_id"])
    kind = str(component.get("component_kind", "")).lower().replace("_", "-")
    digest = str(component.get("sha256", ""))[:16]
    if not kind or len(digest) != 16:
        raise SystemExit("approved Toolchain component identity is incomplete")
    return f"code-c-{target}-toolchain-{kind}-{digest}"


def component_sha256(component: dict[str, object]) -> str:
    artifact = component.get("artifact")
    if isinstance(artifact, dict) and artifact.get("sha256"):
        return str(artifact["sha256"])
    if component.get("sha256"):
        return str(component["sha256"])
    raise SystemExit("approved Toolchain component is missing an artifact SHA-256")


def toolchain_inventory_id(toolchain: dict[str, object], target: str) -> str:
    if toolchain.get("inventory_id"):
        return str(toolchain["inventory_id"])
    if toolchain.get("evidence_type") == "PYTHON_TOOLCHAIN_INTAKE_EVIDENCE":
        return f"code-c-{target}-toolchain-intake-evidence"
    raise SystemExit("approved Toolchain subject is missing inventory identity")


def git_head() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--final-artifact", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--run-identity", default=os.environ.get("GITHUB_RUN_ID", "local-explicit-build"))
    arguments = parser.parse_args()
    source_lock = json.loads(TOOLCHAIN_SOURCE_LOCK.read_text(encoding="utf-8"))
    runtime_inventory_path = inventory_path(arguments.target, "runtime")
    worker_build_inventory_path = inventory_path(arguments.target, "worker-build")
    toolchain_path = (
        REPOSITORY_ROOT / "compliance" / "python-toolchain" / f"{arguments.target}.v1.json"
    )
    runtime = json.loads(runtime_inventory_path.read_text(encoding="utf-8"))
    worker_build = json.loads(worker_build_inventory_path.read_text(encoding="utf-8"))
    toolchain = json.loads(toolchain_path.read_text(encoding="utf-8"))
    toolchain_python_version = (
        toolchain["python"]["version"]
        if isinstance(toolchain.get("python"), dict)
        else toolchain["target"]["python_version"]
    )
    by_kind = {component["component_kind"]: component for component in toolchain["components"]}
    worker_build_by_name = {
        package["package_name"].lower().replace("_", "-"): package
        for package in worker_build["packages"]
    }
    hooks = worker_build_by_name.get("pyinstaller-hooks-contrib")
    pyinstaller_wheel = worker_build_by_name.get("pyinstaller")
    if hooks is None:
        raise SystemExit("WORKER_BUILD inventory omits pyinstaller-hooks-contrib")
    if pyinstaller_wheel is None:
        raise SystemExit("WORKER_BUILD inventory omits PyInstaller")
    if (
        pyinstaller_wheel["version"] != source_lock["targets"][arguments.target]["pyinstaller"]["version"]
        or pyinstaller_wheel["sha256"] != component_sha256(by_kind["PYINSTALLER"])
    ):
        raise SystemExit("WORKER_BUILD PyInstaller differs from Toolchain Inventory v1")
    inspection = json.loads(
        subprocess.run(
            [sys.executable, str(INSPECT_ONEFILE), str(arguments.final_artifact)],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    specification = REPOSITORY_ROOT / "sidecars" / "media-worker" / "media-worker.spec"
    final_path = arguments.final_artifact.resolve()
    provenance = {
        "schema_version": "1",
        "build_id": f"code-c-{arguments.target}-{arguments.run_identity}",
        "build_commit_sha": git_head(),
        "build_timestamp": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "run_identity": arguments.run_identity,
        "target": {
            "os": arguments.target,
            "architecture": "x86_64",
            "python_version": toolchain_python_version,
        },
        "build_configuration": {
            "path": specification.relative_to(REPOSITORY_ROOT).as_posix(),
            "sha256": sha256_file(specification),
        },
        "inputs": {
            "wheel_inventories": [
                {
                    "inventory_id": runtime["inventory_id"],
                    "manifest_path": runtime_inventory_path.relative_to(REPOSITORY_ROOT).as_posix(),
                    "manifest_sha256": sha256_file(runtime_inventory_path),
                },
                {
                    "inventory_id": worker_build["inventory_id"],
                    "manifest_path": worker_build_inventory_path.relative_to(REPOSITORY_ROOT).as_posix(),
                    "manifest_sha256": sha256_file(worker_build_inventory_path),
                },
            ],
            "toolchain_inventory": {
                "inventory_id": toolchain_inventory_id(toolchain, arguments.target),
                "manifest_path": toolchain_path.relative_to(REPOSITORY_ROOT).as_posix(),
                "manifest_sha256": sha256_file(toolchain_path),
            },
            "cpython_component_id": component_id(by_kind["CPYTHON_DISTRIBUTION"], arguments.target),
            "pip_component_id": component_id(by_kind["PIP"], arguments.target),
            "pyinstaller_component_id": component_id(by_kind["PYINSTALLER"], arguments.target),
            "bootloader_component_id": component_id(by_kind["PYINSTALLER_BOOTLOADER"], arguments.target),
        },
        "output_layers": {
            "bootloader_sha256": inspection["bootloader_layer"]["sha256"],
            "archive_payload_sha256": inspection["archive_payload"]["sha256"],
        },
        "final_artifact": {
            "artifact_type": "PYINSTALLER_ONEFILE",
            "filename": final_path.name,
            "artifact_path": final_path.relative_to(REPOSITORY_ROOT).as_posix(),
            "sha256": inspection["final_artifact"]["sha256"],
        },
        "bit_for_bit_reproducible_build_required": False,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    write_canonical_json(arguments.output, provenance)
    print(
        f"build-provenance-create: PASS ({arguments.target}; "
        f"{inspection['final_artifact']['sha256']}; "
        f"pyinstaller-hooks-contrib {hooks['version']} {hooks['sha256']})"
    )


if __name__ == "__main__":
    main()
