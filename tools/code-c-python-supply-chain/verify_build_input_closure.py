from __future__ import annotations

import argparse
import json
import platform
from pathlib import Path

from canonical_evidence import write_canonical_json
from policy import sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOCK = REPOSITORY_ROOT / "sidecars/media-worker/supply-chain/toolchain-source-lock.json"


def exact_file(path: Path, expected_name: str, expected_sha: str, label: str) -> dict[str, object]:
    if path.name != expected_name or not path.is_file():
        raise SystemExit(f"{label} filename or file is not the approved artifact: {path}")
    actual = sha256_file(path)
    if actual != expected_sha:
        raise SystemExit(f"{label} bytes differ from the approved artifact: {path.name}")
    return {"filename": path.name, "sha256": actual, "size": path.stat().st_size}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["linux", "windows"], required=True)
    parser.add_argument("--runtime-inventory", type=Path, required=True)
    parser.add_argument("--worker-build-inventory", type=Path, required=True)
    parser.add_argument("--wheel-root", type=Path, required=True)
    parser.add_argument("--toolchain-root", type=Path, required=True)
    parser.add_argument("--distribution", type=Path, required=True)
    parser.add_argument("--pip-wheel", type=Path, required=True)
    parser.add_argument("--pyinstaller-wheel", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    inventories = []
    packages: dict[tuple[str, str], dict[str, object]] = {}
    for path in (arguments.runtime_inventory, arguments.worker_build_inventory):
        document = json.loads(path.read_text(encoding="utf-8"))
        if (
            document.get("schema_version") != "3"
            or document.get("subject_state") != "CANDIDATE"
            or document.get("target", {}).get("os") != arguments.target
            or document.get("target", {}).get("architecture") != "x86_64"
            or document.get("target", {}).get("python_version") != "3.13.15"
            or document.get("graph_complete") is not True
        ):
            raise SystemExit(f"inventory is not an approved complete {arguments.target} v3 subject: {path}")
        inventories.append({"path": str(path), "inventory_id": document["inventory_id"], "sha256": sha256_file(path)})
        for package in document["packages"]:
            key = (str(package["package_name"]).lower().replace("_", "-"), str(package["sha256"]))
            previous = packages.get((key[0], "any"))
            if previous and previous["sha256"] != package["sha256"]:
                raise SystemExit(f"conflicting approved wheel identity: {package['package_name']}")
            packages[(key[0], "any")] = package

    wheel_artifacts = []
    for package in sorted(packages.values(), key=lambda item: str(item["filename"])):
        wheel = (arguments.wheel_root / str(package["artifact_path"])).resolve()
        if not wheel.is_relative_to(arguments.wheel_root.resolve()):
            raise SystemExit(f"approved wheel path escapes the explicit wheel root: {wheel}")
        wheel_artifacts.append(
            {
                "package_name": package["package_name"],
                "version": package["version"],
                "purl": package["purl"],
                **exact_file(wheel, str(package["filename"]), str(package["sha256"]), "wheel"),
            }
        )

    source_lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
    target_lock = source_lock["targets"][arguments.target]
    toolchain_artifacts = {
        "cpython_distribution": exact_file(
            arguments.distribution,
            target_lock["cpython_distribution"]["filename"],
            target_lock["cpython_distribution"]["sha256"],
            "CPython distribution",
        ),
        "pip": exact_file(
            arguments.pip_wheel,
            source_lock["pip"]["filename"],
            source_lock["pip"]["sha256"],
            "pip wheel",
        ),
        "pyinstaller": exact_file(
            arguments.pyinstaller_wheel,
            target_lock["pyinstaller"]["filename"],
            target_lock["pyinstaller"]["sha256"],
            "PyInstaller wheel",
        ),
    }
    document = {
        "schema_version": "1",
        "status": "PASS",
        "target": {
            "os": arguments.target,
            "architecture": "x86_64",
            "python_version": "3.13.15",
            "implementation": "CPython",
        },
        "dependency_reresolution_during_build": "NO",
        "sdist_or_source_build_used": "NO",
        "inventories": inventories,
        "wheel_artifacts": wheel_artifacts,
        "toolchain_artifacts": toolchain_artifacts,
        "approved_index": source_lock["approved_index"],
        "packaging_mode": "LOCAL_EXACT_WHEELS_NO_INDEX_NO_DEPS_REQUIRE_HASHES",
    }
    result = write_canonical_json(arguments.output, document)
    print(f"build-input-closure: PASS ({len(wheel_artifacts)} wheels; sha256={result.canonical_file_sha256})")


if __name__ == "__main__":
    main()
