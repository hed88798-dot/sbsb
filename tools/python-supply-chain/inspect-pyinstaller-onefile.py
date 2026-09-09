from __future__ import annotations

import argparse
import hashlib
import io
import json
import zipfile
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


def decode_symlink_target(internal_path: str, payload: bytes) -> str:
    if not payload.endswith(b"\0") or payload.count(b"\0") != 1:
        raise ValueError(
            f"CArchive symlink entry has malformed NUL-terminated payload: {internal_path}"
        )
    try:
        target = payload[:-1].decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError(
            f"CArchive symlink entry target is not valid UTF-8: {internal_path}"
        ) from error
    if not target:
        raise ValueError(f"CArchive symlink entry has an empty target: {internal_path}")
    return target


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
    archive_entries = []
    native_entries = []
    symlink_entries = []
    for internal_path in sorted(reader.toc):
        entry_offset, data_length, uncompressed_length, compression_flag, typecode = reader.toc[
            internal_path
        ]
        try:
            value = reader.extract(internal_path)
        except Exception as error:
            raise SystemExit(f"failed to extract CArchive entry {internal_path}: {error}") from error
        if not isinstance(value, bytes):
            raise SystemExit(f"CArchive entry is not byte content: {internal_path}")
        normalized_path = internal_path.replace("\\", "/")
        filename = PurePosixPath(normalized_path).name
        storage = {
            "entry_offset": entry_offset,
            "compressed_size": data_length,
            "uncompressed_size": uncompressed_length,
            "compression_flag": compression_flag,
            "typecode": typecode,
        }
        entry = {
            "filename": filename,
            "internal_path": normalized_path,
            "payload_sha256": sha256(value),
            "payload_size": len(value),
            "storage": storage,
        }
        if typecode == "n":
            try:
                target = decode_symlink_target(normalized_path, value)
            except ValueError as error:
                raise SystemExit(str(error)) from error
            entry.update(
                {
                    "classification": "SYMLINK_METADATA",
                    "symlink_target": target.replace("\\", "/"),
                }
            )
            symlink_entries.append(entry)
        else:
            kind = native_type(normalized_path) if typecode == "b" else None
            if kind is not None:
                entry.update(
                    {
                        "classification": "EMBEDDED_NATIVE",
                        "type": kind,
                    }
                )
                # Keep this compatibility view schema-safe for the shared packaged-native v2
                # inventory. Full CArchive metadata remains in archive_entries.
                native_entries.append(
                    {
                        "filename": filename,
                        "internal_path": normalized_path,
                        "sha256": entry["payload_sha256"],
                        "size": entry["payload_size"],
                        "type": kind,
                    }
                )
            else:
                entry["classification"] = "NON_NATIVE_ARCHIVE_ENTRY"
        archive_entries.append(entry)
    pyz_modules: list[str] = []
    if "PYZ.pyz" in reader.toc:
        try:
            pyz_modules = sorted(reader.open_embedded_archive("PYZ.pyz").toc)
        except Exception as error:
            raise SystemExit(f"failed to inventory embedded PYZ modules: {error}") from error
    base_library_modules: list[str] = []
    if "base_library.zip" in reader.toc:
        try:
            base_library = reader.extract("base_library.zip")
            if not isinstance(base_library, bytes):
                raise TypeError("base_library.zip is not byte content")
            with zipfile.ZipFile(io.BytesIO(base_library)) as archive:
                names = archive.namelist()
                if len(names) != len(set(names)):
                    raise ValueError("base_library.zip contains duplicate paths")
                for name in names:
                    normalized = PurePosixPath(name.replace("\\", "/"))
                    if normalized.is_absolute() or ".." in normalized.parts:
                        raise ValueError(f"base_library.zip contains unsafe path: {name}")
                    if normalized.suffix == ".pyc":
                        base_library_modules.append(
                            ".".join(normalized.with_suffix("").parts)
                        )
            base_library_modules.sort()
        except Exception as error:
            raise SystemExit(f"failed to inventory base_library.zip modules: {error}") from error
    if len(reader.toc) == 0:
        raise SystemExit("CArchive parsed zero entries")
    if len(native_entries) == 0:
        raise SystemExit("CArchive parsed zero native entries; fail closed")
    return {
        "engine": "pyinstaller",
        "engine_version": PyInstaller.__version__,
        "reader": "PyInstaller.archive.readers.CArchiveReader",
        "status": "PARSED",
        "archive_entry_count": len(reader.toc),
        "native_entry_count": len(native_entries),
        "symlink_metadata_count": len(symlink_entries),
        "python_module_inventory": {
            "pyz_module_count": len(pyz_modules),
            "pyz_modules": pyz_modules,
            "base_library_module_count": len(base_library_modules),
            "base_library_modules": base_library_modules,
            "cve_relevant_module_presence": {
                "urllib.request": "urllib.request" in pyz_modules
                or "urllib.request" in base_library_modules,
                "zipfile": "zipfile" in pyz_modules or "zipfile" in base_library_modules,
            },
        },
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
        "archive_entries": archive_entries,
        "native_artifacts": native_entries,
        "symlink_metadata": symlink_entries,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("artifact", type=Path)
    arguments = parser.parse_args()
    print(json.dumps(inspect(arguments.artifact), sort_keys=True))


if __name__ == "__main__":
    main()
