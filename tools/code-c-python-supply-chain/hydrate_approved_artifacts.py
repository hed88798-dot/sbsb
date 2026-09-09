from __future__ import annotations

import argparse
import json
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

from policy import assert_exact_wheel_url, sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def download(url: str, destination: Path, expected_hash: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.is_file() and sha256_file(destination) == expected_hash:
        return
    request = urllib.request.Request(url, headers={"Accept": "application/octet-stream"})
    with urllib.request.urlopen(request, timeout=120) as response:
        destination.write_bytes(response.read())
    if sha256_file(destination) != expected_hash:
        raise SystemExit(f"hydrated artifact hash mismatch: {destination.name}")


def extract_bootloader(wheel: Path, filename: str, expected_hash: str, destination: Path) -> None:
    with zipfile.ZipFile(wheel) as archive:
        matches = []
        for name in archive.namelist():
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name:
                raise SystemExit(f"PyInstaller wheel contains unsafe path: {name}")
            if path.name == filename and "bootloader" in path.parts:
                value = archive.read(name)
                if sha256_file_bytes(value) == expected_hash:
                    matches.append(value)
        if len(matches) != 1:
            raise SystemExit(f"approved bootloader has {len(matches)} exact wheel members")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(matches[0])


def sha256_file_bytes(value: bytes) -> str:
    import hashlib

    return hashlib.sha256(value).hexdigest()


def toolchain_artifact(component: dict[str, object], target: str) -> dict[str, object]:
    """Normalize the two approved Toolchain subject representations.

    The frozen Code F subject is the exact PYTHON_TOOLCHAIN_INTAKE_EVIDENCE
    document (component fields are flat).  A formal Toolchain v1 inventory,
    when present in a future bundle, nests the same artifact fields.  Both are
    accepted without changing the subject bytes or inventing approval data.
    """
    if isinstance(component.get("artifact"), dict):
        artifact = dict(component["artifact"])
        if not artifact.get("artifact_path"):
            raise SystemExit("approved Toolchain artifact is missing artifact_path")
        return artifact
    required = ("filename", "sha256", "canonical_reference", "canonical_source")
    if any(not component.get(field) for field in required):
        raise SystemExit("approved Toolchain intake component is incomplete")
    kind = str(component["component_kind"])
    directory = {
        "CPYTHON_DISTRIBUTION": "cpython",
        "PIP": "pip",
        "PYINSTALLER": "pyinstaller",
        "PYINSTALLER_BOOTLOADER": "bootloader",
    }.get(kind)
    if directory is None:
        raise SystemExit(f"unsupported approved Toolchain component: {kind}")
    return {
        "artifact_type": {
            "CPYTHON_DISTRIBUTION": "distribution",
            "PIP": "wheel",
            "PYINSTALLER": "wheel",
            "PYINSTALLER_BOOTLOADER": "bootloader",
        }[kind],
        "filename": component["filename"],
        "artifact_path": f"{target}/{directory}/{component['filename']}",
        "sha256": component["sha256"],
        "canonical_reference": component["canonical_reference"],
        "canonical_source": component["canonical_source"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--toolchain-artifact-root", type=Path, required=True)
    parser.add_argument(
        "--inventory",
        type=Path,
        action="append",
        help="exact approved Inventory v3 subject(s); defaults to repository artifacts",
    )
    parser.add_argument(
        "--toolchain-inventory",
        type=Path,
        help="exact approved Toolchain v1 subject; defaults to the repository path",
    )
    arguments = parser.parse_args()
    inventory_paths = arguments.inventory or sorted(
        (REPOSITORY_ROOT / "compliance" / "python-artifacts" / arguments.target).glob("*.json")
    )
    if not inventory_paths:
        raise SystemExit(f"no approved Python inventories for {arguments.target}")
    wheel_count = 0
    seen_artifacts: set[tuple[str, str]] = set()
    for path in inventory_paths:
        inventory = json.loads(path.read_text(encoding="utf-8"))
        if inventory.get("schema_version") != "3" or inventory.get("subject_state") != "CANDIDATE":
            raise SystemExit(f"approved build inputs must be Inventory v3 candidates: {path}")
        if inventory.get("target", {}).get("os") != arguments.target:
            raise SystemExit(f"inventory target differs from requested target: {path}")
        for package in inventory["packages"]:
            assert_exact_wheel_url(package["provenance"]["download_url"])
            identity = (package["filename"], package["sha256"])
            if identity in seen_artifacts:
                continue
            seen_artifacts.add(identity)
            download(
                package["provenance"]["download_url"],
                arguments.artifact_root / package["artifact_path"],
                package["sha256"],
            )
            wheel_count += 1

    toolchain_path = arguments.toolchain_inventory or (
        REPOSITORY_ROOT / "compliance" / "python-toolchain" / f"{arguments.target}.v1.json"
    )
    toolchain = json.loads(toolchain_path.read_text(encoding="utf-8"))
    if toolchain.get("target") not in (arguments.target, {"windows": "win32"}.get(arguments.target)):
        raise SystemExit("approved Toolchain subject target differs from requested target")
    if not isinstance(toolchain.get("components"), list):
        raise SystemExit("approved Toolchain subject has no component list")
    by_kind = {component["component_kind"]: component for component in toolchain["components"]}
    if set(by_kind) != {
        "CPYTHON_DISTRIBUTION",
        "PIP",
        "PYINSTALLER",
        "PYINSTALLER_BOOTLOADER",
    }:
        raise SystemExit("approved Toolchain subject must contain the four exact components")
    artifacts = {kind: toolchain_artifact(component, arguments.target) for kind, component in by_kind.items()}
    for kind in ("CPYTHON_DISTRIBUTION", "PIP", "PYINSTALLER"):
        artifact = artifacts[kind]
        url = artifact["canonical_reference"]
        if kind in {"PIP", "PYINSTALLER"}:
            assert_exact_wheel_url(url)
        elif not url.startswith("https://github.com/actions/python-versions/releases/download/"):
            raise SystemExit("unapproved CPython distribution URL")
        download(
            url,
            arguments.toolchain_artifact_root / artifact["artifact_path"],
            artifact["sha256"],
        )
    bootloader = artifacts["PYINSTALLER_BOOTLOADER"]
    pyinstaller = artifacts["PYINSTALLER"]
    extract_bootloader(
        arguments.toolchain_artifact_root / pyinstaller["artifact_path"],
        bootloader["filename"],
        bootloader["sha256"],
        arguments.toolchain_artifact_root / bootloader["artifact_path"],
    )
    print(
        f"approved-artifact-hydration: PASS ({arguments.target}; {wheel_count} wheel references; "
        "4 toolchain components)"
    )


if __name__ == "__main__":
    main()
