#!/usr/bin/env python3
"""Create deterministic, artifact-bound license evidence for an exact wheel.

This scanner is deliberately offline and verify-only: a reviewed mapping supplies the
semantic identity of license sections, while this program proves that those sections,
metadata, native payloads, and license files occur in the exact wheel bytes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from email.parser import BytesParser
from email.policy import compat32
from pathlib import Path, PurePosixPath


EVIDENCE_NAME = re.compile(
    r"^(?:license|licence|copying|notice|authors?|copyright)(?:[._-].*)?$", re.IGNORECASE
)
NATIVE_NAME = re.compile(r"(?:\.pyd|\.dll|\.dylib|\.so(?:\..*)?)$", re.IGNORECASE)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_hash(value: object) -> str:
    encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return sha256(encoded.encode("utf-8"))


def evidence_path(path: str) -> bool:
    parts = PurePosixPath(path).parts
    if not parts or path.endswith("/"):
        return False
    return "licenses" in {part.lower() for part in parts} or EVIDENCE_NAME.match(parts[-1]) is not None


def parse_metadata(raw: bytes) -> dict[str, object]:
    message = BytesParser(policy=compat32).parsebytes(raw)
    return {
        "name": message.get("Name"),
        "version": message.get("Version"),
        "license_expression": message.get("License-Expression"),
        "license_files": message.get_all("License-File", []),
    }


def scan(wheel_path: Path, mapping: dict[str, object]) -> dict[str, object]:
    wheel_bytes = wheel_path.read_bytes()
    artifact_hash = sha256(wheel_bytes)
    expected = mapping["artifact"]
    if artifact_hash != expected["sha256"]:
        raise SystemExit(f"wheel SHA-256 mismatch: expected {expected['sha256']}, got {artifact_hash}")

    with zipfile.ZipFile(wheel_path) as archive:
        files = [item for item in archive.infolist() if not item.is_dir()]
        inventory = [
            {
                "path": item.filename,
                "size": item.file_size,
                "compressed_size": item.compress_size,
                "crc32": f"{item.CRC:08x}",
            }
            for item in sorted(files, key=lambda entry: entry.filename)
        ]
        metadata_entries = [item for item in files if item.filename.endswith(".dist-info/METADATA")]
        if len(metadata_entries) != 1:
            raise SystemExit(f"expected exactly one METADATA file, got {len(metadata_entries)}")
        metadata_item = metadata_entries[0]
        metadata_raw = archive.read(metadata_item)
        metadata = parse_metadata(metadata_raw)
        for field in ("name", "version", "license_expression"):
            if metadata[field] != expected[field]:
                raise SystemExit(
                    f"METADATA {field} mismatch: expected {expected[field]!r}, got {metadata[field]!r}"
                )

        license_items = [item for item in files if evidence_path(item.filename)]
        if not license_items:
            raise SystemExit("wheel contains no license/notice evidence files")
        license_files = []
        decoded_by_path: dict[str, str] = {}
        for item in sorted(license_items, key=lambda entry: entry.filename):
            raw = archive.read(item)
            normalized = raw.replace(b"\r\n", b"\n")
            materialized = b"\n".join(line.rstrip(b" \t") for line in normalized.split(b"\n"))
            decoded_by_path[item.filename] = normalized.decode("utf-8")
            license_files.append(
                {
                    "relative_path": item.filename,
                    "size": len(raw),
                    "sha256": sha256(raw),
                    "normalized_lf_sha256": sha256(normalized),
                    "materialized_text_sha256": sha256(materialized),
                }
            )

        native_artifacts = []
        for item in sorted(files, key=lambda entry: entry.filename):
            if not NATIVE_NAME.search(item.filename):
                continue
            raw = archive.read(item)
            native_artifacts.append(
                {
                    "relative_path": item.filename,
                    "size": len(raw),
                    "sha256": sha256(raw),
                }
            )

    by_basename = {PurePosixPath(entry["relative_path"]).name: entry for entry in license_files}
    bundled_components = []
    for component in mapping["bundled_components"]:
        evidence = by_basename.get(component["license_file_basename"])
        if evidence is None:
            raise SystemExit(
                f"{component['component_id']}: mapped license file is absent: "
                f"{component['license_file_basename']}"
            )
        text = decoded_by_path[evidence["relative_path"]]
        if component["section_marker"] not in text:
            raise SystemExit(
                f"{component['component_id']}: section marker is absent: {component['section_marker']!r}"
            )
        bundled_components.append(
            {
                **component,
                "evidence_relative_path": evidence["relative_path"],
                "evidence_sha256": evidence["sha256"],
                "evidence_normalized_lf_sha256": evidence["normalized_lf_sha256"],
                "evidence_materialized_text_sha256": evidence["materialized_text_sha256"],
                "inclusion_evidence": "LICENSE_SECTION_IN_DISTRIBUTED_WHEEL",
            }
        )

    result = {
        "schema_version": "1",
        "scanner": {
            "name": "code-f-wheel-license-evidence-scan",
            "version": "1.0.0",
            "mode": "OFFLINE_EXACT_BYTES",
        },
        "artifact": {
            **expected,
            "size": len(wheel_bytes),
            "archive_inventory_sha256": canonical_hash(inventory),
        },
        "metadata": {
            "relative_path": metadata_item.filename,
            "sha256": sha256(metadata_raw),
            **metadata,
        },
        "license_evidence_files": license_files,
        "native_artifacts": native_artifacts,
        "bundled_components": bundled_components,
        "bundled_third_party_license_evidence": (
            "DETECTED_AND_SEPARATELY_RECORDED" if bundled_components else "NONE_DETECTED_BY_APPROVED_SCAN"
        ),
    }
    result["evidence_identity_sha256"] = canonical_hash(result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wheel", required=True, type=Path)
    parser.add_argument("--mapping", required=True, type=Path)
    args = parser.parse_args()
    mapping = json.loads(args.mapping.read_text(encoding="utf-8"))
    print(json.dumps(scan(args.wheel, mapping), ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
