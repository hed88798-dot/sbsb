#!/usr/bin/env python3
"""Create exact-byte PyInstaller package and file-level license evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from email.parser import Parser
from pathlib import Path


SCANNER = "scan-pyinstaller-license-evidence.py"
SCANNER_VERSION = "1"
LICENSE_CANDIDATE = re.compile(
    r"(^|/)(copying|licen[cs]e|notice|copyright|authors?)([^/]*)$", re.IGNORECASE
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_hash(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return sha256(payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wheel", required=True)
    parser.add_argument("--mapping", required=True)
    args = parser.parse_args()

    wheel_path = Path(args.wheel)
    mapping = json.loads(Path(args.mapping).read_text(encoding="utf-8"))
    wheel_bytes = wheel_path.read_bytes()
    actual_hash = sha256(wheel_bytes)
    artifact = mapping["artifact"]
    if actual_hash != artifact["sha256"]:
        raise SystemExit(f"wheel SHA-256 mismatch: expected {artifact['sha256']}, got {actual_hash}")
    if wheel_path.name != artifact["filename"]:
        raise SystemExit(f"wheel filename mismatch: expected {artifact['filename']}")

    with zipfile.ZipFile(wheel_path) as archive:
        paths = sorted(name for name in archive.namelist() if not name.endswith("/"))
        metadata_paths = [name for name in paths if name.endswith(".dist-info/METADATA")]
        if len(metadata_paths) != 1:
            raise SystemExit("wheel must contain exactly one METADATA file")
        metadata = Parser().parsestr(archive.read(metadata_paths[0]).decode("utf-8"))
        if metadata["Name"].lower() != artifact["package"].lower():
            raise SystemExit("METADATA package name mismatch")
        if metadata["Version"] != artifact["version"]:
            raise SystemExit("METADATA version mismatch")
        if metadata.get("License") != mapping["metadata_license_description"]:
            raise SystemExit("METADATA legacy License description mismatch")

        candidates = sorted(name for name in paths if LICENSE_CANDIDATE.search(name))
        expected_candidates = sorted(mapping["expected_license_candidate_paths"])
        if candidates != expected_candidates:
            raise SystemExit(
                f"license candidate set mismatch: expected {expected_candidates}, got {candidates}"
            )

        evidence_sources = []
        for source in mapping["package_evidence_sources"]:
            record = dict(source)
            if "relative_path" in record:
                if record["relative_path"] not in paths:
                    raise SystemExit(f"evidence file missing: {record['relative_path']}")
                record["sha256"] = sha256(archive.read(record["relative_path"]))
                expected = source.get("expected_sha256")
                record.pop("expected_sha256", None)
                if expected and record["sha256"] != expected:
                    raise SystemExit(f"evidence file hash mismatch: {record['relative_path']}")
            evidence_sources.append(record)

        evidence_by_id = {entry["evidence_id"]: entry for entry in evidence_sources}
        scopes = []
        claimed_paths: set[str] = set()
        for configured in mapping["file_level_license_scopes"]:
            prefixes = configured["path_prefixes"]
            scoped_paths = sorted(
                name for name in paths if any(name.startswith(prefix) for prefix in prefixes)
            )
            if not scoped_paths:
                raise SystemExit(f"file-level scope is empty: {configured['scope_id']}")
            overlap = claimed_paths.intersection(scoped_paths)
            if overlap:
                raise SystemExit(f"file-level scopes overlap: {sorted(overlap)}")
            claimed_paths.update(scoped_paths)
            source_ids = configured["evidence_source_ids"]
            if any(source_id not in evidence_by_id for source_id in source_ids):
                raise SystemExit(f"unknown evidence source in scope: {configured['scope_id']}")
            scopes.append(
                {
                    "scope_id": configured["scope_id"],
                    "relationship": configured["relationship"],
                    "path_prefixes": prefixes,
                    "expression": configured["expression"],
                    "evidence_sources": [evidence_by_id[source_id] for source_id in source_ids],
                    "files": [
                        {"relative_path": name, "sha256": sha256(archive.read(name))}
                        for name in scoped_paths
                    ],
                }
            )

    document = {
        "schema_version": "2",
        "artifact": {
            "artifact_id": f"urn:sha256:{actual_hash}",
            **artifact,
        },
        "package_license": {
            "expression": mapping["package_license_expression"],
            "metadata_status": "LEGACY_DESCRIPTION_REVIEWED",
            "evidence_sources": evidence_sources,
        },
        "file_level_license_evidence": scopes,
        "scan": {
            "scanner": SCANNER,
            "scanner_version": SCANNER_VERSION,
            "wheel_entry_count": len(paths),
            "license_candidate_paths": candidates,
            "evidence_identity_sha256": "0" * 64,
        },
        "evidence_status": "PASS",
    }
    identity_input = json.loads(json.dumps(document))
    identity_input["scan"].pop("evidence_identity_sha256")
    document["scan"]["evidence_identity_sha256"] = canonical_hash(identity_input)
    print(json.dumps(document, indent=2, sort_keys=False))


if __name__ == "__main__":
    main()
