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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--toolchain-artifact-root", type=Path, required=True)
    arguments = parser.parse_args()
    inventory_paths = sorted(
        (REPOSITORY_ROOT / "compliance" / "python-artifacts" / arguments.target).glob("*.json")
    )
    if not inventory_paths:
        raise SystemExit(f"no approved Python inventories for {arguments.target}")
    wheel_count = 0
    for path in inventory_paths:
        inventory = json.loads(path.read_text(encoding="utf-8"))
        for package in inventory["packages"]:
            assert_exact_wheel_url(package["provenance"]["download_url"])
            download(
                package["provenance"]["download_url"],
                arguments.artifact_root / package["artifact_path"],
                package["sha256"],
            )
            wheel_count += 1

    toolchain_path = (
        REPOSITORY_ROOT / "compliance" / "python-toolchain" / f"{arguments.target}.v1.json"
    )
    toolchain = json.loads(toolchain_path.read_text(encoding="utf-8"))
    by_kind = {component["component_kind"]: component for component in toolchain["components"]}
    for kind in ("CPYTHON_DISTRIBUTION", "PIP", "PYINSTALLER"):
        component = by_kind[kind]
        url = component["artifact"]["canonical_reference"]
        if kind in {"PIP", "PYINSTALLER"}:
            assert_exact_wheel_url(url)
        elif not url.startswith("https://github.com/actions/python-versions/releases/download/"):
            raise SystemExit("unapproved CPython distribution URL")
        download(
            url,
            arguments.toolchain_artifact_root / component["artifact"]["artifact_path"],
            component["artifact"]["sha256"],
        )
    bootloader = by_kind["PYINSTALLER_BOOTLOADER"]
    pyinstaller = by_kind["PYINSTALLER"]
    extract_bootloader(
        arguments.toolchain_artifact_root / pyinstaller["artifact"]["artifact_path"],
        bootloader["artifact"]["filename"],
        bootloader["artifact"]["sha256"],
        arguments.toolchain_artifact_root / bootloader["artifact"]["artifact_path"],
    )
    print(
        f"approved-artifact-hydration: PASS ({arguments.target}; {wheel_count} wheel references; "
        "4 toolchain components)"
    )


if __name__ == "__main__":
    main()
