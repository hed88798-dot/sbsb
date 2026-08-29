from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import platform
import subprocess
import sys
from pathlib import Path

import PyInstaller


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
EXPECTED_PYINSTALLER_VERSION = "6.22.2"


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode(
        "utf-8"
    )


def canonical_pretty(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def git_head() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def fresh_directory(path: Path, label: str) -> None:
    if path.exists() and (not path.is_dir() or any(path.iterdir())):
        raise SystemExit(f"{label} must be a fresh empty directory: {path}")
    path.mkdir(parents=True, exist_ok=True)
    if any(path.iterdir()):
        raise SystemExit(f"{label} was not empty after creation: {path}")


def identity(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    return {
        "path": path.resolve().relative_to(REPOSITORY_ROOT).as_posix(),
        "sha256": sha256_file(path),
        "inventory_id": value["inventory_id"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["linux", "windows"], required=True)
    parser.add_argument("--workpath", type=Path, required=True)
    parser.add_argument("--distpath", type=Path, required=True)
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--runtime-inventory", type=Path, required=True)
    parser.add_argument("--worker-build-inventory", type=Path, required=True)
    parser.add_argument("--runtime-identity", type=Path, required=True)
    parser.add_argument("--distribution", type=Path, required=True)
    parser.add_argument("--pip-wheel", type=Path, required=True)
    parser.add_argument("--pyinstaller-wheel", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    if PyInstaller.__version__ != EXPECTED_PYINSTALLER_VERSION:
        raise SystemExit(
            f"build context requires PyInstaller {EXPECTED_PYINSTALLER_VERSION}, got {PyInstaller.__version__}"
        )
    fresh_directory(arguments.workpath, "PyInstaller workpath")
    fresh_directory(arguments.distpath, "PyInstaller distpath")

    build_inputs = {
        "code_c_commit": git_head(),
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
        "pip_artifact": {
            "filename": arguments.pip_wheel.name,
            "sha256": sha256_file(arguments.pip_wheel),
        },
        "pyinstaller_artifact": {
            "filename": arguments.pyinstaller_wheel.name,
            "sha256": sha256_file(arguments.pyinstaller_wheel),
            "version": PyInstaller.__version__,
        },
        "wheel_inventories": [
            identity(arguments.runtime_inventory),
            identity(arguments.worker_build_inventory),
        ],
        "runtime_identity": {
            "path": arguments.runtime_identity.resolve().relative_to(REPOSITORY_ROOT).as_posix(),
            "sha256": sha256_file(arguments.runtime_identity),
        },
        "specification": {
            "path": arguments.spec.resolve().relative_to(REPOSITORY_ROOT).as_posix(),
            "sha256": sha256_file(arguments.spec),
        },
        "build_settings": {
            "clean": True,
            "noconfirm": True,
            "strip": False,
            "upx": False,
            "onefile": True,
            "workpath": arguments.workpath.resolve().relative_to(REPOSITORY_ROOT).as_posix(),
            "distpath": arguments.distpath.resolve().relative_to(REPOSITORY_ROOT).as_posix(),
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
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(canonical_pretty(document), encoding="utf-8")
    print(f"pyinstaller-build-context: PASS ({build_context_id})")


if __name__ == "__main__":
    main()
