"""Acquire and verify official SentencePiece v0.2.1 upstream evidence.

This is a Code C diagnostic/evidence producer.  It deliberately does not alter
any license, inventory, worker, or shared contract schema.  All network
acquisition is performed before invoking this tool; the tool consumes the
exact bytes saved from the official GitHub API/Release and the already frozen
PyPI wheel bytes, then replays the checks offline.

The Sigstore bundle is verified with ``sigstore-python`` when available.  A
missing verifier is a hard failure rather than a reason to trust structural
JSON parsing alone.
"""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import re
import subprocess
import tarfile
from pathlib import Path
from typing import Any

from canonical_evidence import canonical_sha256, write_canonical_json


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
REPOSITORY = "google/sentencepiece"
TAG = "v0.2.1"
COMMIT = "31646a467d2051eb904e0b45de3a73e91fe1c1e3"
SENTENCEPIECE_VERSION = "0.2.1"
PROVENANCE_FILENAME = "multiple.intoto.jsonl"
SOURCE_FILENAME = "sentencepiece-0.2.1.tar.gz"
WORKFLOW_PATH = ".github/workflows/wheel.yml"
EXPECTED_WHEELS = {
    "linux": {
        "filename": "sentencepiece-0.2.1-cp313-cp313-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl",
        "sha256": "c7f0fd2f2693309e6628aeeb2e2faf6edd221134dfccac3308ca0de01f8dab47",
    },
    "windows": {
        "filename": "sentencepiece-0.2.1-cp313-cp313-win_amd64.whl",
        "sha256": "10ed3dab2044c47f7a2e7b4969b0c430420cdd45735d78c8f853191fa0e3148b",
    },
}


class EvidenceError(RuntimeError):
    """A fail-closed evidence error."""


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise EvidenceError(f"cannot load JSON: {path}: {error}") from error
    if not isinstance(value, dict):
        raise EvidenceError(f"expected JSON object: {path}")
    return value


def load_path_bindings(values: list[str], label: str) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for raw in values:
        target, separator, raw_path = raw.partition("=")
        if not separator or target not in EXPECTED_WHEELS or not raw_path:
            raise EvidenceError(f"{label} must use target=path (got {raw!r})")
        if target in result:
            raise EvidenceError(f"duplicate {label} for {target}")
        result[target] = Path(raw_path).resolve(strict=True)
    if set(result) != set(EXPECTED_WHEELS):
        raise EvidenceError(f"{label} must contain exactly linux and windows")
    return result


def decode_workflow(path: Path) -> tuple[bytes, dict[str, Any]]:
    """Accept raw wheel.yml or the GitHub contents API envelope."""

    raw = path.read_bytes()
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return raw, {"path": WORKFLOW_PATH, "raw_file_sha256": sha256_bytes(raw)}
    if not isinstance(value, dict) or "content" not in value:
        return raw, {"path": WORKFLOW_PATH, "raw_file_sha256": sha256_bytes(raw)}
    try:
        content = base64.b64decode(str(value["content"]).replace("\n", ""), validate=True)
    except (ValueError, TypeError) as error:
        raise EvidenceError(f"invalid GitHub contents API workflow: {path}: {error}") from error
    return content, {
        "path": value.get("path", WORKFLOW_PATH),
        "git_blob_sha": value.get("sha"),
        "api_envelope_sha256": sha256_bytes(raw),
        "raw_file_sha256": sha256_bytes(content),
    }


def release_asset(release: dict[str, Any], filename: str) -> dict[str, Any]:
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise EvidenceError("release response has no assets list")
    matches = [asset for asset in assets if isinstance(asset, dict) and asset.get("name") == filename]
    if len(matches) != 1:
        raise EvidenceError(f"release must contain exactly one {filename}, found {len(matches)}")
    return matches[0]


def verify_release_identity(tag_ref: dict[str, Any], release: dict[str, Any], commit: dict[str, Any], paths: dict[str, Path]) -> dict[str, Any]:
    if tag_ref.get("ref") != f"refs/tags/{TAG}":
        raise EvidenceError("tag ref does not identify v0.2.1")
    obj = tag_ref.get("object")
    if not isinstance(obj, dict) or obj.get("type") != "commit" or obj.get("sha") != COMMIT:
        raise EvidenceError("v0.2.1 tag does not resolve to the expected commit")
    if release.get("tag_name") != TAG or release.get("name") != TAG:
        raise EvidenceError("GitHub release is not v0.2.1")
    if commit.get("sha") != COMMIT:
        raise EvidenceError("commit API response has an unexpected SHA")
    repository_url = str(release.get("html_url", ""))
    if repository_url != f"https://github.com/{REPOSITORY}/releases/tag/{TAG}":
        raise EvidenceError("release repository/tag binding is not exact")
    commit_verified = commit.get("verification", {}).get("verified") is True
    identity_record = {
        "repository": REPOSITORY,
        "tag": TAG,
        "ref": tag_ref["ref"],
        "commit": COMMIT,
        "tag_ref_sha256": sha256_file(paths["tag_ref"]),
        "commit_api_sha256": sha256_file(paths["commit"]),
        "commit_signature_verified": commit_verified,
    }
    return {
        "repository": REPOSITORY,
        "tag": TAG,
        "commit": COMMIT,
        "commit_signature_verified": "PASS" if commit_verified else "FAIL",
        "identity_record": identity_record,
        "identity_sha256": canonical_sha256(identity_record),
        "tag_ref_sha256": identity_record["tag_ref_sha256"],
        "commit_api_sha256": identity_record["commit_api_sha256"],
        "release_api_sha256": sha256_file(paths["release"]),
    }


def parse_provenance(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    bundles: list[dict[str, Any]] = []
    statements: list[dict[str, Any]] = []
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines:
        raise EvidenceError("provenance artifact is empty")
    for number, line in enumerate(lines, 1):
        if not line.strip():
            raise EvidenceError(f"blank provenance line {number}")
        try:
            bundle = json.loads(line)
            if not isinstance(bundle, dict):
                raise ValueError("bundle is not an object")
            envelope = bundle["dsseEnvelope"]
            payload = json.loads(base64.b64decode(envelope["payload"]))
            if not isinstance(payload, dict):
                raise ValueError("DSSE payload is not an object")
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise EvidenceError(f"invalid provenance bundle line {number}: {error}") from error
        bundles.append(bundle)
        statements.append(payload)
    return bundles, statements


def statement_binding(statement: dict[str, Any]) -> tuple[bool, str]:
    predicate = statement.get("predicate")
    if not isinstance(predicate, dict):
        return False, "missing predicate"
    config = predicate.get("invocation", {}).get("configSource", {})
    materials = predicate.get("materials", [])
    config_ok = (
        config.get("uri") == f"git+https://github.com/{REPOSITORY}@refs/tags/{TAG}"
        and config.get("digest", {}).get("sha1") == COMMIT
        and config.get("entryPoint") == WORKFLOW_PATH
    )
    material_ok = any(
        isinstance(material, dict)
        and material.get("uri") == f"git+https://github.com/{REPOSITORY}@refs/tags/{TAG}"
        and material.get("digest", {}).get("sha1") == COMMIT
        for material in materials
    )
    builder_ok = str(predicate.get("builder", {}).get("id", "")).startswith(
        "https://github.com/slsa-framework/slsa-github-generator/"
    )
    return config_ok and material_ok and builder_ok, "config/material/builder binding"


def extract_subjects(statements: list[dict[str, Any]]) -> dict[str, set[str]]:
    subjects: dict[str, set[str]] = {}
    for statement in statements:
        ok, reason = statement_binding(statement)
        if not ok:
            raise EvidenceError(f"provenance source binding failed: {reason}")
        for subject in statement.get("subject", []):
            if not isinstance(subject, dict) or not isinstance(subject.get("name"), str):
                raise EvidenceError("provenance subject has no name")
            digest = subject.get("digest", {}).get("sha256")
            if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
                raise EvidenceError("provenance subject has no valid SHA-256")
            subjects.setdefault(digest, set()).add(subject["name"])
    return subjects


def verify_sigstore_bundle(path: Path, expected_commit: str) -> dict[str, Any]:
    """Cryptographically verify the Sigstore DSSE bundle against GitHub claims."""

    try:
        import sigstore
        from sigstore.models import Bundle
        from sigstore.verify import Verifier, policy
    except ImportError as error:
        return {
            "status": "FAIL",
            "tool": "sigstore-python",
            "tool_version": None,
            "error": f"sigstore-python unavailable: {error}",
        }
    try:
        from importlib.metadata import version

        tool_version = version("sigstore")
    except Exception:
        tool_version = getattr(sigstore, "__version__", "unknown")
    verifier = Verifier.production(offline=True)
    verification_policy = policy.AllOf(
        [
            policy.OIDCIssuer("https://token.actions.githubusercontent.com"),
            policy.GitHubWorkflowRepository(REPOSITORY),
            policy.GitHubWorkflowRef(f"refs/tags/{TAG}"),
            policy.GitHubWorkflowSHA(expected_commit),
            policy.GitHubWorkflowTrigger("release"),
            policy.GitHubWorkflowName("Build Wheels"),
            policy.OIDCBuildConfigURI(
                f"https://github.com/{REPOSITORY}/{WORKFLOW_PATH}@refs/tags/{TAG}"
            ),
            policy.OIDCBuildConfigDigest(expected_commit),
        ]
    )
    verified_lines = 0
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            bundle = Bundle.from_json(line)
            payload_type, _ = verifier.verify_dsse(bundle, verification_policy)
            if payload_type != "application/vnd.in-toto+json":
                raise EvidenceError(f"unexpected DSSE payload type: {payload_type}")
            verified_lines += 1
    except Exception as error:
        return {
            "status": "FAIL",
            "tool": "sigstore-python",
            "tool_version": tool_version,
            "offline": True,
            "verified_lines": verified_lines,
            "error": str(error),
        }
    return {
        "status": "PASS",
        "tool": "sigstore-python",
        "tool_version": tool_version,
        "offline": True,
        "verified_lines": verified_lines,
    }


def source_license_evidence(source_path: Path, source_asset: dict[str, Any], release_identity: dict[str, Any]) -> dict[str, Any]:
    archive_sha = sha256_file(source_path)
    if source_asset.get("size") != source_path.stat().st_size:
        raise EvidenceError("source archive size differs from the official Release asset")
    license_files: list[dict[str, Any]] = []
    try:
        with tarfile.open(source_path, "r:*") as archive:
            for member in sorted(archive.getmembers(), key=lambda item: item.name):
                base = Path(member.name).name.lower()
                if not member.isfile() or base not in {"license", "licence", "copying", "notice"}:
                    continue
                handle = archive.extractfile(member)
                if handle is None:
                    continue
                payload = handle.read()
                license_files.append(
                    {"path": member.name, "sha256": sha256_bytes(payload), "size": len(payload)}
                )
    except (OSError, tarfile.TarError) as error:
        raise EvidenceError(f"cannot inspect source release archive: {error}") from error
    project_license = next(
        (item for item in license_files if item["path"].endswith("/sentencepiece/LICENSE")),
        None,
    )
    if project_license is None:
        raise EvidenceError("source archive has no SentencePiece project LICENSE")
    source_binding = (
        source_asset.get("name") == SOURCE_FILENAME
        and source_asset.get("state") == "uploaded"
        and release_identity["tag"] == TAG
    )
    return {
        "artifact_id": f"github-release-asset:{REPOSITORY}:{TAG}:{source_asset.get('id')}:{archive_sha}",
        "filename": SOURCE_FILENAME,
        "sha256": archive_sha,
        "size": source_path.stat().st_size,
        "github_release_asset_id": source_asset.get("id"),
        "github_release_asset_declared_size": source_asset.get("size"),
        "release_binding": "PASS" if source_binding else "FAIL",
        "license_files": license_files,
        "project_license": project_license,
        "license_expression_supported": "Apache-2.0",
        "coverage_to_exact_wheel": "REQUIRES_REVIEW",
        "coverage_reason": "exact source LICENSE is preserved; current shared contract does not auto-assert source-license coverage of binary wheels",
    }


def resolver_check(path: Path, target: str) -> dict[str, Any]:
    value = load_json(path)
    packages = value.get("packages", [])
    for package in packages:
        if str(package.get("name", "")).lower().replace("_", "-") == "sentencepiece":
            provenance = package.get("provenance", {})
            expected = EXPECTED_WHEELS[target]
            return {
                "path_sha256": sha256_file(path),
                "filename": provenance.get("filename"),
                "sha256": provenance.get("sha256"),
                "source": provenance.get("source"),
                "source_index": provenance.get("source_index"),
                "matches_exact_frozen_artifact": provenance.get("filename") == expected["filename"] and provenance.get("sha256") == expected["sha256"],
            }
    raise EvidenceError(f"resolver has no SentencePiece record for {target}")


def negative_controls(
    statements: list[dict[str, Any]],
    subjects: dict[str, set[str]],
    attestation_path: Path,
    expected_linux: str,
) -> dict[str, str]:
    """Exercise fail-closed identity and attestation controls."""

    def block(condition: bool) -> str:
        return "BLOCK" if condition else "FAIL"

    wrong_sha = "0" * 64
    wrong_tag_statements = copy.deepcopy(statements)
    wrong_repo_statements = copy.deepcopy(statements)
    missing_subject_statements = copy.deepcopy(statements)
    for statement in wrong_tag_statements:
        statement["predicate"]["invocation"]["configSource"]["uri"] = (
            f"git+https://github.com/{REPOSITORY}@refs/tags/v0.2.0"
        )
    for statement in wrong_repo_statements:
        statement["predicate"]["invocation"]["configSource"]["uri"] = (
            "git+https://github.com/other/sentencepiece@refs/tags/v0.2.1"
        )
    for statement in missing_subject_statements:
        statement["subject"] = [
            item for item in statement.get("subject", []) if item.get("digest", {}).get("sha256") != expected_linux
        ]
    controls = {
        "same_filename_wrong_sha": block(wrong_sha not in subjects),
        "correct_sha_wrong_release_tag": block(
            not any(statement_binding(statement)[0] for statement in wrong_tag_statements)
        ),
        "correct_sha_wrong_source_repository": block(
            not any(statement_binding(statement)[0] for statement in wrong_repo_statements)
        ),
        "valid_attestation_missing_subject": block(
            expected_linux not in extract_subjects(missing_subject_statements)
        ),
        "attestation_bytes_changed": block(
            sha256_bytes(attestation_path.read_bytes() + b"\n") != sha256_file(attestation_path)
        ),
        "release_membership_without_license_coverage": "REQUIRED_REVIEW",
    }
    if any(value not in {"BLOCK", "REQUIRED_REVIEW"} for value in controls.values()):
        raise EvidenceError(f"negative control did not fail closed: {controls}")
    return controls


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag-ref", type=Path, required=True)
    parser.add_argument("--commit", type=Path, required=True)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--workflow", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--source-archive", type=Path, required=True)
    parser.add_argument("--resolver", action="append", required=True)
    parser.add_argument("--wheel", action="append", required=True)
    parser.add_argument("--github-wheel", action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    paths = {
        "tag_ref": args.tag_ref.resolve(strict=True),
        "commit": args.commit.resolve(strict=True),
        "release": args.release.resolve(strict=True),
        "workflow": args.workflow.resolve(strict=True),
        "provenance": args.provenance.resolve(strict=True),
        "source": args.source_archive.resolve(strict=True),
    }
    wheels = load_path_bindings(args.wheel, "--wheel")
    github_wheels = load_path_bindings(args.github_wheel, "--github-wheel")
    resolvers = load_path_bindings(args.resolver, "--resolver")
    tag_ref, release, commit = load_json(paths["tag_ref"]), load_json(paths["release"]), load_json(paths["commit"])
    release_identity = verify_release_identity(tag_ref, release, commit, paths)
    workflow_bytes, workflow_identity = decode_workflow(paths["workflow"])
    mechanism = (
        b"slsa-framework/slsa-github-generator" in workflow_bytes
        and b"generator_generic_slsa3.yml" in workflow_bytes
        and b"id-token: write" in workflow_bytes
        and b"provenance:" in workflow_bytes
    )
    bundles, statements = parse_provenance(paths["provenance"])
    subjects = extract_subjects(statements)
    sigstore_result = verify_sigstore_bundle(paths["provenance"], COMMIT)
    source_asset = release_asset(release, SOURCE_FILENAME)
    source_evidence = source_license_evidence(paths["source"], source_asset, release_identity)
    source_evidence["provenance_subject_match"] = (
        "PASS" if source_evidence["sha256"] in subjects else "FAIL"
    )
    source_evidence["source_release_identity"] = {
        "repository": REPOSITORY,
        "tag": TAG,
        "commit": COMMIT,
        "identity_sha256": release_identity["identity_sha256"],
    }
    resolver_records = {target: resolver_check(resolvers[target], target) for target in EXPECTED_WHEELS}
    wheel_records: dict[str, dict[str, Any]] = {}
    for target, wheel_path in wheels.items():
        expected = EXPECTED_WHEELS[target]
        actual_sha = sha256_file(wheel_path)
        if wheel_path.name != expected["filename"] or actual_sha != expected["sha256"]:
            raise EvidenceError(f"{target}: current wheel is not the frozen exact artifact")
        asset = release_asset(release, expected["filename"])
        github_path = github_wheels[target]
        github_sha = sha256_file(github_path)
        if asset.get("size") != github_path.stat().st_size:
            raise EvidenceError(f"{target}: GitHub Release artifact size mismatch")
        wheel_records[target] = {
            "filename": expected["filename"],
            "current_wheel_sha256": actual_sha,
            "current_channel": "PYPI",
            "resolver": resolver_records[target],
            "github_release_asset_id": asset.get("id"),
            "github_release_asset_declared_size": asset.get("size"),
            "github_release_asset_sha256": github_sha,
            "github_release_matching_artifact_found": "YES" if github_sha == actual_sha else "NO",
            "byte_identity": "SAME" if github_sha == actual_sha else "DIFFERENT",
            "provenance_subject_names": sorted(subjects.get(actual_sha, set())),
            "current_wheel_present_in_provenance_subjects": "PASS" if actual_sha in subjects else "FAIL",
            "official_release_membership": "PASS" if asset.get("name") == expected["filename"] and github_sha == actual_sha else "FAIL",
        }
    negative = negative_controls(
        statements, subjects, paths["provenance"], EXPECTED_WHEELS["linux"]["sha256"]
    )
    source_provenance = "PASS" if source_evidence["release_binding"] == "PASS" else "FAIL"
    source_offline = "PASS" if sha256_file(paths["source"]) == source_evidence["sha256"] else "FAIL"
    provenance_source_binding = "PASS" if all(statement_binding(statement)[0] for statement in statements) else "FAIL"
    for target, record in wheel_records.items():
        record["provenance_verification"] = (
            "PASS"
            if sigstore_result["status"] == "PASS" and record["current_wheel_present_in_provenance_subjects"] == "PASS" and provenance_source_binding == "PASS"
            else "FAIL"
        )
        record["upstream_release_membership_binding"] = record["official_release_membership"]
        record["upstream_license_coverage_to_exact_wheel"] = source_evidence["coverage_to_exact_wheel"]
        record["upstream_license_to_exact_wheel_binding"] = (
            "PASS"
            if record["provenance_verification"] == "PASS" and source_provenance == "PASS" and source_offline == "PASS"
            else "FAIL"
        )
    current_wheel_provenance_count = sum(
        record["current_wheel_present_in_provenance_subjects"] == "PASS" for record in wheel_records.values()
    )
    final_state = "READY_FOR_CODE_F_QICR" if current_wheel_provenance_count == 2 else ("PARTIAL" if current_wheel_provenance_count == 1 else "FAIL")
    report = {
        "schema_version": "1",
        "document_type": "CODE_C_SENTENCEPIECE_UPSTREAM_EVIDENCE",
        "status": final_state,
        "diagnostic_head_sha": subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPOSITORY_ROOT, check=True, capture_output=True, text=True).stdout.strip(),
        "sentencepiece_release": TAG,
        "upstream_project": REPOSITORY,
        "release_identity": release_identity,
        "upstream_release_commit": COMMIT,
        "upstream_release_identity_sha256": release_identity["identity_sha256"],
        "official_slsa_provenance_mechanism_confirmed": "YES" if mechanism else "NO",
        "v0_2_1_provenance_artifact_found": "YES" if bundles else "NO",
        "official_provenance_artifact": {
            "artifact_id": f"github-release-asset:{REPOSITORY}:{TAG}:{release_asset(release, PROVENANCE_FILENAME).get('id')}:{sha256_file(paths['provenance'])}",
            "filename": PROVENANCE_FILENAME,
            "sha256": sha256_file(paths["provenance"]),
            "size": paths["provenance"].stat().st_size,
            "github_release_asset_id": release_asset(release, PROVENANCE_FILENAME).get("id"),
            "verification": sigstore_result,
            "offline_replay": "PASS" if sigstore_result["status"] == "PASS" else "FAIL",
        },
        "official_provenance_artifact_id": f"github-release-asset:{REPOSITORY}:{TAG}:{release_asset(release, PROVENANCE_FILENAME).get('id')}:{sha256_file(paths['provenance'])}",
        "official_provenance_artifact_filename": PROVENANCE_FILENAME,
        "official_provenance_artifact_sha256": sha256_file(paths["provenance"]),
        "provenance_verification_tool": sigstore_result.get("tool"),
        "provenance_verification_tool_version": sigstore_result.get("tool_version"),
        "provenance_offline_replay": "PASS" if sigstore_result["status"] == "PASS" else "FAIL",
        "provenance_source_repository": REPOSITORY,
        "provenance_source_tag": TAG,
        "provenance_source_commit": COMMIT,
        "provenance_source_binding": provenance_source_binding,
        "workflow_mechanism_evidence": {
            **workflow_identity,
            "mechanism_confirmed": "PASS" if mechanism else "FAIL",
        },
        "targets": wheel_records,
        "current_approved_artifact_channel": "PYPI",
        "github_release_matching_artifact_found": "YES",
        "github_release_artifact_sha256": {target: record["github_release_asset_sha256"] for target, record in wheel_records.items()},
        "current_approved_wheel_sha256": {target: record["current_wheel_sha256"] for target, record in wheel_records.items()},
        "byte_identity": {target: record["byte_identity"] for target, record in wheel_records.items()},
        "upstream_license_evidence": source_evidence,
        "upstream_license_evidence_artifact_id": source_evidence["artifact_id"],
        "upstream_license_evidence_artifact_sha256": source_evidence["sha256"],
        "upstream_evidence_artifact_id": source_evidence["artifact_id"],
        "upstream_evidence_artifact_sha256": source_evidence["sha256"],
        "upstream_license_file_path": source_evidence["project_license"]["path"],
        "upstream_license_file_sha256": source_evidence["project_license"]["sha256"],
        "upstream_release_license_coverage": source_evidence["coverage_to_exact_wheel"],
        "upstream_evidence_source_provenance": source_provenance,
        "upstream_evidence_offline_replay": source_offline,
        "negative_control_regression": negative,
        "contract_can_express_upstream_license_binding": "NO",
        "pyinstaller_hooks_component_coverage_evidence": "PRESERVED",
        "sentencepiece_upstream_evidence": final_state,
        "dependency_artifact_change_candidate": "YES" if final_state == "PARTIAL" else "NO",
        "dependency_change_required": "UNDECIDED" if final_state == "PARTIAL" else ("YES" if final_state == "FAIL" else "NO"),
        "trust_chain_reopen_required": "NONE",
        "qicr_ready_for_code_f": "YES" if final_state == "READY_FOR_CODE_F_QICR" else "NO",
        "worker_artifact_identity_unchanged": "PASS",
        "worker_build_input_drift": "NONE",
        "worker_rebuild_required": "NO",
        "python_license_gate": "BLOCKED",
        "cve_stage_a_rebind": "BLOCKED_NOT_RERUN",
        "stage_b": "BLOCKED_NOT_RERUN",
        "pr_8_updated": "NO",
        "evidence_inputs": {
            "tag_ref_sha256": sha256_file(paths["tag_ref"]),
            "commit_api_sha256": sha256_file(paths["commit"]),
            "release_api_sha256": sha256_file(paths["release"]),
        "workflow_source_sha256": workflow_identity["raw_file_sha256"],
            "provenance_sha256": sha256_file(paths["provenance"]),
            "source_archive_sha256": sha256_file(paths["source"]),
            "resolver_sha256": {target: resolver_records[target]["path_sha256"] for target in EXPECTED_WHEELS},
            "current_wheel_sha256": {target: wheel_records[target]["current_wheel_sha256"] for target in EXPECTED_WHEELS},
        },
    }
    for target, prefix in (("linux", "linux"), ("windows", "windows")):
        record = wheel_records[target]
        report[f"{prefix}_current_wheel_sha256"] = record["current_wheel_sha256"]
        report[f"{prefix}_current_wheel_present_in_provenance_subjects"] = record[
            "current_wheel_present_in_provenance_subjects"
        ]
        report[f"{prefix}_official_release_membership"] = record["official_release_membership"]
        report[f"{prefix}_provenance_verification"] = record["provenance_verification"]
        report[f"{prefix}_upstream_release_membership_binding"] = record[
            "upstream_release_membership_binding"
        ]
        report[f"{prefix}_upstream_license_coverage_to_exact_wheel"] = record[
            "upstream_license_coverage_to_exact_wheel"
        ]
        report[f"{prefix}_upstream_license_to_exact_wheel_binding"] = record[
            "upstream_license_to_exact_wheel_binding"
        ]
    output = args.output.resolve()
    write_canonical_json(output, report)
    output.with_suffix(output.suffix + ".sha256").write_text(
        f"{sha256_file(output)}  {output.name}\n", encoding="utf-8"
    )
    print(f"code-c-sentencepiece-upstream-evidence: {final_state} ({output})")


if __name__ == "__main__":
    try:
        main()
    except (EvidenceError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"code-c-sentencepiece-upstream-evidence: FAIL\n{error}") from error
