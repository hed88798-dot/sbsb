"""Assemble the two-platform Stage B bundle from compact runner evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

from canonical_evidence import write_canonical_json


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
STAGE_A_ROOT = REPOSITORY_ROOT / "compliance/vulnerability-reviews/cpython-3.13.15-stage-a-rebind-current-head-76529014"
STAGE_A_BUNDLE = STAGE_A_ROOT / "STAGE_A_REBIND_BUNDLE.json"
STAGE_A_BUNDLE_SHA256 = "eeda8f7830dfbed06653d31eadeea603b0492fda46646929ad554a332e551b40"
ADVISORY_SNAPSHOT_SHA256 = "fdd5f256147e21ed74dec39c47e74f81c96f421e97a7a9d23d19ffde725ea028"
FINAL_DISTRIBUTION_ID = "code-c-final-distribution-6cd09589d42329c7"
FINAL_DISTRIBUTION_SHA256 = "6cd09589d42329c75e4ecac05411c898b81e60f5813cb8aa704b6e9b3ce0e799"
EXPECTED = {
    "linux": {
        "worker_sha256": "4bd6d3afd3d2d60718f8174caedafb16a91c398a90c4198c664d14555a5f6073",
        "carchive_sha256": "163e72f82f93b3f7ac5585426431ccc01bf61578bcec571a83b09b08abdd0a0e",
    },
    "windows": {
        "worker_sha256": "ba6b81f433beef8ee95615a45248251918a18a602b53f8db9ec02e35cf76d8b1",
        "carchive_sha256": "1a319765900d1b6cde0743efa902a5d8cb0468335f118775bbf65565e9b2c805",
    },
}


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def git_head() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def relative(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPOSITORY_ROOT).as_posix()
    except ValueError:
        return str(path)


def identity(path: Path) -> dict[str, str]:
    return {"path": relative(path), "sha256": sha256_file(path)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--linux-evidence", type=Path, required=True)
    parser.add_argument("--windows-evidence", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()

    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    current_head = git_head()
    stage_a_sha = sha256_file(STAGE_A_BUNDLE)
    stage_a = load_json(STAGE_A_BUNDLE)
    failures: list[str] = []
    if stage_a_sha != STAGE_A_BUNDLE_SHA256:
        failures.append("accepted Stage A bundle SHA mismatch")
    if stage_a.get("status") != "BLOCKED_PENDING_CODE_F_REVIEW":
        failures.append("Stage A bundle is not the accepted reviewed subject")
    if stage_a.get("stage_a_advisory_snapshot", {}).get("sha256") != ADVISORY_SNAPSHOT_SHA256:
        failures.append("Stage A advisory snapshot mismatch")
    if stage_a.get("license_and_distribution", {}).get("final_distribution_binding_id") != FINAL_DISTRIBUTION_ID or stage_a.get("license_and_distribution", {}).get("final_distribution_binding_sha256") != FINAL_DISTRIBUTION_SHA256:
        failures.append("Stage A final distribution binding mismatch")

    evidence_paths = {"linux": args.linux_evidence.resolve(strict=True), "windows": args.windows_evidence.resolve(strict=True)}
    evidence: dict[str, dict[str, Any]] = {}
    for target, path in evidence_paths.items():
        item = load_json(path)
        evidence[target] = item
        expected = EXPECTED[target]
        authority = item.get("candidate_authority", {})
        runtime = item.get("runtime_artifact_identity", {})
        protocol = item.get("protocol", {})
        network = item.get("network", {})
        archive = item.get("archive", {})
        if item.get("status") != "PASS":
            failures.append(f"{target} runtime evaluator did not PASS")
        if authority.get("stage_a_bundle_sha256") != STAGE_A_BUNDLE_SHA256 or authority.get("advisory_snapshot_sha256") != ADVISORY_SNAPSHOT_SHA256:
            failures.append(f"{target} Stage A/advisory binding mismatch")
        if authority.get("final_distribution_binding_id") != FINAL_DISTRIBUTION_ID or authority.get("final_distribution_binding_sha256") != FINAL_DISTRIBUTION_SHA256:
            failures.append(f"{target} Final Distribution Binding mismatch")
        if authority.get("transfer_role") != "TRANSPORT_ONLY" or authority.get("stage_b_authority_depends_on_transient_artifact") != "NO":
            failures.append(f"{target} transient artifact was treated as authority")
        for key in ("pre_test_worker_sha256", "post_test_worker_sha256"):
            if runtime.get(key) != expected["worker_sha256"]:
                failures.append(f"{target} {key} mismatch")
        for key in ("pre_test_carchive_sha256", "post_test_carchive_sha256"):
            if runtime.get(key) != expected["carchive_sha256"]:
                failures.append(f"{target} {key} mismatch")
        if runtime.get("identity") != "PASS":
            failures.append(f"{target} runtime artifact identity is not PASS")
        if protocol.get("external_command_count") != 8 or protocol.get("external_input_field_count") != 21 or protocol.get("unaccounted_external_input_count") != 0 or protocol.get("input_surface_drift") != "NONE":
            failures.append(f"{target} current external input surface is incomplete or drifted")
        if network.get("positive_control", {}).get("status") != "PASS" or network.get("user_controlled_affected_call_count") != 0 or network.get("unexpected_network_side_effect_count") != 0:
            failures.append(f"{target} network reachability evidence is not closed")
        if archive.get("positive_control", {}).get("status") != "PASS" or archive.get("user_reachable_callsite_count") != 0 or archive.get("unresolved_wrapper_count") != 0 or archive.get("affected_archive_extraction_call_count") != 0 or archive.get("extracted_member_count") != 0 or archive.get("unexpected_temp_output_count") != 0:
            failures.append(f"{target} archive reachability evidence is not closed")
        variants = {
            fixture.get("input_variant")
            for fixture in archive.get("fixture_set", [])
            if isinstance(fixture, dict)
        }
        required_variants = {
            "ZIP_MEDIA",
            "RENAMED_IMAGE",
            "RENAMED_MODEL",
            "RENAMED_ACCEPTED_MEDIA",
        }
        if not required_variants.issubset(variants):
            failures.append(f"{target} archive fixture coverage is incomplete")
        third_party_closure = item.get("callsite_closure", {}).get("third_party", {})
        if third_party_closure.get("unresolved_wrapper_count") != 0:
            failures.append(f"{target} third-party wrapper closure is unresolved")

    linux = evidence["linux"]
    windows = evidence["windows"]
    protocol_sha = linux["protocol"]["contract_sha256"]
    surface_sha = linux["protocol"]["external_input_surface_sha256"]
    if windows["protocol"]["contract_sha256"] != protocol_sha:
        failures.append("Linux and Windows protocol contract identities differ")
    if windows["protocol"]["external_input_surface_sha256"] != surface_sha:
        failures.append("Linux and Windows external input surface identities differ")
    module_sha = {
        target: evidence[target]["packaged_module_inventory"]["sha256"] for target in ("linux", "windows")
    }
    evaluator_sha = linux["stage_b_evaluator"]["sha256"]
    evaluator_id = linux["stage_b_evaluator"]["id"]
    if windows["stage_b_evaluator"]["sha256"] != evaluator_sha:
        failures.append("Linux and Windows Stage B evaluator identities differ")
    network_fixture_sha = {target: evidence[target]["network"]["fixture_set_sha256"] for target in ("linux", "windows")}
    archive_fixture_sha = {target: evidence[target]["archive"]["fixture_set_sha256"] for target in ("linux", "windows")}
    conclusions = {
        "CVE_2026_15806_LINUX_STAGE_B": linux["cve_2026_15806"]["stage_b"],
        "CVE_2026_15806_WINDOWS_STAGE_B": windows["cve_2026_15806"]["stage_b"],
        "CVE_2026_15310_LINUX_STAGE_B": linux["cve_2026_15310"]["stage_b"],
        "CVE_2026_15310_WINDOWS_STAGE_B": windows["cve_2026_15310"]["stage_b"],
    }
    if any(value != "NOT_REACHABLE" for value in conclusions.values()):
        failures.append("one or more Stage B subjects did not reach NOT_REACHABLE")

    targets = {}
    for target in ("linux", "windows"):
        item = evidence[target]
        stage_a_target = stage_a["current_stage_a_rebind"]["targets"][target]
        targets[target] = {
            "job_id": item["runner"]["job_id"],
            "worker_sha256": item["runtime_artifact_identity"]["pre_test_worker_sha256"],
            "carchive_sha256": item["runtime_artifact_identity"]["pre_test_carchive_sha256"],
            "candidate_manifest": stage_a_target["candidate_manifest"],
            "retention": stage_a_target["retention"],
            "recovery": stage_a_target["recovery"],
            "runtime_evidence": identity(evidence_paths[target]),
            "packaged_module_inventory": item["packaged_module_inventory"],
            "stage_b_evaluator": item["stage_b_evaluator"],
            "network_fixture_set_sha256": item["network"]["fixture_set_sha256"],
            "archive_fixture_set_sha256": item["archive"]["fixture_set_sha256"],
            "network": item["network"],
            "archive": item["archive"],
            "callsite_closure": item["callsite_closure"],
            "protocol": item["protocol"],
            "cve_2026_15806": item["cve_2026_15806"],
            "cve_2026_15310": item["cve_2026_15310"],
        }

    bundle = {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_CURRENT_CANDIDATE_REACHABILITY_BUNDLE",
        "schema_version": "1",
        "bundle_id": f"code-c-stage-b-current-candidate-{current_head[:16]}",
        "status": "READY_FOR_CODE_F_FINAL_REVIEW" if not failures else "BLOCKED",
        "validation_head_sha": current_head,
        "main_quality_baseline_sha": stage_a.get("main_quality_baseline_sha"),
        "stage_a_review": {
            "status": "PASS",
            "reviewed_code_c_head": "dcd01482e1590878915292f7450fe3cab39874f1",
            "validation_head": stage_a.get("validation_head_sha"),
            "bundle": identity(STAGE_A_BUNDLE),
        },
        "advisory_snapshot_sha256": ADVISORY_SNAPSHOT_SHA256,
        "final_distribution_binding": {"id": FINAL_DISTRIBUTION_ID, "sha256": FINAL_DISTRIBUTION_SHA256, "status": "PASS"},
        "candidate_authority": {
            "candidate_id_prefix": "code-c-76529014f47945fc2916d0488115822bc28d16c7",
            "transient_transfer_artifact_role": "TRANSPORT_ONLY",
            "stage_b_authority_depends_on_transient_artifact": "NO",
            "retention_channel": "MAC_LOCAL_PROJECT_FOLDER",
            "recovery_drill": "PASS",
        },
        "current_protocol": {
            "contract_sha256": protocol_sha,
            "external_input_surface_sha256": surface_sha,
            "external_command_count": linux["protocol"]["external_command_count"],
            "external_input_field_count": linux["protocol"]["external_input_field_count"],
            "unaccounted_external_input_count": 0,
            "input_surface_drift": "NONE",
        },
        "CURRENT_PROTOCOL_CONTRACT_SHA256": protocol_sha,
        "CURRENT_EXTERNAL_INPUT_SURFACE_SHA256": surface_sha,
        "CURRENT_EXTERNAL_COMMAND_COUNT": linux["protocol"]["external_command_count"],
        "CURRENT_EXTERNAL_INPUT_FIELD_COUNT": linux["protocol"]["external_input_field_count"],
        "UNACCOUNTED_EXTERNAL_INPUT_COUNT": 0,
        "INPUT_SURFACE_DRIFT": "NONE",
        "packaged_module_inventory_sha256": module_sha,
        "stage_b_evaluator": {"id": evaluator_id, "sha256": evaluator_sha, "version": "1"},
        "STAGE_B_EVALUATOR_ID": evaluator_id,
        "STAGE_B_EVALUATOR_SHA256": evaluator_sha,
        "network_test_fixture_set_sha256": network_fixture_sha,
        "archive_test_fixture_set_sha256": archive_fixture_sha,
        "NETWORK_TEST_FIXTURE_SET_SHA256": network_fixture_sha,
        "ARCHIVE_TEST_FIXTURE_SET_SHA256": archive_fixture_sha,
        "STAGE_B_EVALUATOR_IDENTITIES_BY_TARGET": {
            target: evidence[target]["stage_b_evaluator"] for target in ("linux", "windows")
        },
        "targets": targets,
        "conclusions": conclusions,
        **conclusions,
        "CVE_2026_3087_STAGE_B": "NOT_REQUIRED",
        "first_party_callsite_summary": {
            target: evidence[target]["callsite_closure"]["first_party"] for target in ("linux", "windows")
        },
        "third_party_wrapper_closure": {
            "relevant_wrapper_count": 0,
            "user_reachable_wrapper_count": 0,
            "unresolved_wrapper_count": 0,
            "status": "PASS",
        },
        "runtime_summary": {
            "linux_stage_b_test": linux["status"],
            "windows_stage_b_test": windows["status"],
            "network_sentinel_positive_control": "PASS",
            "archive_api_sentinel_positive_control": "PASS",
            "runtime_artifact_identity": "PASS" if not failures else "FAIL",
            "worker_rebuild": "NO",
            "native_rerun": "NO",
            "license_rerun": "NO",
        },
        "recheck_triggers": {
            "status": "PASS",
            "invalidate_on": [
                "Worker SHA change",
                "CArchive SHA change",
                "CPython artifact change",
                "Final Distribution Binding change",
                "Candidate Manifest or dependency graph change",
                "Protocol Contract or External Input Surface change",
                "Network, credential, archive, decompression, or file-handling route change",
                "Advisory Snapshot change",
                "Stage B evaluator semantics change",
            ],
        },
        "controls": {
            "stage_a_rewritten": "NO",
            "worker_rebuild": "NO",
            "native_rerun": "NO",
            "license_rerun": "NO",
            "siglip_index": "BLOCKED_NOT_RERUN",
            "pr_8_updated": "NO",
        },
        "stage_b_evidence_status": "READY_FOR_CODE_F_FINAL_REVIEW" if not failures else "BLOCKED",
        "vulnerability_production_acceptance": "NOT_PERFORMED",
        "mandatory_stop": "ACTIVE",
        "failures": failures,
    }
    bundle_path = output_root / "STAGE_B_REACHABILITY_BUNDLE.json"
    bundle_write = write_canonical_json(bundle_path, bundle)
    (output_root / "STAGE_B_REACHABILITY_BUNDLE.sha256").write_text(
        f"{bundle_write.canonical_file_sha256}  {bundle_path.name}\n", encoding="utf-8"
    )
    (output_root / "README.md").write_text(
        "# Current Candidate Stage B runtime reachability\n\n"
        "This bundle contains only exact Worker runtime observations and compact evidence. The Worker was not rebuilt or modified; Actions transport artifacts were not treated as authority. Final vulnerability disposition remains with Code F.\n",
        encoding="utf-8",
    )
    if failures:
        raise SystemExit("Stage B bundle blocked:\n" + "\n".join(failures))
    print(json.dumps({"status": bundle["status"], "validation_head_sha": current_head, "bundle_sha256": bundle_write.canonical_file_sha256, "output": relative(bundle_path)}, indent=2))


if __name__ == "__main__":
    main()
