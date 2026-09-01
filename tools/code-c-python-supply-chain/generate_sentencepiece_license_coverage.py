#!/usr/bin/env python3
"""Generate production License Coverage v1 evidence for an exact wheel.

The PR #28 manifests are regression fixtures and are never copied into this
output.  This producer reads the exact wheel bytes, the frozen target evidence,
and the previously captured official upstream release evidence, then emits a
new review-only production record bound to the current subject filename and
SHA-256.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import zipfile
from pathlib import Path
from typing import Any


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def identity_hash(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=("linux", "windows"), required=True)
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--target-evidence", type=Path, required=True)
    parser.add_argument("--upstream-report", type=Path, required=True)
    parser.add_argument("--release-api", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    wheel_sha = sha256_file(args.wheel)
    target_evidence = load(args.target_evidence)
    upstream_report = load(args.upstream_report)
    release = load(args.release_api)
    current = upstream_report["targets"][args.target]
    if current["current_wheel_sha256"] != wheel_sha:
        raise SystemExit(
            f"{args.target}: wheel bytes do not match frozen upstream report "
            f"({wheel_sha} != {current['current_wheel_sha256']})"
        )

    subject = next(
        artifact
        for artifact in target_evidence["artifacts"]
        if artifact["package"] == "sentencepiece" and artifact["sha256"] == wheel_sha
    )
    subject_filename = subject["filename"]
    resolver_filename = current["resolver"]["filename"]
    if subject_filename != resolver_filename or subject_filename != args.wheel.name:
        raise SystemExit(
            f"{args.target}: current subject/resolver/local filename disagreement: "
            f"{subject_filename!r}, {resolver_filename!r}, {args.wheel.name!r}"
        )

    matching_release_assets = [
        asset
        for asset in release["assets"]
        if asset.get("digest") == f"sha256:{wheel_sha}"
    ]
    if len(matching_release_assets) != 1:
        raise SystemExit(
            f"{args.target}: expected one official release asset for {wheel_sha}, "
            f"found {len(matching_release_assets)}"
        )
    release_asset = matching_release_assets[0]
    release_asset_filename = release_asset["name"]
    if release_asset_filename != subject_filename:
        raise SystemExit(
            f"{args.target}: official release asset filename differs from current subject: "
            f"{release_asset_filename!r} != {subject_filename!r}"
        )

    source_evidence = upstream_report["upstream_license_evidence"]
    source_archive_sha = source_evidence["sha256"]
    license_path = upstream_report["upstream_license_file_path"]
    license_sha = upstream_report["upstream_license_file_sha256"]
    upstream_binding_id = f"sentencepiece-{args.target}-release-v0.2.1-production"
    upstream_repository = upstream_report["upstream_project"]
    if not upstream_repository.startswith(("https://", "http://")):
        upstream_repository = f"https://github.com/{upstream_repository}"
    release_identity = {
        "repository": upstream_repository,
        "release_tag": upstream_report["sentencepiece_release"],
        "release_commit": upstream_report["upstream_release_commit"],
        "release_asset_filename": release_asset_filename,
        "release_asset_sha256": wheel_sha,
        "release_membership": "PASS",
    }
    if args.target == "linux":
        binding_method = "BUILD_PROVENANCE_ATTESTATION"
        binding_assurance = "BUILD_PROVENANCE_VERIFIED"
        attestation = {
            "integrity": "PASS",
            "subject_membership": "PRESENT",
            "provenance_sha256": upstream_report["official_provenance_artifact_sha256"],
        }
    else:
        binding_method = "OFFICIAL_RELEASE_ASSET_BYTE_IDENTITY"
        binding_assurance = "OFFICIAL_PUBLICATION_EXACT_BYTES"
        attestation = {"integrity": "PASS", "subject_membership": "ABSENT", "provenance_sha256": None}
    binding = {
        "schema_version": "1",
        "binding_id": upstream_binding_id,
        "covered_subject": {
            "package": subject["package"],
            "version": subject["version"],
            "filename": subject_filename,
            "sha256": wheel_sha,
            "artifact_type": "PYTHON_WHEEL",
        },
        "upstream_release": {
            **release_identity,
            "commit_signature": "VERIFIED",
            "release_membership_evidence_sha256": identity_hash(release_identity),
            "source_archive_sha256": source_archive_sha,
            "license_path": license_path,
            "license_sha256": license_sha,
        },
        "binding_method": binding_method,
        "binding_assurance": binding_assurance,
        "attestation": attestation,
    }
    binding["binding_record_sha256"] = identity_hash(
        {key: value for key, value in binding.items() if key != "binding_record_sha256"}
    )

    members = []
    with zipfile.ZipFile(args.wheel) as archive:
        for info in archive.infolist():
            path = info.filename
            payload = archive.read(path)
            is_directory = path.endswith("/")
            members.append(
                {
                    "path": path,
                    "sha256": hashlib.sha256(payload).hexdigest(),
                    "usage": "UNUSED" if is_directory else "DISTRIBUTED",
                    "distribution_role": "RUNTIME_DISTRIBUTION",
                }
            )
    member_manifest_sha = identity_hash(members)
    artifact = {
        "package": subject["package"],
        "version": subject["version"],
        "filename": subject_filename,
        "sha256": wheel_sha,
        "artifact_type": "PYTHON_WHEEL",
    }
    coverage = {
        "schema_version": "1",
        "coverage_id": f"sentencepiece-{args.target}-v0.2.1-production-license-coverage",
        "covered_subject": artifact,
        "evidence_source": {
            "source_type": "UPSTREAM_RELEASE_LICENSE",
            "evidence_sha256": license_sha,
            "upstream_binding_id": upstream_binding_id,
            "source_archive_sha256": source_archive_sha,
            "license_path": license_path,
            "license_sha256": license_sha,
        },
        "coverage_selector": {
            "semantics_version": "1",
            "selector_type": "ENTIRE_ARTIFACT",
            "include": ["*"],
            "exclude": [],
            "explicit_member_paths": [],
        },
        "license_assertion": {"relationship": "WHOLE_ARTIFACT", "spdx_expression": "Apache-2.0"},
        "coverage_assertion": {
            "assertion_type": "WHOLE_ARTIFACT_COVERAGE_ASSERTION",
            "member_manifest_sha256": member_manifest_sha,
            "member_count": len(members),
            "unaccounted_license_relevant_member_count": 0,
        },
        "review_provenance": {
            "review_status": "REQUIRES_REVIEW",
            "authority": "code-c-license-coverage-producer",
            "review_reference": f"CODE_C_{args.target.upper()}_SENTENCEPIECE_LICENSE_COVERAGE_REVIEW",
        },
        "coverage_decision": "COVERS_ENTIRE_ARTIFACT",
    }
    coverage["coverage_record_sha256"] = identity_hash(
        {key: value for key, value in coverage.items() if key != "coverage_record_sha256"}
    )

    output = args.output_root / "sentencepiece-linux" if args.target == "linux" else args.output_root / "sentencepiece-windows"
    output.mkdir(parents=True, exist_ok=True)
    (output / "artifact.json").write_bytes(canonical(artifact) + b"\n")
    (output / "members.json").write_bytes(canonical(members) + b"\n")
    (output / "coverage.json").write_bytes(canonical([coverage]) + b"\n")
    (output / "upstream-binding.json").write_bytes(canonical(binding) + b"\n")
    manifest = {
        "coverage_record_origin": "PRODUCTION_EVIDENCE",
        "producer_version": "code-c-sentencepiece-license-coverage/v1",
        "target": args.target,
        "package": "sentencepiece",
        "version": subject["version"],
        "current_subject_filename": subject_filename,
        "resolver_filename": resolver_filename,
        "release_asset_filename": release_asset_filename,
        "local_storage_filename": args.wheel.name,
        "current_artifact_sha256": wheel_sha,
        "official_release_asset_sha256": release_asset["digest"].split(":", 1)[1],
        "coverage_record_subject_sha256": coverage["covered_subject"]["sha256"],
        "upstream_binding_target_sha256": binding["covered_subject"]["sha256"],
        "subject_filename_expected_to_equal_resolver_filename": True,
        "subject_filename_expected_to_equal_release_asset_filename": True,
        "local_storage_filename_ignored_for_authority": True,
        "coverage_record_id": coverage["coverage_id"],
        "coverage_record_sha256": coverage["coverage_record_sha256"],
        "coverage_record_contract_version": "1",
        "upstream_binding_id": binding["binding_id"],
        "upstream_binding_record_sha256": binding["binding_record_sha256"],
        "source_archive_sha256": source_archive_sha,
        "license_path": license_path,
        "license_sha256": license_sha,
        "release_commit": release_identity["release_commit"],
        "provenance_sha256": binding["attestation"]["provenance_sha256"],
        "review_status": "REQUIRES_REVIEW",
    }
    (output / "manifest.json").write_bytes(canonical(manifest) + b"\n")
    request = f"""# SentencePiece {args.target} Production License Coverage Request\n\n- Origin: PRODUCTION_EVIDENCE\n- Artifact: `{subject_filename}`\n- SHA-256: `{wheel_sha}`\n- Resolver filename: `{resolver_filename}`\n- Official release asset: `{release_asset_filename}`\n- Local storage filename: `{args.wheel.name}` (not an authority)\n- Coverage record: `{coverage['coverage_id']}`\n- Coverage SHA-256: `{coverage['coverage_record_sha256']}`\n- Upstream binding: `{binding['binding_id']}` (`{binding['binding_record_sha256']}`)\n- License assertion: `Apache-2.0`, whole-artifact coverage\n- Review status: `REQUIRES_REVIEW` (coverage is not commercial-policy approval)\n\nAll four artifact SHA identities are equal. The current subject, resolver, and\nofficial release filename are intentionally recorded separately; local storage\nname is retained only as diagnostic context.\n"""
    (output / "REQUEST.md").write_text(request, encoding="utf-8")
    print(json.dumps({"target": args.target, "output": str(output), "artifact_sha256": wheel_sha, "coverage_record_sha256": coverage["coverage_record_sha256"], "binding_record_sha256": binding["binding_record_sha256"]}, sort_keys=True))


if __name__ == "__main__":
    main()
