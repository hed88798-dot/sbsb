"""Capture evidence for the three current exact-artifact license hard blocks.

This tool is deliberately a diagnostic, not an approval generator.  It consumes the
already approved target evidence/resolver records and exact wheel bytes, then writes
one canonical report.  It never changes the Artifact License Evidence/Review schemas
or the shared license policy.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tarfile
import zipfile
from email.parser import Parser
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

from canonical_evidence import canonical_sha256, write_canonical_json


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
TARGETS = ("linux", "windows")
SENTENCEPIECE = "sentencepiece"
HOOKS = "pyinstaller-hooks-contrib"
HOOKS_LICENSE_RELATIVE_PATH = (
    "pyinstaller_hooks_contrib-2026.7.dist-info/licenses/LICENSE"
)
HOOKS_LICENSE_SHA256 = "91d0baaff00773038e72c0a1fc9d5d2d38706b7a2b9c04f34296608f931b9cd0"


class DiagnosticError(RuntimeError):
    """A fail-closed input/evidence error."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise DiagnosticError(f"cannot load JSON evidence {path}: {error}") from error
    if not isinstance(value, dict):
        raise DiagnosticError(f"JSON evidence is not an object: {path}")
    return value


def canonical_record_sha(value: Any) -> str:
    """Use the repository's canonical JSON identity for a sub-record."""

    return canonical_sha256(value)


def git_head() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def normalize_name(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def parse_binding(values: Iterable[str], label: str) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for raw in values:
        target, separator, path = raw.partition("=")
        if not separator or target not in TARGETS or not path:
            raise DiagnosticError(f"{label} must use target=path (got {raw!r})")
        if target in result:
            raise DiagnosticError(f"duplicate {label} for {target}")
        result[target] = Path(path).resolve(strict=True)
    if set(result) != set(TARGETS):
        raise DiagnosticError(f"{label} must contain exactly linux and windows")
    return result


def metadata_from_bytes(payload: bytes) -> dict[str, Any]:
    message = Parser().parsestr(payload.decode("utf-8", "replace"))
    classifiers = [value for value in message.get_all("Classifier", []) if "License ::" in value]
    return {
        "license_expression": message.get("License-Expression"),
        "legacy_license": message.get("License"),
        "classifiers": sorted(classifiers),
    }


def is_license_member(name: str) -> bool:
    lowered = name.lower()
    base = PurePosixPath(name).name.lower()
    return (
        base.startswith(("license", "licence", "copying", "notice"))
        or "/licenses/" in lowered
        or lowered.endswith("/licenses")
    )


def wheel_members(path: Path) -> tuple[list[str], dict[str, Any], dict[str, bytes], str]:
    try:
        with zipfile.ZipFile(path) as archive:
            names = sorted(archive.namelist())
            metadata_names = [name for name in names if name.endswith(".dist-info/METADATA")]
            if len(metadata_names) != 1:
                raise DiagnosticError(f"{path.name}: expected one dist-info/METADATA")
            metadata_name = metadata_names[0]
            metadata_bytes = archive.read(metadata_name)
            metadata = metadata_from_bytes(metadata_bytes)
            license_payloads = {
                name: archive.read(name)
                for name in names
                if name != metadata_name and is_license_member(name)
            }
            return names, metadata, license_payloads, sha256_bytes(metadata_bytes)
    except (OSError, zipfile.BadZipFile) as error:
        raise DiagnosticError(f"cannot inspect wheel {path}: {error}") from error


def source_license_payloads(path: Path) -> dict[str, bytes]:
    """Read source evidence if a trusted source archive was supplied."""

    try:
        if path.name.lower().endswith((".whl", ".zip")):
            with zipfile.ZipFile(path) as archive:
                return {
                    name: archive.read(name)
                    for name in sorted(archive.namelist())
                    if is_license_member(name)
                }
        with tarfile.open(path, "r:*") as archive:
            result: dict[str, bytes] = {}
            for member in sorted(archive.getmembers(), key=lambda item: item.name):
                if member.isfile() and is_license_member(member.name):
                    handle = archive.extractfile(member)
                    if handle is not None:
                        result[member.name] = handle.read()
            return result
    except (OSError, tarfile.TarError, zipfile.BadZipFile) as error:
        raise DiagnosticError(f"cannot inspect source archive {path}: {error}") from error


def exact_wheel_evidence(
    *,
    target: str,
    wheel_path: Path,
    expected_artifact: dict[str, Any],
    resolver: dict[str, Any],
    target_evidence: dict[str, Any],
    source_path: Path | None,
) -> dict[str, Any]:
    actual_sha = sha256_file(wheel_path)
    if actual_sha != expected_artifact["sha256"]:
        raise DiagnosticError(
            f"{target}: SentencePiece wheel hash mismatch "
            f"({actual_sha} != {expected_artifact['sha256']})"
        )
    if wheel_path.name != expected_artifact["filename"]:
        raise DiagnosticError(
            f"{target}: SentencePiece filename mismatch "
            f"({wheel_path.name} != {expected_artifact['filename']})"
        )
    names, metadata, local_files, metadata_sha256 = wheel_members(wheel_path)
    expected_raw = expected_artifact.get("raw_license", {})
    actual_license_files = [
        {"relative_path": name, "sha256": sha256_bytes(payload), "size": len(payload)}
        for name, payload in sorted(local_files.items())
    ]
    expected_license_files = sorted(
        [
            {
                "relative_path": item.get("relative_path"),
                "sha256": item.get("sha256"),
                "size": item.get("size"),
            }
            for item in expected_raw.get("license_files", [])
        ],
        key=lambda item: item["relative_path"] or "",
    )
    raw_evidence_matches = {
        "metadata_sha256": metadata_sha256 == expected_raw.get("metadata_sha256"),
        "reported_license_expression": metadata["license_expression"]
        == expected_raw.get("reported_license_expression"),
        "legacy_license_value": metadata["legacy_license"]
        == expected_raw.get("legacy_license_value"),
        "classifiers": metadata["classifiers"] == sorted(expected_raw.get("classifiers", [])),
        "license_files": actual_license_files == expected_license_files,
    }
    if not all(raw_evidence_matches.values()):
        raise DiagnosticError(
            f"{target}: exact wheel license evidence drift: {raw_evidence_matches}"
        )
    resolver_package = next(
        (
            package
            for package in resolver.get("packages", [])
            if normalize_name(str(package.get("name", ""))) == SENTENCEPIECE
            and package.get("version") == expected_artifact.get("version")
        ),
        None,
    )
    if resolver_package is None:
        raise DiagnosticError(f"{target}: resolver has no exact SentencePiece record")
    provenance = resolver_package.get("provenance", {})
    resolver_matches = {
        "package": normalize_name(str(resolver_package.get("name", ""))) == SENTENCEPIECE,
        "version": resolver_package.get("version") == expected_artifact.get("version"),
        "filename": provenance.get("filename") == expected_artifact.get("filename"),
        "sha256": provenance.get("sha256") == expected_artifact.get("sha256"),
        "size": provenance.get("size") == wheel_path.stat().st_size,
    }
    membership = "PASS" if all(resolver_matches.values()) else "FAIL"
    target_artifact = next(
        (
            artifact
            for artifact in target_evidence.get("artifacts", [])
            if artifact.get("sha256") == expected_artifact.get("sha256")
        ),
        None,
    )
    target_binding = bool(
        target_artifact
        and target_artifact.get("filename") == wheel_path.name
        and target_artifact.get("package") == SENTENCEPIECE
        and target_artifact.get("version") == expected_artifact.get("version")
    )
    local_evidence = "SUFFICIENT" if (
        metadata["license_expression"]
        or metadata["legacy_license"]
        or metadata["classifiers"]
        or local_files
    ) else "INSUFFICIENT"
    source_evidence: dict[str, Any] | None = None
    if source_path is not None:
        source_payloads = source_license_payloads(source_path)
        source_evidence = {
            "artifact_id": f"source-license-evidence:{sha256_file(source_path)}",
            "filename": source_path.name,
            "sha256": sha256_file(source_path),
            "license_files": [
                {"path": name, "sha256": sha256_bytes(payload), "size": len(payload)}
                for name, payload in sorted(source_payloads.items())
            ],
            "coverage_candidate": "REQUIRED_REVIEW" if source_payloads else "FAIL",
        }
    source_identity_matches = bool(
        source_path
        and normalize_name(SENTENCEPIECE) in normalize_name(source_path.name)
        and expected_artifact.get("version") in source_path.name
    )
    if source_evidence is not None:
        source_evidence["release_identity_binding"] = (
            "PASS" if source_identity_matches else "FAIL"
        )
    coverage = (
        "REQUIRED_REVIEW"
        if source_evidence
        and source_identity_matches
        and source_evidence["license_files"]
        else "FAIL"
    )
    coverage_reason = (
        "source license evidence is hash-bound but wheel coverage requires reviewer assertion"
        if coverage == "REQUIRED_REVIEW"
        else "no trusted hash-bound source/sdist license artifact is available"
    )
    resolver_path_sha = (
        sha256_file(Path(resolver["__path__"])) if resolver.get("__path__") else None
    )
    resolver_record = {
        "target": target,
        "inventory_id": next(
            (use.get("inventory_id") for use in (target_artifact or {}).get("uses", [])),
            None,
        ),
        "package": SENTENCEPIECE,
        "version": expected_artifact.get("version"),
        "filename": provenance.get("filename"),
        "sha256": provenance.get("sha256"),
        "source": provenance.get("source"),
        "source_index": provenance.get("source_index"),
    }
    release_id = f"pkg:pypi/{SENTENCEPIECE}@{expected_artifact['version']}"
    upstream_artifact = source_evidence
    return {
        "target": target,
        "exact_wheel": {
            "filename": wheel_path.name,
            "sha256": actual_sha,
            "size": wheel_path.stat().st_size,
            "artifact_license_evidence_snapshot_sha256": (target_artifact or {}).get(
                "evidence_snapshot_sha256"
            ),
        },
        "wheel_local_evidence": {
            "status": local_evidence,
            "metadata_license_expression": metadata["license_expression"],
            "metadata_legacy_license": metadata["legacy_license"],
            "metadata_sha256": metadata_sha256,
            "license_classifiers": metadata["classifiers"],
            "license_files": [
                {"path": name, "sha256": sha256_bytes(payload), "size": len(payload)}
                for name, payload in sorted(local_files.items())
            ],
            "archive_member_count": len(names),
            "raw_evidence_binding": "PASS",
        },
        "upstream_release": {
            "release_id": release_id,
            "version": expected_artifact.get("version"),
            "resolver_record_id": f"resolver:{target}:{release_id}",
            "resolver_record_sha256": canonical_record_sha(resolver_record),
            "resolver_evidence_sha256": resolver_path_sha,
            "resolver_record": resolver_record,
            "release_membership_binding": membership,
            "resolver_field_matches": resolver_matches,
            "target_evidence_binding": "PASS" if target_binding else "FAIL",
        },
        "upstream_license_evidence": {
            "status": "PASS" if upstream_artifact else "NOT_AVAILABLE",
            "artifact": upstream_artifact,
            "source_provenance": "PASS" if upstream_artifact else "FAIL",
            "offline_replay": "PASS" if upstream_artifact else "FAIL",
            "coverage_to_exact_wheel": coverage,
            "coverage_reason": coverage_reason,
        },
        "release_to_wheel_binding": {
            "status": "PASS" if membership == "PASS" and upstream_artifact else "FAIL",
            "wheel_sha256": actual_sha,
            "release_id": release_id,
            "upstream_evidence_artifact_id": (upstream_artifact or {}).get("artifact_id"),
            "license_evidence_path_sha256": [
                {"path": name, "sha256": sha256_bytes(payload)}
                for name, payload in sorted(
                    (source_license_payloads(source_path) if source_path else {}).items()
                )
            ],
        },
        "final_disposition": "HARD_BLOCK" if coverage == "FAIL" else "REQUIRED_REVIEW",
    }


def hooks_structure(
    *,
    wheel_path: Path,
    expected_artifact: dict[str, Any],
    target_evidence: dict[str, dict[str, Any]],
    inspections: dict[str, dict[str, Any]],
    build_evidence: dict[str, dict[str, Any]],
    build_logs: dict[str, Path],
) -> dict[str, Any]:
    actual_sha = sha256_file(wheel_path)
    if actual_sha != expected_artifact["sha256"]:
        raise DiagnosticError(
            f"hooks wheel hash mismatch ({actual_sha} != {expected_artifact['sha256']})"
        )
    names, metadata, license_payloads, metadata_sha256 = wheel_members(wheel_path)
    license_record = license_payloads.get(HOOKS_LICENSE_RELATIVE_PATH)
    if license_record is None:
        raise DiagnosticError("hooks wheel does not contain the expected license file")
    license_sha = sha256_bytes(license_record)
    if license_sha != HOOKS_LICENSE_SHA256:
        raise DiagnosticError(
            f"hooks license hash mismatch ({license_sha} != {HOOKS_LICENSE_SHA256})"
        )
    expected_raw = expected_artifact.get("raw_license", {})
    if (
        metadata["license_expression"] != expected_raw.get("reported_license_expression")
        or metadata["legacy_license"] != expected_raw.get("legacy_license_value")
        or metadata["classifiers"] != sorted(expected_raw.get("classifiers", []))
        or metadata_sha256 != expected_raw.get("metadata_sha256")
    ):
        raise DiagnosticError("hooks wheel metadata drifted from the frozen exact evidence")
    expected_file = next(
        (
            entry
            for entry in expected_raw.get("license_files", [])
            if entry.get("relative_path") == HOOKS_LICENSE_RELATIVE_PATH
        ),
        None,
    )
    if not expected_file or expected_file.get("sha256") != license_sha:
        raise DiagnosticError("hooks wheel license-file evidence drifted from the frozen snapshot")
    license_text = license_record.decode("utf-8", "replace")
    standard_paths = [
        name
        for name in names
        if name.startswith("_pyinstaller_hooks_contrib/")
        and not name.startswith("_pyinstaller_hooks_contrib/rthooks/")
    ]
    runtime_paths = [
        name for name in names if name.startswith("_pyinstaller_hooks_contrib/rthooks/")
    ]
    has_per_component_text = (
        "Standard hooks and files" in license_text
        and "except runtime hooks" in license_text
        and "_pyinstaller_hooks_contrib/rthooks" in license_text
        and "GPL-2.0-or-later" in license_text
        and "Apache-2.0" in license_text
    )
    if not has_per_component_text:
        relationship = "UNKNOWN"
    else:
        relationship = "PER_COMPONENT"
    components = [
        {
            "component_or_path_set": (
                "_pyinstaller_hooks_contrib/** excluding "
                "_pyinstaller_hooks_contrib/rthooks/**"
            ),
            "member_count": len(standard_paths),
            "license": "GPL-2.0-or-later",
            "evidence_path": HOOKS_LICENSE_RELATIVE_PATH,
            "evidence_sha256": license_sha,
            "coverage_basis": (
                "license text: standard hooks/files are all files except runtime hooks"
            ),
        },
        {
            "component_or_path_set": "_pyinstaller_hooks_contrib/rthooks/**",
            "member_count": len(runtime_paths),
            "license": "Apache-2.0",
            "evidence_path": HOOKS_LICENSE_RELATIVE_PATH,
            "evidence_sha256": license_sha,
            "coverage_basis": "license text names the runtime hook directory and Apache-2.0",
        },
    ]
    usage_records = []
    for evidence in target_evidence.values():
        for artifact in evidence.get("artifacts", []):
            if artifact.get("sha256") == expected_artifact.get("sha256"):
                usage_records.extend(artifact.get("uses", []))
    usage_ok = bool(usage_records) and all(
        record.get("artifact_role") == "PYTHON_BUILD_DEPENDENCY"
        and record.get("distribution_role") == "BUILD_ONLY_USE"
        for record in usage_records
    )
    build_log_records = []
    for target, path in sorted(build_logs.items()):
        payload = path.read_text(encoding="utf-8", errors="replace")
        used = "_pyinstaller_hooks_contrib/" in payload or "_pyinstaller_hooks_contrib\\" in payload
        build_log_records.append(
            {
                "target": target,
                "path": str(path),
                "sha256": sha256_file(path),
                "gpl_component_hook_path_observed": used,
            }
        )
    build_evidence_records = []
    for target, evidence in sorted(build_evidence.items()):
        worker_license = target_evidence[target].get("pyinstaller_worker_build_license", {})
        raw_log = evidence.get("raw_evidence", {}).get("BUILD_LOG", {})
        context_bound = (
            evidence.get("target") == target
            and evidence.get("pyinstaller_version") == "6.22.2"
            and evidence.get("selected_set_capture") == "COMPLETE"
            and evidence.get("build_context_id") == worker_license.get("build_context_id")
            and bool(raw_log.get("sha256"))
        )
        build_evidence_records.append(
            {
                "target": target,
                "build_context_id": evidence.get("build_context_id"),
                "build_log_sha256": raw_log.get("sha256"),
                "context_binding": "PASS" if context_bound else "FAIL",
            }
        )
    gpl_used = (
        "YES"
        if usage_ok
        and build_evidence_records
        and all(record["context_binding"] == "PASS" for record in build_evidence_records)
        and (
            not build_log_records
            or all(record["gpl_component_hook_path_observed"] for record in build_log_records)
        )
        else "UNKNOWN"
    )
    final_matches = []
    for target, inspection in sorted(inspections.items()):
        entries = inspection.get("archive_entries", [])
        matches = [
            entry.get("internal_path")
            for entry in entries
            if "_pyinstaller_hooks_contrib" in str(entry.get("internal_path", ""))
        ]
        final_matches.append({"target": target, "matching_internal_paths": sorted(matches)})
    distributed = (
        "NO"
        if final_matches and all(not item["matching_internal_paths"] for item in final_matches)
        else "UNKNOWN"
    )
    return {
        "artifact": {
            "filename": wheel_path.name,
            "sha256": actual_sha,
            "size": wheel_path.stat().st_size,
            "metadata": metadata,
            "metadata_sha256": metadata_sha256,
            "raw_evidence_binding": "PASS",
            "license_files": [
                {"path": name, "sha256": sha256_bytes(payload), "size": len(payload)}
                for name, payload in sorted(license_payloads.items())
            ],
        },
        "role": {
            "artifact_role": "PYTHON_BUILD_DEPENDENCY" if usage_ok else "UNKNOWN",
            "distribution_role": "BUILD_ONLY_USE" if usage_ok else "UNKNOWN",
            "usage_bindings": usage_records,
        },
        "license_relationship": relationship,
        "component_coverage": components,
        "gpl_component_used_in_current_build": gpl_used,
        "gpl_component_distributed_in_final_worker": distributed,
        "final_worker_archive_matches": final_matches,
        "build_logs": build_log_records,
        "build_evidence": build_evidence_records,
        "final_disposition": (
            "REQUIRED_REVIEW"
            if relationship == "PER_COMPONENT" and usage_ok and distributed == "NO"
            else "HARD_BLOCK"
        ),
    }


def find_hard_block(
    bundle: dict[str, Any], package: str, sha256: str | None = None
) -> dict[str, Any]:
    matches = [
        value
        for value in bundle.get("hard_blocked_artifacts", [])
        if normalize_name(str(value.get("package", ""))) == normalize_name(package)
        and (sha256 is None or value.get("sha256") == sha256)
    ]
    if len(matches) != 1:
        raise DiagnosticError(f"expected one hard-block record for {package}, found {len(matches)}")
    return matches[0]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--target-evidence", action="append", required=True)
    parser.add_argument("--resolver", action="append", required=True)
    parser.add_argument("--sentencepiece-wheel", action="append", required=True)
    parser.add_argument("--hooks-wheel", type=Path, required=True)
    parser.add_argument("--worker-inspection", action="append", required=True)
    parser.add_argument("--build-evidence", action="append", required=True)
    parser.add_argument("--build-log", action="append", default=[])
    parser.add_argument("--source-artifact", action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    bundle_path = arguments.bundle.resolve(strict=True)
    bundle = load_json(bundle_path)
    target_evidence_paths = parse_binding(arguments.target_evidence, "--target-evidence")
    resolver_paths = parse_binding(arguments.resolver, "--resolver")
    wheel_paths = parse_binding(arguments.sentencepiece_wheel, "--sentencepiece-wheel")
    inspection_paths = parse_binding(arguments.worker_inspection, "--worker-inspection")
    build_evidence_paths = parse_binding(arguments.build_evidence, "--build-evidence")
    build_log_paths = (
        parse_binding(arguments.build_log, "--build-log") if arguments.build_log else {}
    )
    source_paths = (
        parse_binding(arguments.source_artifact, "--source-artifact")
        if arguments.source_artifact
        else {}
    )
    target_evidence = {target: load_json(path) for target, path in target_evidence_paths.items()}
    resolvers = {target: load_json(path) for target, path in resolver_paths.items()}
    for target, path in resolver_paths.items():
        resolvers[target]["__path__"] = str(path)
    inspections = {target: load_json(path) for target, path in inspection_paths.items()}
    build_evidence = {target: load_json(path) for target, path in build_evidence_paths.items()}
    head = git_head()
    bundle_head = bundle.get("graph_binding", {}).get("code_c_head_sha")
    if bundle_head != head:
        raise DiagnosticError(f"bundle Code C HEAD is not current ({bundle_head} != {head})")
    worker_heads = {
        evidence.get("worker_artifact_head_sha") for evidence in target_evidence.values()
    }
    if len(worker_heads) != 1 or None in worker_heads:
        raise DiagnosticError("target evidence does not have one shared worker artifact head")
    worker_head = next(iter(worker_heads))
    if any(evidence.get("code_c_head_sha") != head for evidence in target_evidence.values()):
        raise DiagnosticError("target license evidence is not bound to the current Code C HEAD")
    worker_identity_unchanged = all(
        evidence.get("worker_artifact_identity_unchanged") == "PASS"
        and evidence.get("worker_build_input_drift") == "NONE"
        and evidence.get("worker_rebuild_required") == "NO"
        for evidence in target_evidence.values()
    )
    sentence_blocks = {
        target: find_hard_block(
            bundle,
            SENTENCEPIECE,
            next(
                artifact.get("sha256")
                for artifact in target_evidence[target].get("artifacts", [])
                if normalize_name(str(artifact.get("package", ""))) == SENTENCEPIECE
            ),
        )
        for target in TARGETS
    }
    hooks_block = find_hard_block(bundle, HOOKS)
    sentence_reports = {
        target: exact_wheel_evidence(
            target=target,
            wheel_path=wheel_paths[target],
            expected_artifact=sentence_blocks[target],
            resolver=resolvers[target],
            target_evidence=target_evidence[target],
            source_path=source_paths.get(target),
        )
        for target in TARGETS
    }
    hooks_report = hooks_structure(
        wheel_path=arguments.hooks_wheel.resolve(strict=True),
        expected_artifact=hooks_block,
        target_evidence=target_evidence,
        inspections=inspections,
        build_evidence=build_evidence,
        build_logs=build_log_paths,
    )
    contract_upstream = "NO"
    contract_component = "NO"
    qicr_required = "YES"
    qicr_reason = (
        "Artifact License Evidence v3/Review v1 have no structured exact-release license-coverage "
        "or component/path coverage binding; the hooks relationship therefore needs Code F/QICR "
        "contract review. SentencePiece still lacks a hash-bound upstream license artifact."
    )
    counts = bundle.get("count_domains", {})
    final_closure = "PASS" if all(
        report["final_disposition"] != "HARD_BLOCK" for report in sentence_reports.values()
    ) and hooks_report["final_disposition"] != "HARD_BLOCK" else "FAIL"
    report = {
        "schema_version": "1",
        "document_type": "CODE_C_LICENSE_HARD_BLOCK_CLOSURE",
        "status": "BLOCKED" if final_closure != "PASS" else "PASS",
        "validation_head_sha": head,
        "worker_artifact_identity_unchanged": "PASS" if worker_identity_unchanged else "FAIL",
        "worker_artifact_head_sha": worker_head,
        "worker_build_input_drift": "NONE" if worker_identity_unchanged else "PRESENT",
        "worker_rebuild_required": "NO" if worker_identity_unchanged else "YES",
        "sentencepiece": {
            "exact_artifact_count": len(sentence_reports),
            "targets": sentence_reports,
            "final_disposition": "HARD_BLOCK"
            if any(
                report["final_disposition"] == "HARD_BLOCK"
                for report in sentence_reports.values()
            )
            else "REQUIRED_REVIEW",
            "upstream_release_id": "pkg:pypi/sentencepiece@0.2.1",
            "contract_can_express_upstream_license_binding": contract_upstream,
        },
        "pyinstaller_hooks_contrib": {
            **hooks_report,
            "contract_can_express_component_license_coverage": contract_component,
        },
        "qicr": {
            "required": qicr_required,
            "reason": qicr_reason,
            "implemented_by_code_c": "NO",
        },
        "dependency_change_required": "NO",
        "trust_chain_reopen_required": "NONE",
        "counts": {
            "unique_license_artifact_count": counts.get("unique_license_artifact_count"),
            "license_usage_evaluation_count": counts.get("license_usage_evaluation_count"),
            "auto_policy_pass_usage_count": counts.get("auto_policy_pass_usage_count"),
            "new_required_review_usage_count": counts.get("new_required_review_usage_count"),
            "new_required_review_unique_artifact_count": counts.get(
                "new_required_review_unique_artifact_count"
            ),
            "hard_blocked_usage_count": counts.get("hard_blocked_usage_count"),
            "hard_blocked_unique_artifact_count": counts.get("hard_blocked_unique_artifact_count"),
            "license_disposition_partition": bundle.get("license_disposition_partition", {}).get(
                "status"
            ),
        },
        "final_license_subject_closure": final_closure,
        "license_review_bundle": {
            "status": "NOT_READY",
            "id": bundle.get("license_review_bundle_id"),
            "sha256": sha256_file(bundle_path),
            "source_path": str(bundle_path),
        },
        "python_license_gate": (
            "FAIL" if final_closure != "PASS" else "BLOCKED_PENDING_CODE_F_LICENSE_REVIEW"
        ),
        "owner_of_next_fix": "UPSTREAM_EVIDENCE_REQUIRED",
        "secondary_owner": "CODE_F_QICR",
        "cve_stage_a_rebind": "BLOCKED_NOT_RERUN",
        "stage_b": "BLOCKED_NOT_RERUN",
        "pr_8_updated": "NO",
        "evidence_inputs": {
            "bundle_sha256": sha256_file(bundle_path),
            "target_evidence_sha256": {
                target: sha256_file(path) for target, path in target_evidence_paths.items()
            },
            "resolver_evidence_sha256": {
                target: sha256_file(path) for target, path in resolver_paths.items()
            },
            "worker_inspection_sha256": {
                target: sha256_file(path) for target, path in inspection_paths.items()
            },
            "build_evidence_sha256": {
                target: sha256_file(path) for target, path in build_evidence_paths.items()
            },
            "build_log_sha256": {
                target: sha256_file(path) for target, path in build_log_paths.items()
            },
            "hooks_wheel_sha256": sha256_file(arguments.hooks_wheel.resolve(strict=True)),
        },
    }
    output = arguments.output.resolve()
    write_canonical_json(output, report)
    output.with_suffix(output.suffix + ".sha256").write_text(
        f"{sha256_file(output)}  {output.name}\n", encoding="utf-8"
    )
    print(f"code-c-license-hard-block-closure: {report['status']} ({output})")


if __name__ == "__main__":
    try:
        main()
    except (DiagnosticError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"code-c-license-hard-block-closure: FAIL\n{error}") from error
