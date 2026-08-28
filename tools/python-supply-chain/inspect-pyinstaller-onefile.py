from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath

import PyInstaller
from PyInstaller.archive.readers import CArchiveReader


EXPECTED_PYINSTALLER_VERSION = "6.22.2"


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def native_type(path: str) -> str | None:
    lower = path.lower()
    if lower.endswith(".pyd"):
        return "pyd"
    if lower.endswith(".dll"):
        return "dll"
    if lower.endswith(".dylib"):
        return "dylib"
    if lower.endswith(".so") or ".so." in lower:
        return "so"
    return None


def inspect(path: Path) -> dict[str, object]:
    if PyInstaller.__version__ != EXPECTED_PYINSTALLER_VERSION:
        raise SystemExit(
            f"archive inspector must use PyInstaller {EXPECTED_PYINSTALLER_VERSION}, got {PyInstaller.__version__}"
        )
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"final one-file artifact is missing or empty: {path}")
    final_bytes = path.read_bytes()
    try:
        reader = CArchiveReader(str(path))
        archive_bytes = reader.raw_pkg_data()
    except Exception as error:
        raise SystemExit(f"PyInstaller one-file CArchive parse failed: {error}") from error
    archive_start = final_bytes.rfind(archive_bytes)
    if archive_start <= 0:
        raise SystemExit("CArchive bytes were not located after a distinct bootloader layer")
    bootloader_bytes = final_bytes[:archive_start]
    trailing_bytes = final_bytes[archive_start + len(archive_bytes) :]
    entries = []
    for internal_path in sorted(reader.toc):
        kind = native_type(internal_path)
        if kind is None:
            continue
        try:
            value = reader.extract(internal_path)
        except Exception as error:
            raise SystemExit(f"failed to extract CArchive entry {internal_path}: {error}") from error
        if not isinstance(value, bytes):
            raise SystemExit(f"CArchive native entry is not byte content: {internal_path}")
        entries.append(
            {
                "filename": PurePosixPath(internal_path.replace("\\", "/")).name,
                "internal_path": internal_path.replace("\\", "/"),
                "sha256": sha256(value),
                "size": len(value),
                "type": kind,
            }
        )
    if len(reader.toc) == 0:
        raise SystemExit("CArchive parsed zero entries")
    if len(entries) == 0:
        raise SystemExit("CArchive parsed zero native entries; fail closed")
    return {
        "engine": "pyinstaller",
        "engine_version": PyInstaller.__version__,
        "reader": "PyInstaller.archive.readers.CArchiveReader",
        "status": "PARSED",
        "archive_entry_count": len(reader.toc),
        "native_entry_count": len(entries),
        "final_artifact": {
            "filename": path.name,
            "sha256": sha256(final_bytes),
            "size": len(final_bytes),
        },
        "bootloader_layer": {
            "sha256": sha256(bootloader_bytes),
            "size": len(bootloader_bytes),
        },
        "archive_payload": {
            "sha256": sha256(archive_bytes),
            "size": len(archive_bytes),
            "trailing_data_size": len(trailing_bytes),
        },
        "native_artifacts": entries,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    arguments = parser.parse_args()
    print(json.dumps(inspect(arguments.artifact), sort_keys=True))


if __name__ == "__main__":
    main()
