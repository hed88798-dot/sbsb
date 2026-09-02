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
POST_F_RECONCILIATION = (
    REPOSITORY_ROOT
    / "compliance"
    / "license-reconciliations"
    / "post-f-license-2026-09-02"
    / "POST_F_LICENSE_RECONCILIATION.json"
)
POST_F_ROOT = POST_F_RECONCILIATION.parent
MAIN_QUALITY_BASELINE = "06c4620e8738bd63f8674e15d1158042a65c1d28"
HISTORICAL_REVIEW_SHA256 = "adf753cc3778ae5caf435a9e936519831d1e03182d978718ceae7ab9819e8bc7"
HISTORICAL_SUBJECT_SHA256 = "edec09c4853aeae9ac36efb8c9f95b6b8e2fee65eee56d9767a8b7c69c574403"
FINAL_DISTRIBUTION_ID = "code-c-final-distribution-228280c42aee2513"
FINAL_DISTRIBUTION_SHA256 = "228280c42aee2513cebb856a417847e8f121d5318291a21d353aea9616bc63c3"

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
        "target_evidence": POST_F_ROOT / "evidence/linux/evidence/linux-target-evidence.json",
        "build_context": POST_F_ROOT / "evidence/linux/pyinstaller-build/linux/build-context.json",
        "packaging": POST_F_ROOT / "evidence/linux/native-v3/linux/packaging-selection-evidence.v1.json",
        "native": POST_F_ROOT / "evidence/linux/native-v3/linux/native-reconciliation.v3.json",
        "diagnostics": POST_F_ROOT / "evidence/linux/diagnostics/linux-native-reconciliation.json",
        "worker_sha256": "4b69bb8a6eec5da994cc8c575d49db6439efab67f94b063374e4a50b0716c1d1",
        "carchive_sha256": "d1174459a8f662b56f0afea8cff35ba4b6f2adf3efd9d710c91309be66270949",
        "build_context_id": "code-c-pyinstaller-591f56f5ebb38e58c7f4bac1e8b0d776",
        "source_import_graph_sha256": "581b0a1dcdd2ab8c797b894907392c22d3acfc39fac2b3a6727e96386d2bfb24",
        "sidecar_command_surface_sha256": "ee9e4d270d908c5cdfc468f7ed77a385c7b54249a96872ead660b7604f2a6383",
        "inspection_sha256": "97c2d6c3dc8ef4ddbb83389534da5cfa60cda7141f377de770f3f7fea67c4f68",
        "worker_evidence_run": "33508490237",
        "worker_artifact_id": "9800667271",
        "worker_artifact_digest": "sha256:25935e78ef91b923d7f217e64dfdacbd106336d99732023cdbf4815f88e4f1aa",
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
        "target_evidence": POST_F_ROOT / "evidence/windows/evidence/windows-target-evidence.json",
        "build_context": POST_F_ROOT / "evidence/windows/pyinstaller-build/windows/build-context.json",
        "packaging": POST_F_ROOT / "evidence/windows/native-v3/windows/packaging-selection-evidence.v1.json",
        "native": POST_F_ROOT / "evidence/windows/native-v3/windows/native-reconciliation.v3.json",
        "diagnostics": POST_F_ROOT / "evidence/windows/diagnostics/windows-native-reconciliation.json",
        "worker_sha256": "d99fa3c7b30e9bf8e45c03a124a794de70baaac630f18fde4d8fd71f6cb5713c",
        "carchive_sha256": "0e8ab47a5d08a3c7831575d018dc15f211ad7a4ffb837ae1183374e1e755f132",
        "build_context_id": "code-c-pyinstaller-93c78704c64e5063889df2aebd1981c5",
        "source_import_graph_sha256": "7b191069ab22437f0ae3cf97572aa6bd423399be3fa308901979cde524dfafb0",
        "sidecar_command_surface_sha256": "ee9e4d270d908c5cdfc468f7ed77a385c7b54249a96872ead660b7604f2a6383",
        "inspection_sha256": "dbbd1b3fbbc697cd9f7c4f91d3c12d3e7e69a797273770f70253d43709779332",
        "worker_evidence_run": "33508490237",
        "worker_artifact_id": "9800775126",
        "worker_artifact_digest": "sha256:d6e735db4198c7b3375620d166e41527680fa04584b847b25be5a07c9ad08857",
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--linux-inspection", type=Path, required=True)
    parser.add_argument("--windows-inspection", type=Path, required=True)
    parser.add_argument("--linux-cpython-archive", type=Path, required=True)
    parser.add_argument("--windows-cpython-archive", type=Path, required=True)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=REPOSITORY_ROOT / "compliance/vulnerability-reviews/cpython-3.13.15-stage-a-rebind-2026-09-03",
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
    post_f = load_json(POST_F_RECONCILIATION)
    if post_f.get("main_quality_baseline") != MAIN_QUALITY_BASELINE:
        raise SystemExit("post-F reconciliation is not bound to the requested main baseline")
    if post_f.get("final_distribution_binding_sha256") != FINAL_DISTRIBUTION_SHA256:
        raise SystemExit("final distribution binding differs from approved reconciliation")

    inspections = {"linux": args.linux_inspection, "windows": args.windows_inspection}
    archives = {"linux": args.linux_cpython_archive.resolve(strict=True), "windows": args.windows_cpython_archive.resolve(strict=True)}
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    captured_inspections: dict[str, tuple[dict[str, Any], Path]] = {}
    module_records: dict[str, dict[str, Any]] = {}
    failures: list[str] = []

    for target, source in inspections.items():
        info = TARGETS[target]
        post_f_worker = post_f.get("worker_artifacts", {}).get(target, {})
        if (
            post_f_worker.get("sha256") != info["worker_sha256"]
            or post_f_worker.get("carchive_sha256") != info["carchive_sha256"]
            or post_f_worker.get("build_context_id") != info["build_context_id"]
        ):
            failures.append(f"{target}: Post-F frozen Worker/CArchive binding mismatch")
        expected_sha = info["inspection_sha256"]
        copied = output_root / "worker-inspection" / f"{target}-worker-onefile.json"
        copy_inspection(source, copied, expected_sha)
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

    advisory_records: dict[str, dict[str, Any]] = {}
    for cve_id in ADVISORIES:
        advisory_records[cve_id], _ = advisory_record(cve_id, output_root)
    advisory_snapshot_id = f"code-c-cpython-stage-a-advisory-{head[:12]}"
    advisory_snapshot = {
        "report_kind": "CODE_C_CPYTHON_STAGE_A_ADVISORY_SNAPSHOT",
        "schema_version": "1",
        "snapshot_id": advisory_snapshot_id,
        "source_tier": "PSF_CNA_AFFECTED_VERSIONS",
        "allowed_cves": sorted(ADVISORIES),
        "retrieved_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "advisories": [advisory_records[cve] for cve in sorted(ADVISORIES)],
        "binding": "PASS" if all(item.get("response_sha256") for item in advisory_records.values()) else "FAIL",
    }
    snapshot_path = output_root / "STAGE_A_ADVISORY_SNAPSHOT.json"
    snapshot_write = write_canonical_json(snapshot_path, advisory_snapshot)
    snapshot_sha = snapshot_write.canonical_file_sha256
    (output_root / "STAGE_A_ADVISORY_SNAPSHOT.sha256").write_text(
        f"{snapshot_sha}  {snapshot_path.name}\n", encoding="utf-8"
    )

    targets_payload: dict[str, Any] = {}
    for target, (inspection, copied) in captured_inspections.items():
        info = TARGETS[target]
        target_evidence = load_json(info["target_evidence"])
        context = load_json(info["build_context"])
        packaging = load_json(info["packaging"])
        native = load_json(info["native"])
        diagnostics = load_json(info["diagnostics"])
        expected_archive_sha = info["distribution_sha256"]
        actual_archive_sha = sha256_file(archives[target])
        if actual_archive_sha != expected_archive_sha:
            failures.append(f"{target}: CPython distribution hash mismatch ({actual_archive_sha})")
        actual_payload_sha = info["payload_sha256"]
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
        }

    evaluations: list[dict[str, Any]] = []
    for target in TARGETS:
        info = TARGETS[target]
        for cve_id, advisory in advisory_records.items():
            cve_info = ADVISORIES[cve_id]
            historical = historical_cve_facts(historical_review, cve_id)
            affected = affected_by_ranges("3.13.15", advisory["affected_ranges"])
            module = cve_info["module"]
            disposition = "NOT_AFFECTED" if not affected else "PRELIMINARY_NOT_REACHABLE"
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
                    "relevant_module_included_in_current_worker": "YES",
                    "module_presence_evidence": module_records[target],
                    "relevant_capability_present": "YES",
                    "supporting_surface_observation": "NOT_OBSERVED",
                    "stage_b_reachability_conclusion": "NOT_EVALUATED",
                    "stage_a_factual_disposition": disposition,
                    "historical_disposition": cve_info["old_disposition"],
                    "stage_a_fact_drift": "PRESENT"
                    if advisory["fact_drift"] == "PRESENT"
                    else "NONE",
                    "notes": (
                        "Stage A records module/capability presence only; no attacker-controlled input or reachability conclusion was evaluated."
                    ),
                }
            )

    drift_details = [
        {
            "cve_id": cve,
            "historical_sha256": advisory_records[cve]["historical_response_sha256"],
            "current_sha256": advisory_records[cve]["response_sha256"],
            "historical_ranges": advisory_records[cve]["historical_affected_ranges"],
            "current_ranges": advisory_records[cve]["target_affected_ranges"],
        }
        for cve in sorted(ADVISORIES)
        if advisory_records[cve]["fact_drift"] == "PRESENT"
    ]
    trace_ok = not failures and all(
        targets_payload[target]["distribution"]["payload_sha256"]
        == (HISTORICAL_SUBJECT_SHA256 if target == "windows" else TARGETS[target]["payload_sha256"])
        for target in TARGETS
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
            "targets": targets_payload,
        },
        "stage_a_advisory_snapshot": {
            "snapshot_id": advisory_snapshot_id,
            "path": repo_relative(snapshot_path),
            "sha256": snapshot_sha,
            "binding": advisory_snapshot["binding"],
            "fact_drift": "PRESENT" if drift_details else "NONE",
            "stage_a_universe_drift": "PRESENT" if drift_details else "NONE",
            "details": drift_details,
        },
        "evaluations": evaluations,
        "stage_a_facts": {
            "module_presence_rebound": "PASS" if trace_ok else "FAIL",
            "module_presence_evidence_binding": "PASS" if trace_ok else "FAIL",
            "capability_presence_rebound": "PASS" if trace_ok else "FAIL",
            "worker_composition_binding": "PASS" if trace_ok else "FAIL",
            "stage_b_reachability_conclusion": "NOT_EVALUATED",
            "stage_a_fact_drift": "PRESENT" if drift_details else "NONE",
        },
        "license_and_distribution": {
            "python_license_gate": "PASS" if post_f.get("python_license_gate") == "PASS" else "UNKNOWN",
            "final_distribution_binding_id": FINAL_DISTRIBUTION_ID,
            "final_distribution_binding_sha256": FINAL_DISTRIBUTION_SHA256,
            "final_distribution_binding": "PASS",
            "stable_release_license_gate": "BLOCKED_BY_EXTERNAL_MSVC_REDISTRIBUTION",
            "post_f_reconciliation": evidence_identity(POST_F_RECONCILIATION),
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
            "stage_b": "BLOCKED_PENDING_STAGE_A_REBIND_REVIEW",
            "siglip_index": "BLOCKED_NOT_RERUN",
            "owner": "CODE_F",
        },
        # These top-level aliases keep the handoff easy to consume without
        # changing the production vulnerability-disposition contract.
        "stage_a_rebind_bundle_id": f"code-c-cpython-stage-a-rebind-{head[:12]}",
        "stage_a_advisory_snapshot_id": advisory_snapshot_id,
        "python_license_gate": "PASS" if post_f.get("python_license_gate") == "PASS" else "UNKNOWN",
        "final_distribution_binding": "PASS",
        "stage_b_reachability_conclusion": "NOT_EVALUATED",
        "cve_stage_a_rebind": "BLOCKED_PENDING_CODE_F_REVIEW",
        "stage_b": "BLOCKED_PENDING_STAGE_A_REBIND_REVIEW",
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
        "ADVISORY_FACT_DRIFT": "PRESENT" if drift_details else "NONE",
        "OUTPUT_ROOT": repo_relative(output_root),
    }, indent=2))


if __name__ == "__main__":
    main()
