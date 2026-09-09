from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from email.parser import BytesParser
from pathlib import Path, PurePosixPath


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def license_text_signatures(value: bytes) -> list[str]:
    """Return conservative SPDX facts found in the exact license-file bytes.

    These are machine suggestions only.  The bytes and their SHA-256 remain the
    authority; a reviewer or the pinned policy still makes the final decision.
    """
    text = value.decode("utf-8", errors="replace").lower()
    signatures: list[str] = []
    if (
        "redistribution and use in source and binary forms" in text
        and "neither the name" in text
        and "all rights reserved" in text
    ):
        signatures.append("BSD-3-Clause")
    if (
        "permission is hereby granted, free of charge" in text
        and "the software" in text
        and "without warranty" in text
    ):
        signatures.append("MIT")
    if "mozilla public license" in text and "version 2.0" in text:
        signatures.append("MPL-2.0")
    if "gnu general public license" in text and "version 2" in text:
        signatures.append("GPL-2.0-or-later")
    if "apache license" in text and "version 2.0" in text:
        signatures.append("Apache-2.0")
    return sorted(set(signatures))


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


def safe_entry(name: str) -> None:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise SystemExit(f"wheel contains unsafe path: {name}")


def inspect(path: Path) -> dict[str, object]:
    if not path.is_file() or path.suffix.lower() != ".whl":
        raise SystemExit(f"not a wheel file: {path}")
    with zipfile.ZipFile(path) as wheel:
        names = wheel.namelist()
        if len(names) != len(set(names)):
            raise SystemExit(f"wheel contains duplicate archive paths: {path.name}")
        for name in names:
            safe_entry(name)
        metadata_names = [
            name for name in names if re.fullmatch(r"[^/]+\.dist-info/METADATA", name)
        ]
        if len(metadata_names) != 1:
            raise SystemExit(f"wheel must contain exactly one METADATA file: {path.name}")
        metadata_bytes = wheel.read(metadata_names[0])
        metadata = BytesParser().parsebytes(metadata_bytes)
        package_name = metadata.get("Name")
        version = metadata.get("Version")
        if not package_name or not version:
            raise SystemExit(f"wheel METADATA is missing Name/Version: {path.name}")
        license_expression = metadata.get("License-Expression")
        legacy_license = metadata.get("License")
        declared_license_files = metadata.get_all("License-File", [])
        dist_info = metadata_names[0].removesuffix("METADATA")
        license_entries = []
        for name in names:
            lower = name.lower()
            declared = any(
                name == declared_name or name == f"{dist_info}{declared_name}"
                for declared_name in declared_license_files
            )
            conventional_name = re.search(
                r"(?:^|/)(?:license|licence|copying|notice)(?:[._-]|$)", lower
            )
            conventional = conventional_name and (
                name.startswith(dist_info) or ".dist-info/" not in name
            )
            if declared or conventional:
                value = wheel.read(name)
                basename = PurePosixPath(name).name.lower()
                kind = (
                    "NOTICE"
                    if basename.startswith("notice")
                    else "COPYING"
                    if basename.startswith("copying")
                    else "LICENSE"
                    if basename.startswith(("license", "licence"))
                    else "OTHER_LICENSE_EVIDENCE"
                )
                license_entries.append(
                    {
                        "relative_path": name,
                        "kind": kind,
                        "sha256": sha256_bytes(value),
                        "size": len(value),
                        "spdx_signatures": license_text_signatures(value),
                    }
                )
        native_entries = []
        for name in names:
            kind = native_type(name)
            if kind:
                value = wheel.read(name)
                native_entries.append(
                    {
                        "filename": PurePosixPath(name).name,
                        "relative_path": name,
                        "sha256": sha256_bytes(value),
                        "size": len(value),
                        "type": kind,
                    }
                )
        requirements = []
        raw_requirements = metadata.get_all("Requires-Dist", [])
        for requirement in raw_requirements:
            match = re.match(r"\s*([A-Za-z0-9][A-Za-z0-9._-]*)", requirement)
            if match:
                requirements.append(match.group(1))
        return {
            "filename": path.name,
            "package_name": package_name,
            "version": version,
            "metadata_sha256": sha256_bytes(metadata_bytes),
            "license_expression": license_expression,
            "legacy_license": legacy_license,
            "license_classifiers": sorted(
                value
                for value in metadata.get_all("Classifier", [])
                if value.startswith("License ::")
            ),
            "declared_license_files": declared_license_files,
            "license_files": sorted(license_entries, key=lambda item: item["relative_path"]),
            "native_artifacts": sorted(native_entries, key=lambda item: item["relative_path"]),
            "requires_dist": sorted(set(requirements), key=str.lower),
            "requires_dist_raw": sorted(set(raw_requirements)),
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wheel", type=Path)
    arguments = parser.parse_args()
    print(json.dumps(inspect(arguments.wheel), sort_keys=True))


if __name__ == "__main__":
    main()
