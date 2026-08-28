from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
from pathlib import Path

from policy import sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
INSPECT_ONEFILE = (
    REPOSITORY_ROOT / "tools" / "python-supply-chain" / "inspect-pyinstaller-onefile.py"
)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


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
    runtime_inventory_path = (
        REPOSITORY_ROOT
        / "compliance"
        / "python-artifacts"
        / arguments.target
        / "runtime.v2.json"
    )
    toolchain_path = (
        REPOSITORY_ROOT / "compliance" / "python-toolchain" / f"{arguments.target}.v1.json"
    )
    runtime = json.loads(runtime_inventory_path.read_text(encoding="utf-8"))
    toolchain = json.loads(toolchain_path.read_text(encoding="utf-8"))
    by_kind = {component["component_kind"]: component for component in toolchain["components"]}
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
            "python_version": toolchain["target"]["python_version"],
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
                }
            ],
            "toolchain_inventory": {
                "inventory_id": toolchain["inventory_id"],
                "manifest_path": toolchain_path.relative_to(REPOSITORY_ROOT).as_posix(),
                "manifest_sha256": sha256_file(toolchain_path),
            },
            "cpython_component_id": by_kind["CPYTHON_DISTRIBUTION"]["component_id"],
            "pip_component_id": by_kind["PIP"]["component_id"],
            "pyinstaller_component_id": by_kind["PYINSTALLER"]["component_id"],
            "bootloader_component_id": by_kind["PYINSTALLER_BOOTLOADER"]["component_id"],
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
    arguments.output.write_text(canonical_json(provenance), encoding="utf-8")
    print(
        f"build-provenance-create: PASS ({arguments.target}; "
        f"{inspection['final_artifact']['sha256']})"
    )


if __name__ == "__main__":
    main()
