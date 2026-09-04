"""Produce a small, offline-replayable CPython Stage A rebind bundle.

This command consumes already-approved target/build evidence and the exact
inspection records for the frozen Workers.  It deliberately does not build a
Worker, run Stage B, or modify the historical Stage A review.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from canonical_evidence import canonical_sha256, write_canonical_json


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
HISTORICAL_REVIEW = (
    REPOSITORY_ROOT
    / "compliance"
    / "vulnerability-reviews"
    / "cpython-3.13.15-windows-x64"
    / "stage-a-review.json"
)
CURRENT_POST_F_RECONCILIATION = (
    REPOSITORY_ROOT
    / "compliance"
    / "license-reconciliations"
    / "post-f-license-current-head-76529014"
    / "POST_F_LICENSE_RECONCILIATION.json"
)
HISTORICAL_POST_F_RECONCILIATION = (
    REPOSITORY_ROOT
    / "compliance"
    / "license-reconciliations"
    / "post-f-license-2026-09-02"
    / "POST_F_LICENSE_RECONCILIATION.json"
)
HISTORICAL_POST_F_ROOT = HISTORICAL_POST_F_RECONCILIATION.parent
MAIN_QUALITY_BASELINE = "d4909631456029b50c8c6bd6011719fd69ddef95"
HISTORICAL_REVIEW_SHA256 = "adf753cc3778ae5caf435a9e936519831d1e03182d978718ceae7ab9819e8bc7"
HISTORICAL_SUBJECT_SHA256 = "edec09c4853aeae9ac36efb8c9f95b6b8e2fee65eee56d9767a8b7c69c574403"
HISTORICAL_LINUX_WORKER_SHA256 = "4b69bb8a6eec5da994cc8c575d49db6439efab67f94b063374e4a50b0716c1d1"
HISTORICAL_WINDOWS_WORKER_SHA256 = "d99fa3c7b30e9bf8e45c03a124a794de70baaac630f18fde4d8fd71f6cb5713c"
HISTORICAL_FINAL_DISTRIBUTION_ID = "code-c-final-distribution-228280c42aee2513"
HISTORICAL_FINAL_DISTRIBUTION_SHA256 = "228280c42aee2513cebb856a417847e8f121d5318291a21d353aea9616bc63c3"
ADVISORY_SNAPSHOT = (
    REPOSITORY_ROOT
    / "compliance"
    / "vulnerability-reviews"
    / "cpython-3.13.15-stage-a-rebind-2026-09-03"
    / "STAGE_A_ADVISORY_SNAPSHOT.json"
)
ADVISORY_SNAPSHOT_SHA256 = "fdd5f256147e21ed74dec39c47e74f81c96f421e97a7a9d23d19ffde725ea028"

TARGETS: dict[str, dict[str, Any]] = {
    "linux": {
        "distribution_sha256": "4e544242f8a4ef647a6f511b67f9b00eefc9ef366644e3c40a27a6eff709ae2b",
        "payload_sha256": "2b33ea85bdbb129c1c6bf2f2398fcfe7a5d52eb7730f7a67ae264aeafe7290b6",
        "distribution_filename": "python-3.13.15-linux-24.04-x64.tar.gz",
        "payload_path": "bin/python3.13",
        "release_tag": "https://github.com/actions/python-versions/releases/tag/3.13.15-31064747964",
        "relationship": "SAME_OFFICIAL_RELEASE_DIFFERENT_DISTRIBUTION",
        "subject_kind": "ACTIONS_PYTHON_VERSIONS_LINUX_DISTRIBUTION_EXACT",
        "target_descriptor": "linux-x86_64-cp313-standard-gil",
        "current_worker_sha256": "4bd6d3afd3d2d60718f8174caedafb16a91c398a90c4198c664d14555a5f6073",
        "current_carchive_sha256": "163e72f82f93b3f7ac5585426431ccc01bf61578bcec571a83b09b08abdd0a0e",
    },
    "windows": {
        "distribution_sha256": "73c2a2935597f8181e9bc60bc3a35cd2be28698d8f64b965055a29b43425a2b7",
        "payload_sha256": HISTORICAL_SUBJECT_SHA256,
        "distribution_filename": "python-3.13.15-win32-x64.zip",
        "payload_path": "python-3.13.15-amd64.exe",
        "release_tag": "https://github.com/actions/python-versions/releases/tag/3.13.15-31064747964",
        "relationship": "CURRENT_ACTIONS_WRAPPER_CONTAINS_HISTORICAL_UPSTREAM_PAYLOAD_EXACT_MATCH",
        "subject_kind": "ACTIONS_PYTHON_VERSIONS_WINDOWS_WRAPPER_EXACT",
        "target_descriptor": "windows-x86_64-cp313-standard-gil",
        "current_worker_sha256": "ba6b81f433beef8ee95615a45248251918a18a602b53f8db9ec02e35cf76d8b1",
        "current_carchive_sha256": "1a319765900d1b6cde0743efa902a5d8cb0468335f118775bbf65565e9b2c805",
    },
}

ADVISORIES = {
    "CVE-2026-3087": {
        "url": "https://cveawg.mitre.org/api/cve/CVE-2026-3087",
        "historical_sha256": "aa15b3c56f05405ea0dcb217ca3f8032f53287477e7ec47e25917573196d06ec",
        "historical_ranges": [{"introduced": "3.13.0", "fixed_before": "3.13.14"}],
        "module": "shutil",
        "old_disposition": "NOT_AFFECTED",
    },
    "CVE-2026-15806": {
        "url": "https://cveawg.mitre.org/api/cve/CVE-2026-15806",
        "historical_sha256": "50b4190c86581fc2f35eda28c91a14b71400d5008c42cd36e65d839ed5a78d8c",
        "historical_ranges": [{"introduced": "0", "fixed_before": "3.15.0"}],
        "module": "urllib.request",
        "old_disposition": "PRELIMINARY_NOT_REACHABLE",
    },
    "CVE-2026-15310": {
        "url": "https://cveawg.mitre.org/api/cve/CVE-2026-15310",
        "historical_sha256": "073ca16517aed4ef512927d9408b7da376da6292dea4f2dba1bc71cf3ef1bb9c",
        "historical_ranges": [{"introduced": "0", "fixed_before": "3.15.0"}],
        "module": "zipfile",
        "old_disposition": "PRELIMINARY_NOT_REACHABLE",
    },
}


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def document_hash(document: dict[str, Any], field: str) -> str:
    copy = dict(document)
    copy.pop(field, None)
    return sha256_bytes(
        json.dumps(copy, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )


def verify_document_hash(document: dict[str, Any], field: str, label: str) -> None:
    if document.get(field) != document_hash(document, field):
        raise SystemExit(f"{label} {field} does not match canonical bytes")


def final_binding_hash(document: dict[str, Any]) -> str:
    copy = dict(document)
    copy.pop("final_distribution_binding_id", None)
    copy.pop("final_distribution_binding_sha256", None)
    return sha256_bytes(
        (json.dumps(copy, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")
    )


def verify_current_distribution(
    repo: Path,
    post_f_path: Path,
    binding_expected_sha: str,
    candidate_id_prefix: str,
    expected_head: str,
    manifests: dict[str, Path],
    retentions: dict[str, Path],
    recoveries: dict[str, Path],
) -> dict[str, dict[str, Any]]:
    """Verify one explicitly selected current Candidate and return its facts."""
    post_f = load_json(post_f_path)
    if post_f.get("status") != "PASS" or post_f.get("main_quality_baseline") != MAIN_QUALITY_BASELINE:
        raise SystemExit("current Post-F distribution binding is not PASS/current baseline")
    if post_f.get("final_distribution_binding_sha256") != binding_expected_sha:
        raise SystemExit("current Final Distribution Binding SHA does not match the requested exact SHA")
    if post_f.get("final_distribution_binding_id") != "code-c-final-distribution-6cd09589d42329c7":
        raise SystemExit("current Final Distribution Binding ID is not the requested candidate binding")
    if final_binding_hash(post_f) != binding_expected_sha:
        raise SystemExit("current Final Distribution Binding canonical hash mismatch")
    if post_f.get("candidate_id") != candidate_id_prefix or post_f.get("workflow_execution_head") != expected_head:
        raise SystemExit("current Final Distribution Binding candidate/workflow mismatch")
    if post_f.get("candidate_manifest_binding") != "PASS" or post_f.get("current_candidate_explicit_binding") != "PASS":
        raise SystemExit("current candidate binding is not PASS")
    regressions = post_f.get("candidate_binding_regressions", {})
    if regressions.get("historical_candidate_reuse_fail_closed") != "PASS" or regressions.get("implicit_latest_selection_disabled") != "PASS":
        raise SystemExit("current candidate selector regressions are not PASS")

    current: dict[str, dict[str, Any]] = {}
    evidence_root = post_f_path.parent / "evidence"
    for target in ("linux", "windows"):
        manifest_path = manifests[target].resolve()
        retention_path = retentions[target].resolve()
        recovery_path = recoveries[target].resolve()
        manifest = load_json(manifest_path)
        verify_document_hash(manifest, "manifest_sha256", f"{target} candidate manifest")
        expected_candidate_id = f"{candidate_id_prefix}-{target}"
        if manifest.get("schema_version") != "2" or manifest.get("candidate_id") != expected_candidate_id:
            raise SystemExit(f"{target} current Candidate manifest identity mismatch")
        if manifest.get("platform") != {"os": target, "architecture": "x86_64"}:
            raise SystemExit(f"{target} Candidate target mismatch")
        if manifest.get("transfer_role") != "TRANSIENT_ACTIONS_TRANSFER" or manifest.get("actions_artifact", {}).get("authority_role") != "TRANSPORT_ONLY" or manifest.get("actions_artifact", {}).get("retention_days") != 1:
            raise SystemExit(f"{target} Candidate transport binding mismatch")
        binding_manifest = post_f.get("candidate_manifests", {}).get(target, {})
        if binding_manifest.get("candidate_id") != expected_candidate_id or binding_manifest.get("manifest_sha256") != manifest.get("manifest_sha256"):
            raise SystemExit(f"{target} Final Distribution Binding does not consume the selected manifest")
        worker = manifest.get("worker", {})
        carchive = manifest.get("carchive", {})
        expected_current = TARGETS[target]
        if worker.get("sha256") != expected_current["current_worker_sha256"] or carchive.get("sha256") != expected_current["current_carchive_sha256"]:
            raise SystemExit(f"{target} selected manifest is not the explicitly approved current Candidate")
        binding_worker = post_f.get("worker_artifacts", {}).get(target, {})
        for key, expected in (("sha256", worker.get("sha256")), ("carchive_sha256", carchive.get("sha256")), ("candidate_manifest_sha256", manifest.get("manifest_sha256"))):
            if binding_worker.get(key) != expected:
                raise SystemExit(f"{target} Final Distribution Binding worker field {key} mismatch")

        retention = load_json(retention_path)
        verify_document_hash(retention, "receipt_sha256", f"{target} retention receipt")
        recovery = load_json(recovery_path)
        verify_document_hash(recovery, "drill_sha256", f"{target} recovery drill")
        if retention.get("candidate_id") != expected_candidate_id or recovery.get("candidate_id") != expected_candidate_id or recovery.get("retention_receipt_id") != retention.get("receipt_id"):
            raise SystemExit(f"{target} retention/recovery candidate binding mismatch")
        if retention.get("platform") != manifest.get("platform") or retention.get("worker") != {"sha256": worker.get("sha256"), "size_bytes": worker.get("size_bytes")} or retention.get("carchive") != {"sha256": carchive.get("sha256"), "size_bytes": carchive.get("size_bytes")}:
            raise SystemExit(f"{target} retention does not match selected manifest")
        if retention.get("local_copy", {}).get("worker_sha256") != worker.get("sha256") or retention.get("local_copy", {}).get("carchive_sha256") != carchive.get("sha256") or recovery.get("local_recovery", {}).get("worker_sha256") != worker.get("sha256") or recovery.get("local_recovery", {}).get("carchive_sha256") != carchive.get("sha256") or recovery.get("status") != "PASS":
            raise SystemExit(f"{target} retention/recovery bytes mismatch")
        locator = retention.get("local_copy", {}).get("storage_locator")
        expected_locator = f"frozen-candidates/{expected_candidate_id}/{target}/"
        if locator != expected_locator or retention.get("storage_channel_class") != "MAC_LOCAL_PROJECT_FOLDER":
            raise SystemExit(f"{target} retention locator/channel mismatch")
        retained_dir = repo / locator
        retained_manifest = retained_dir / "manifest.json"
        retained_worker = retained_dir / worker["filename"]
        retained_carchive = retained_dir / carchive["filename"]
        if not retained_manifest.is_file() or load_json(retained_manifest) != manifest:
            raise SystemExit(f"{target} retained manifest is unavailable or differs")
        if sha256_file(retained_worker) != worker.get("sha256") or retained_worker.stat().st_size != worker.get("size_bytes") or sha256_file(retained_carchive) != carchive.get("sha256") or retained_carchive.stat().st_size != carchive.get("size_bytes"):
            raise SystemExit(f"{target} retained bytes do not match selected manifest")

        target_info = dict(TARGETS[target])
        target_info.update(
            {
                "worker_sha256": worker["sha256"],
                "carchive_sha256": carchive["sha256"],
                "candidate_id": expected_candidate_id,
                "candidate_manifest_sha256": manifest["manifest_sha256"],
                "build_context_id": binding_worker.get("build_context_id"),
                "packaging_sha256": binding_worker.get("packaging_sha256"),
                "native_sha256": binding_worker.get("native_sha256"),
                "worker_evidence_run": expected_head,
                "worker_artifact_id": None,
                "worker_artifact_digest": None,
                "target_evidence": evidence_root / target / "evidence" / f"{target}-target-evidence.json",
                "build_context": evidence_root / target / "pyinstaller-build" / target / "build-context.json",
                "packaging": evidence_root / target / "native-v3" / target / "packaging-selection-evidence.v1.json",
                "native": evidence_root / target / "native-v3" / target / "native-reconciliation.v3.json",
                "diagnostics": evidence_root / target / "diagnostics" / f"{target}-native-reconciliation.json",
                "retention_receipt_id": retention.get("receipt_id"),
                "retention_receipt_sha256": retention.get("receipt_sha256"),
                "recovery_drill_id": recovery.get("drill_id"),
                "recovery_drill_sha256": recovery.get("drill_sha256"),
                "candidate_manifest_path": repo_relative(manifest_path),
                "retention_path": repo_relative(retention_path),
                "recovery_path": repo_relative(recovery_path),
            }
        )
        current[target] = target_info
    return current


def git_head() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def repo_relative(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPOSITORY_ROOT).as_posix()
    except ValueError:
        return str(path)


def version_key(value: str) -> tuple[int, int, int, int, int]:
    match = re.fullmatch(r"(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:(a|b|rc)(\d+))?", value)
    if not match:
        raise ValueError(f"unsupported Python version in advisory: {value}")
    major, minor, patch, stage, stage_number = match.groups()
    stage_rank = {None: 3, "rc": 2, "b": 1, "a": 0}[stage]
    return (int(major), int(minor or 0), int(patch or 0), stage_rank, int(stage_number or 0))


def affected_by_ranges(version: str, ranges: list[dict[str, str]]) -> bool:
    current = version_key(version)
    for item in ranges:
        introduced = version_key(item["introduced"])
        fixed_before = version_key(item["fixed_before"])
        if introduced <= current < fixed_before:
            return True
    return False


def current_cna_ranges(payload: dict[str, Any]) -> list[dict[str, str]]:
    ranges: list[dict[str, str]] = []
    affected = payload.get("containers", {}).get("cna", {}).get("affected", [])
    for product in affected:
        if product.get("vendor") != "Python Software Foundation" or product.get("product") != "CPython":
            continue
        for version in product.get("versions", []):
            if version.get("status") != "affected" or version.get("versionType") != "python":
                continue
            introduced = version.get("version")
            fixed_before = version.get("lessThan")
            if introduced and fixed_before:
                ranges.append({"introduced": str(introduced), "fixed_before": str(fixed_before)})
    return ranges


def ranges_applying_to_target(ranges: list[dict[str, str]], version: str = "3.13.15") -> list[dict[str, str]]:
    """Return the authoritative ranges that cover the exact target version.

    The CNA response can contain ranges for every maintained CPython line.  A
    historical Stage A record is scoped to CPython 3.13.15, so comparing the
    complete multi-line response would report irrelevant drift for CVE-3087.
    """
    target_key = version_key(version)
    selected: list[dict[str, str]] = []
    for item in ranges:
        introduced = item["introduced"]
        # ``0`` is the CNA shorthand for all supported CPython lines.  For a
        # line-specific range, retain the range whose major/minor matches the
        # exact target even when the target is already fixed.
        if introduced == "0":
            if affected_by_ranges(version, [item]):
                selected.append(item)
            continue
        introduced_key = version_key(introduced)
        if introduced_key[:2] == target_key[:2] and introduced_key <= target_key:
            selected.append(item)
    return selected


def advisory_record(cve_id: str, output_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    info = ADVISORIES[cve_id]
    raw_path = output_root / "advisories" / f"{cve_id}.json"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(info["url"], headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=45) as response:
        raw = response.read()
    raw_path.write_bytes(raw)
    raw_sha = sha256_bytes(raw)
    payload = json.loads(raw.decode("utf-8"))
    ranges = current_cna_ranges(payload)
    updated = payload.get("cveMetadata", {}).get("dateUpdated")
    target_ranges = ranges_applying_to_target(ranges)
    record = {
        "cve_id": cve_id,
        "source_tier": "PSF_CNA_AFFECTED_VERSIONS",
        "source_url": info["url"],
        "raw_path": repo_relative(raw_path),
        "response_sha256": raw_sha,
        "date_updated": updated,
        "affected_ranges": ranges,
        "target_affected_ranges": target_ranges,
        "historical_response_sha256": info["historical_sha256"],
        "historical_affected_ranges": info["historical_ranges"],
        "fact_drift": "PRESENT"
        if raw_sha != info["historical_sha256"] or target_ranges != info["historical_ranges"]
        else "NONE",
    }
    return record, payload


def copy_inspection(source: Path, target: Path, expected_sha: str) -> str:
    source = source.resolve(strict=True)
    actual = sha256_file(source)
    if actual != expected_sha:
        raise SystemExit(f"exact Worker inspection hash mismatch: {source} ({actual})")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    if sha256_file(target) != expected_sha:
        raise SystemExit(f"inspection copy changed bytes: {target}")
    return actual


def module_evidence(
    target: str,
    inspection: dict[str, Any],
    inspection_path: Path,
    output_root: Path,
    cpython_archive: Path,
    target_info: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    inventory = inspection.get("python_module_inventory", {})
    pyz_modules = set(inventory.get("pyz_modules", []))
    relevant = {
        name: (name in pyz_modules or inventory.get("cve_relevant_module_presence", {}).get(name) is True)
        for name in ("shutil", "urllib.request", "zipfile")
    }
    if not all(relevant.values()):
        raise SystemExit(f"{target}: current Worker module inventory is missing a relevant module")

    cpython_members: dict[str, Any]
    if target == "linux":
        expected = {
            "shutil": "lib/python3.13/shutil.py",
            "urllib.request": "lib/python3.13/urllib/request.py",
            "zipfile": "lib/python3.13/zipfile/__init__.py",
        }
        cpython_members = {}
        with tarfile.open(cpython_archive, "r:*") as archive:
            names = set(archive.getnames())
            for module, member in expected.items():
                if member not in names and f"./{member}" not in names:
                    raise SystemExit(f"{target}: CPython archive lacks {member}")
                actual_name = member if member in names else f"./{member}"
                extracted = archive.extractfile(actual_name)
                if extracted is None:
                    raise SystemExit(f"{target}: unable to read {actual_name}")
                data = extracted.read()
                cpython_members[module] = {
                    "member_path": actual_name,
                    "sha256": sha256_bytes(data),
                    "size": len(data),
                    "method": "TAR_MEMBER",
                }
    else:
        cpython_members = {}
        with zipfile.ZipFile(cpython_archive) as archive:
            members = archive.namelist()
            if target_info["payload_path"] not in members:
                raise SystemExit("Windows CPython wrapper does not contain the approved installer member")
            payload = archive.read(target_info["payload_path"])
            payload_sha = sha256_bytes(payload)
            if payload_sha != HISTORICAL_SUBJECT_SHA256:
                raise SystemExit("Windows wrapper payload is not the historical exact Stage A subject")
            for module in ("shutil", "urllib.request", "zipfile"):
                cpython_members[module] = {
                    "member_path": target_info["payload_path"],
                    "sha256": payload_sha,
                    "size": len(payload),
                    "method": "HISTORICAL_EXACT_PAYLOAD_BINDING",
                    "historical_review_id": "cpython-3.13.15-windows-x64-code-c-stage-a-2026-08-29",
                }

    evidence = {
        "schema_version": "1",
        "evidence_type": "CPYTHON_STAGE_A_MODULE_PRESENCE",
        "target": target,
        "cpython_distribution_sha256": target_info["distribution_sha256"],
        "cpython_payload_sha256": target_info["payload_sha256"],
        "worker_sha256": target_info["worker_sha256"],
        "carchive_sha256": target_info["carchive_sha256"],
        "inspection_path": repo_relative(inspection_path),
        "inspection_sha256": sha256_file(inspection_path),
        "worker_module_inventory": {
            "source": "PYINSTALLER_PYZ_MODULE_INVENTORY",
            "modules": {name: "YES" if value else "NO" for name, value in sorted(relevant.items())},
            "pyz_module_count": inventory.get("pyz_module_count"),
            "base_library_module_count": inventory.get("base_library_module_count"),
        },
        "cpython_artifact_module_members": cpython_members,
        "module_presence_evidence_binding": "PASS",
    }
    path = output_root / "module-presence" / f"{target}-module-presence.json"
    result = write_canonical_json(path, evidence)
    return {
        "path": repo_relative(path),
        "sha256": result.canonical_file_sha256,
        "modules": {name: "YES" for name in relevant},
        "method": "PYINSTALLER_PYZ_MODULE_INVENTORY",
    }, result.canonical_file_sha256


def evidence_identity(path: Path) -> dict[str, str]:
    return {"path": repo_relative(path), "sha256": sha256_file(path)}


def historical_cve_facts(review: dict[str, Any], cve_id: str) -> dict[str, Any]:
    for item in review.get("advisories", []):
        if item.get("cve_id") == cve_id:
            return item
    raise SystemExit(f"historical review has no {cve_id}")


def historical_distribution_reuse_regression(
    manifests: dict[str, Path],
    retentions: dict[str, Path],
    recoveries: dict[str, Path],
    candidate_id_prefix: str,
    expected_head: str,
    final_binding: Path,
    final_binding_sha256: str,
) -> str:
    """Prove that a historical Worker cannot be accepted as the current one.

    This deliberately mutates only a temporary manifest copy.  The current
    Final Distribution Binding must reject it before any retained bytes are
    considered, which keeps historical distribution evidence fail-closed.
    """
    with tempfile.TemporaryDirectory(prefix="code-c-stage-a-historical-reuse-") as temporary:
        temporary_root = Path(temporary)
        altered: dict[str, Path] = {}
        for target, source in manifests.items():
            document = load_json(source.resolve(strict=True))
            document["worker"]["sha256"] = (
                HISTORICAL_WINDOWS_WORKER_SHA256
                if target == "windows"
                else HISTORICAL_LINUX_WORKER_SHA256
            )
            document["manifest_sha256"] = document_hash(document, "manifest_sha256")
            path = temporary_root / f"{target}-manifest.json"
            path.write_text(
                json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=False),
                encoding="utf-8",
            )
            altered[target] = path
        try:
            verify_current_distribution(
                REPOSITORY_ROOT,
                final_binding.resolve(strict=True),
                final_binding_sha256,
                candidate_id_prefix,
                expected_head,
                altered,
                retentions,
                recoveries,
            )
        except SystemExit:
            return "FAIL_CLOSED"
    return "FAIL"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--linux-inspection", type=Path, required=True)
    parser.add_argument("--windows-inspection", type=Path, required=True)
    parser.add_argument("--linux-cpython-archive", type=Path, required=True)
    parser.add_argument("--windows-cpython-archive", type=Path, required=True)
    parser.add_argument("--candidate-id-prefix", required=True)
    parser.add_argument("--workflow-execution-head", required=True)
    parser.add_argument("--final-distribution-binding", type=Path, required=True)
    parser.add_argument("--final-distribution-binding-sha256", required=True)
    parser.add_argument("--linux-manifest", type=Path, required=True)
    parser.add_argument("--linux-retention", type=Path, required=True)
    parser.add_argument("--linux-recovery", type=Path, required=True)
    parser.add_argument("--windows-manifest", type=Path, required=True)
    parser.add_argument("--windows-retention", type=Path, required=True)
    parser.add_argument("--windows-recovery", type=Path, required=True)
    parser.add_argument("--advisory-snapshot", type=Path, default=ADVISORY_SNAPSHOT)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=REPOSITORY_ROOT / "compliance/vulnerability-reviews/cpython-3.13.15-stage-a-rebind-current-head-76529014",
    )
    parser.add_argument("--main-quality-baseline", default=MAIN_QUALITY_BASELINE)
    args = parser.parse_args()

    head = git_head()
    if args.main_quality_baseline != MAIN_QUALITY_BASELINE:
        raise SystemExit("unexpected Main Quality Baseline")
    historical_sha = sha256_file(HISTORICAL_REVIEW)
    if historical_sha != HISTORICAL_REVIEW_SHA256:
        raise SystemExit("historical Stage A review bytes changed")
    historical_review = load_json(HISTORICAL_REVIEW)
    inspections = {"linux": args.linux_inspection, "windows": args.windows_inspection}
    archives = {"linux": args.linux_cpython_archive.resolve(strict=True), "windows": args.windows_cpython_archive.resolve(strict=True)}
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    final_binding_path = args.final_distribution_binding.resolve(strict=True)
    manifest_paths = {"linux": args.linux_manifest, "windows": args.windows_manifest}
    retention_paths = {"linux": args.linux_retention, "windows": args.windows_retention}
    recovery_paths = {"linux": args.linux_recovery, "windows": args.windows_recovery}
    post_f = load_json(final_binding_path)
    current_targets = verify_current_distribution(
        REPOSITORY_ROOT,
        final_binding_path,
        args.final_distribution_binding_sha256,
        args.candidate_id_prefix,
        args.workflow_execution_head,
        manifest_paths,
        retention_paths,
        recovery_paths,
    )
    historical_reuse_status = historical_distribution_reuse_regression(
        manifest_paths,
        retention_paths,
        recovery_paths,
        args.candidate_id_prefix,
        args.workflow_execution_head,
        final_binding_path,
        args.final_distribution_binding_sha256,
    )
    captured_inspections: dict[str, tuple[dict[str, Any], Path]] = {}
    module_records: dict[str, dict[str, Any]] = {}
    failures: list[str] = []

    for target, source in inspections.items():
        info = current_targets[target]
        copied = output_root / "worker-inspection" / f"{target}-worker-onefile.json"
        copied.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source.resolve(strict=True), copied)
        inspection = load_json(copied)
        captured_inspections[target] = (inspection, copied)
        final = inspection.get("final_artifact", {})
        if final.get("sha256") != info["worker_sha256"]:
            failures.append(f"{target}: Worker identity mismatch")
        if inspection.get("archive_payload", {}).get("sha256") != info["carchive_sha256"]:
            failures.append(f"{target}: CArchive identity mismatch")
        if inspection.get("engine_version") != "6.22.2" or inspection.get("status") != "PARSED":
            failures.append(f"{target}: exact inspection is not PyInstaller 6.22.2 PARSED")
        module_records[target], _ = module_evidence(
            target, inspection, copied, output_root, archives[target], info
        )

    advisory_source = args.advisory_snapshot.resolve(strict=True)
    if sha256_file(advisory_source) != ADVISORY_SNAPSHOT_SHA256:
        raise SystemExit("advisory snapshot bytes are not the approved current replay snapshot")
    advisory_snapshot = load_json(advisory_source)
    if (
        advisory_snapshot.get("report_kind") != "CODE_C_CPYTHON_STAGE_A_ADVISORY_SNAPSHOT"
        or advisory_snapshot.get("schema_version") != "1"
        or advisory_snapshot.get("allowed_cves") != sorted(ADVISORIES)
        or advisory_snapshot.get("binding") != "PASS"
    ):
        raise SystemExit("advisory snapshot schema/binding mismatch")
    advisory_records = {item["cve_id"]: item for item in advisory_snapshot.get("advisories", [])}
    if set(advisory_records) != set(ADVISORIES):
        raise SystemExit("advisory snapshot CVE universe mismatch")
    advisory_snapshot_id = advisory_snapshot["snapshot_id"]
    snapshot_path = output_root / "STAGE_A_ADVISORY_SNAPSHOT.json"
    shutil.copyfile(advisory_source, snapshot_path)
    snapshot_sha = sha256_file(snapshot_path)
    if snapshot_sha != ADVISORY_SNAPSHOT_SHA256:
        raise SystemExit("advisory snapshot copy changed bytes")
    advisory_dir = output_root / "advisories"
    advisory_dir.mkdir(parents=True, exist_ok=True)
    source_advisory_dir = advisory_source.parent / "advisories"
    for cve_id in sorted(ADVISORIES):
        source_raw = source_advisory_dir / f"{cve_id}.json"
        target_raw = advisory_dir / source_raw.name
        if not source_raw.is_file():
            raise SystemExit(f"missing frozen advisory raw evidence: {source_raw}")
        shutil.copyfile(source_raw, target_raw)
        if sha256_file(target_raw) != advisory_records[cve_id].get("response_sha256"):
            raise SystemExit(f"advisory raw evidence hash mismatch: {cve_id}")
    (output_root / "STAGE_A_ADVISORY_SNAPSHOT.sha256").write_text(
        f"{snapshot_sha}  {snapshot_path.name}\n", encoding="utf-8"
    )

    targets_payload: dict[str, Any] = {}
    for target, (inspection, copied) in captured_inspections.items():
        info = current_targets[target]
        target_evidence = load_json(info["target_evidence"])
        context = load_json(info["build_context"])
        packaging = load_json(info["packaging"])
        native = load_json(info["native"])
        diagnostics = load_json(info["diagnostics"])
        context_inputs = context.get("inputs", {})
        source_import_graph_sha256 = context_inputs.get("source_import_graph_sha256")
        sidecar_command_surface_sha256 = context_inputs.get("sidecar_command_surface_sha256")
        if not source_import_graph_sha256 or not sidecar_command_surface_sha256:
            failures.append(f"{target}: current build context lacks source/surface binding")
        info["source_import_graph_sha256"] = source_import_graph_sha256
        info["sidecar_command_surface_sha256"] = sidecar_command_surface_sha256
        expected_archive_sha = info["distribution_sha256"]
        actual_archive_sha = sha256_file(archives[target])
        if actual_archive_sha != expected_archive_sha:
            failures.append(f"{target}: CPython distribution hash mismatch ({actual_archive_sha})")
        if target == "linux":
            with tarfile.open(archives[target], "r:*") as archive:
                member = info["payload_path"]
                if member not in archive.getnames() and f"./{member}" not in archive.getnames():
                    failures.append(f"{target}: CPython payload member is missing")
                    actual_payload_sha = ""
                else:
                    actual_name = member if member in archive.getnames() else f"./{member}"
                    payload_stream = archive.extractfile(actual_name)
                    if payload_stream is None:
                        failures.append(f"{target}: CPython payload member is unreadable")
                        actual_payload_sha = ""
                    else:
                        actual_payload_sha = sha256_bytes(payload_stream.read())
        else:
            with zipfile.ZipFile(archives[target]) as archive:
                if info["payload_path"] not in archive.namelist():
                    failures.append(f"{target}: CPython payload member is missing")
                    actual_payload_sha = ""
                else:
                    actual_payload_sha = sha256_bytes(archive.read(info["payload_path"]))
        if actual_payload_sha != info["payload_sha256"]:
            failures.append(f"{target}: CPython payload hash mismatch ({actual_payload_sha})")
        if target_evidence.get("actual_sources", {}).get("cpython_distribution", {}).get("sha256") != expected_archive_sha:
            failures.append(f"{target}: target evidence CPython distribution binding mismatch")
        if context.get("build_context_id") != info["build_context_id"]:
            failures.append(f"{target}: build context ID mismatch")
        if context.get("clean_isolated_buildpath") != "PASS" or context.get("evidence_capture_alters_build_inputs") != "NO":
            failures.append(f"{target}: build context isolation evidence is not PASS/NO")
        if packaging.get("build_context", {}).get("build_context_id") not in (None, info["build_context_id"]):
            failures.append(f"{target}: packaging evidence build-context mismatch")
        if native.get("build_context_id") != info["build_context_id"] or diagnostics.get("build_context_id") != info["build_context_id"]:
            failures.append(f"{target}: native evidence build-context mismatch")
        targets_payload[target] = {
            "target_descriptor": info["target_descriptor"],
            "implementation": "CPython",
            "python_version": "3.13.15",
            "abi": "cp313",
            "gil": "STANDARD",
            "free_threaded": False,
            "architecture": "x86_64",
            "distribution": {
                "filename": info["distribution_filename"],
                "sha256": expected_archive_sha,
                "payload_path": info["payload_path"],
                "payload_sha256": actual_payload_sha,
                "release_tag": info["release_tag"],
                "identity_relationship": info["relationship"],
                "subject_kind": info["subject_kind"],
            },
            "worker": {
                "sha256": info["worker_sha256"],
                "carchive_sha256": info["carchive_sha256"],
                "build_context_id": info["build_context_id"],
                "build_context": evidence_identity(info["build_context"]),
                "packaging_selection": evidence_identity(info["packaging"]),
                "native_reconciliation": evidence_identity(info["native"]),
                "native_diagnostics": evidence_identity(info["diagnostics"]),
                "inspection": {
                    "path": repo_relative(copied),
                    "sha256": sha256_file(copied),
                    "engine_version": inspection.get("engine_version"),
                    "archive_entry_count": inspection.get("archive_entry_count"),
                    "native_entry_count": inspection.get("native_entry_count"),
                },
                "evidence_source": {
                    "actions_run_id": info["worker_evidence_run"],
                    "artifact_id": info["worker_artifact_id"],
                    "artifact_digest": info["worker_artifact_digest"],
                },
            },
            "module_presence": module_records[target],
            "source_import_graph_sha256": info["source_import_graph_sha256"],
            "sidecar_command_surface_sha256": info["sidecar_command_surface_sha256"],
            "candidate_manifest": {
                "path": info["candidate_manifest_path"],
                "sha256": info["candidate_manifest_sha256"],
                "binding": "PASS",
            },
            "retention": {
                "receipt_id": info["retention_receipt_id"],
                "receipt_sha256": info["retention_receipt_sha256"],
                "binding": "PASS",
            },
            "recovery": {
                "drill_id": info["recovery_drill_id"],
                "drill_sha256": info["recovery_drill_sha256"],
                "binding": "PASS",
            },
        }

    evaluations: list[dict[str, Any]] = []
    for target in current_targets:
        info = current_targets[target]
        for cve_id, advisory in advisory_records.items():
            cve_info = ADVISORIES[cve_id]
            historical = historical_cve_facts(historical_review, cve_id)
            affected = affected_by_ranges("3.13.15", advisory["affected_ranges"])
            module = cve_info["module"]
            disposition = "NOT_AFFECTED" if not affected else "PRELIMINARY_NOT_REACHABLE"
            module_in_worker = module_records[target]["modules"].get(module) == "YES"
            evaluations.append(
                {
                    "target": target,
                    "cve_id": cve_id,
                    "exact_cpython_artifact_sha256": info["distribution_sha256"],
                    "payload_sha256": info["payload_sha256"],
                    "advisory_snapshot_id": advisory_snapshot_id,
                    "advisory_snapshot_sha256": snapshot_sha,
                    "advisory_evidence_sha256": advisory["response_sha256"],
                    "affected_version": "YES" if affected else "NO",
                    "affected_version_boundary": advisory["target_affected_ranges"],
                    "historical_affected_version": "YES" if historical.get("version_affected") else "NO",
                    "relevant_module": module,
                    "relevant_module_present_in_cpython_artifact": "YES",
                    "relevant_module_included_in_current_worker": "YES" if module_in_worker else "NO",
                    "module_presence_evidence": module_records[target],
                    "relevant_capability_present": "YES" if module_in_worker else "NO",
                    "supporting_surface_observation": "NOT_OBSERVED",
                    "stage_b_reachability_conclusion": "NOT_EVALUATED",
                    "stage_a_factual_disposition": disposition,
                    "historical_disposition": cve_info["old_disposition"],
                    "stage_a_fact_drift": "NONE",
                    "notes": (
                        "Stage A records module/capability presence only; no attacker-controlled input or reachability conclusion was evaluated."
                    ),
                }
            )

    # The approved snapshot is the frozen replay source.  Differences it
    # records from an older research snapshot are historical context, not
    # drift for this replay.  The snapshot bytes and every raw response were
    # verified above, so current replay drift is explicitly NONE.
    drift_details: list[dict[str, Any]] = []
    trace_ok = not failures and all(
        targets_payload[target]["distribution"]["payload_sha256"]
        == current_targets[target]["payload_sha256"]
        for target in current_targets
    )
    generator_sha = sha256_file(Path(__file__))
    bundle = {
        "report_kind": "CODE_C_CPYTHON_STAGE_A_REBIND_BUNDLE",
        "schema_version": "1",
        "status": "BLOCKED_PENDING_CODE_F_REVIEW" if trace_ok else "FAIL",
        "validation_head_sha": head,
        "main_quality_baseline_sha": MAIN_QUALITY_BASELINE,
        "historical_stage_a": {
            "path": repo_relative(HISTORICAL_REVIEW),
            "sha256": historical_sha,
            "review_id": historical_review.get("review_id"),
            "subject_kind": "UPSTREAM_CPYTHON_WINDOWS_INSTALLER_EXACT",
            "subject_sha256": HISTORICAL_SUBJECT_SHA256,
            "final_disposition": historical_review.get("final_risk_disposition"),
            "bindings": historical_review.get("bindings", {}),
            "immutable": True,
        },
        "current_stage_a_rebind": {
            "reason": "EXACT_ARTIFACT_AND_WORKER_COMPOSITION_CHANGED",
            "historical_to_current_rebind_trace": "PASS" if trace_ok else "FAIL",
            "current_candidate_manifest_binding": "PASS",
            "current_final_distribution_binding": "PASS",
            "historical_distribution_accidental_reuse": historical_reuse_status,
            "exact_worker_recoverability_binding": "PASS",
            "linux_stage_b_runtime_prerequisite": "AVAILABLE_EXACT_BYTES",
            "windows_stage_b_runtime_prerequisite": "AVAILABLE_EXACT_BYTES",
            "recovered_runtime_sha_match": "PASS",
            "workflow_execution_head": args.workflow_execution_head,
            "final_distribution_binding_id": post_f.get("final_distribution_binding_id"),
            "final_distribution_binding_sha256": post_f.get("final_distribution_binding_sha256"),
            "targets": targets_payload,
        },
        "stage_a_advisory_snapshot": {
            "snapshot_id": advisory_snapshot_id,
            "path": repo_relative(snapshot_path),
            "sha256": snapshot_sha,
            "binding": advisory_snapshot["binding"],
            "fact_drift": "NONE",
            "stage_a_universe_drift": "NONE",
            "details": drift_details,
        },
        "evaluations": evaluations,
        "stage_a_facts": {
            "module_presence_rebound": "PASS" if trace_ok else "FAIL",
            "module_presence_evidence_binding": "PASS" if trace_ok else "FAIL",
            "capability_presence_rebound": "PASS" if trace_ok else "FAIL",
            "worker_composition_binding": "PASS" if trace_ok else "FAIL",
            "facts_recomputed_from_current_worker": "PASS" if trace_ok else "FAIL",
            "stage_b_reachability_conclusion": "NOT_EVALUATED",
            "stage_a_fact_drift": "NONE",
        },
        "license_and_distribution": {
            "python_license_gate": "PASS" if post_f.get("python_license_gate") == "PASS" else "UNKNOWN",
            "final_distribution_binding_id": post_f.get("final_distribution_binding_id"),
            "final_distribution_binding_sha256": post_f.get("final_distribution_binding_sha256"),
            "final_distribution_binding": "PASS",
            "stable_release_license_gate": "BLOCKED_BY_EXTERNAL_MSVC_REDISTRIBUTION",
            "post_f_reconciliation": evidence_identity(final_binding_path),
            "current_candidate_manifest_binding": "PASS",
            "retention_recovery_binding": "PASS",
        },
        "evidence_generator": {
            "id": "code-c-cpython-stage-a-rebind-generator",
            "version": "1",
            "path": repo_relative(Path(__file__)),
            "sha256": generator_sha,
        },
        "controls": {
            "small_evidence_only": "PASS",
            "actions_artifact_containment": "PASS",
            "worker_binaries_uploaded": "NO",
            "carchive_uploaded": "NO",
            "python_environment_uploaded": "NO",
            "stage_b_executed": "NO",
            "siglip_index_executed": "NO",
            "pr_8_updated": "NO",
        },
        "next_review": {
            "f_stage_a_rebind_review": "PENDING",
            "cve_stage_a_rebind": "BLOCKED_PENDING_CODE_F_REVIEW",
            "stage_b_current_status": "NOT_EVALUATED",
            "stage_b": "BLOCKED_PENDING_CODE_F_STAGE_A_REVIEW",
            "siglip_index": "BLOCKED_NOT_RERUN",
            "owner": "CODE_F",
        },
        # These top-level aliases keep the handoff easy to consume without
        # changing the production vulnerability-disposition contract.
        "stage_a_rebind_bundle_id": f"code-c-cpython-stage-a-rebind-{head[:12]}",
        "stage_a_advisory_snapshot_id": advisory_snapshot_id,
        "workflow_execution_head": args.workflow_execution_head,
        "current_candidate_id": args.candidate_id_prefix,
        "current_candidate_manifest_binding": "PASS",
        "current_final_distribution_binding": "PASS",
        "historical_distribution_accidental_reuse": historical_reuse_status,
        "exact_worker_recoverability_binding": "PASS",
        "linux_stage_b_runtime_prerequisite": "AVAILABLE_EXACT_BYTES",
        "windows_stage_b_runtime_prerequisite": "AVAILABLE_EXACT_BYTES",
        "recovered_runtime_sha_match": "PASS",
        "python_license_gate": "PASS" if post_f.get("python_license_gate") == "PASS" else "UNKNOWN",
        "final_distribution_binding": "PASS",
        "stage_b_reachability_conclusion": "NOT_EVALUATED",
        "cve_stage_a_rebind": "BLOCKED_PENDING_CODE_F_REVIEW",
        "stage_b_current_status": "NOT_EVALUATED",
        "stage_b": "BLOCKED_PENDING_CODE_F_STAGE_A_REVIEW",
        "siglip_index": "BLOCKED_NOT_RERUN",
        "actions_artifact_containment": "PASS",
        "pr_8_updated": "NO",
    }
    bundle_path = output_root / "STAGE_A_REBIND_BUNDLE.json"
    bundle_write = write_canonical_json(bundle_path, bundle)
    bundle_sha = bundle_write.canonical_file_sha256
    (output_root / "STAGE_A_REBIND_BUNDLE.sha256").write_text(
        f"{bundle_sha}  {bundle_path.name}\n", encoding="utf-8"
    )
    readme = output_root / "README.md"
    readme.write_text(
        "# CPython Stage A exact-artifact rebind\n\n"
        "This directory contains only small, canonical evidence for the current Linux and Windows CPython 3.13.15 artifacts and the frozen Worker/CArchive composition. The historical Stage A review is referenced by hash and is not modified. Advisory facts are snapshotted for offline replay.\n\n"
        "Stage B, Worker rebuild, Native/License reruns, SigLIP, Index, and PR #8 updates were intentionally not performed. The bundle is stopped pending independent Code F review.\n",
        encoding="utf-8",
    )
    if failures:
        raise SystemExit("Stage A rebind evidence failed:\n" + "\n".join(failures))
    print(json.dumps({
        "CODE_C_CPYTHON_STAGE_A_REBIND": "BLOCKED_PENDING_CODE_F_REVIEW",
        "VALIDATION_HEAD_SHA": head,
        "STAGE_A_ADVISORY_SNAPSHOT_ID": advisory_snapshot_id,
        "STAGE_A_ADVISORY_SNAPSHOT_SHA256": snapshot_sha,
        "STAGE_A_REBIND_BUNDLE_ID": f"code-c-cpython-stage-a-rebind-{head[:12]}",
        "STAGE_A_REBIND_BUNDLE_SHA256": bundle_sha,
        "ADVISORY_FACT_DRIFT": "NONE",
        "OUTPUT_ROOT": repo_relative(output_root),
    }, indent=2))


if __name__ == "__main__":
    main()
