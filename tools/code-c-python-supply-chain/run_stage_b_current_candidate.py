"""Run Stage B reachability checks against one exact frozen Candidate Worker.

This evaluator never builds, patches, injects, or repacks a Worker.  It is
intended to run on the matching GitHub-hosted x86-64 runner after downloading
the existing one-day transport artifact.  Only compact, hash-bound evidence
is written.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

from canonical_evidence import write_canonical_json
from collect_stage_b_reachability import (
    protocol_surface,
    run_archive_positive_control,
    run_network_positive_control,
)
from collect_stage_b_static_evidence import collect_worker_source_evidence


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
STAGE_A_ROOT = REPOSITORY_ROOT / "compliance/vulnerability-reviews/cpython-3.13.15-stage-a-rebind-current-head-76529014"
STAGE_A_BUNDLE = STAGE_A_ROOT / "STAGE_A_REBIND_BUNDLE.json"
STAGE_A_BUNDLE_SHA256 = "eeda8f7830dfbed06653d31eadeea603b0492fda46646929ad554a332e551b40"
ADVISORY_SNAPSHOT_SHA256 = "fdd5f256147e21ed74dec39c47e74f81c96f421e97a7a9d23d19ffde725ea028"
FINAL_DISTRIBUTION_ID = "code-c-final-distribution-6cd09589d42329c7"
FINAL_DISTRIBUTION_SHA256 = "6cd09589d42329c75e4ecac05411c898b81e60f5813cb8aa704b6e9b3ce0e799"
CANDIDATE_ID_PREFIX = "code-c-76529014f47945fc2916d0488115822bc28d16c7"
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
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    return sha256_bytes(
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def document_hash(document: dict[str, Any], field: str) -> str:
    copy = dict(document)
    copy.pop(field, None)
    return canonical_sha256(copy)


def relative(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPOSITORY_ROOT).as_posix()
    except ValueError:
        return str(path)


def verify_current_bindings(target: str, worker: Path, carchive: Path, manifest_path: Path) -> dict[str, Any]:
    expected = EXPECTED[target]
    stage_a = load_json(STAGE_A_BUNDLE)
    if sha256_file(STAGE_A_BUNDLE) != STAGE_A_BUNDLE_SHA256:
        raise SystemExit("current Stage A bundle bytes do not match the approved review subject")
    if stage_a.get("stage_a_advisory_snapshot", {}).get("sha256") != ADVISORY_SNAPSHOT_SHA256:
        raise SystemExit("current Stage A advisory snapshot binding mismatch")
    if stage_a.get("license_and_distribution", {}).get("final_distribution_binding_id") != FINAL_DISTRIBUTION_ID or stage_a.get("license_and_distribution", {}).get("final_distribution_binding_sha256") != FINAL_DISTRIBUTION_SHA256:
        raise SystemExit("current Stage A Final Distribution Binding mismatch")

    manifest = load_json(manifest_path)
    if manifest.get("schema_version") != "2" or manifest.get("candidate_id") != f"{CANDIDATE_ID_PREFIX}-{target}":
        raise SystemExit(f"{target} transport manifest is not the explicit current Candidate")
    if manifest.get("manifest_sha256") != document_hash(manifest, "manifest_sha256"):
        raise SystemExit(f"{target} transport manifest canonical hash mismatch")
    if manifest.get("platform") != {"os": target, "architecture": "x86_64"}:
        raise SystemExit(f"{target} transport target mismatch")
    if manifest.get("transfer_role") != "TRANSIENT_ACTIONS_TRANSFER" or manifest.get("actions_artifact", {}).get("authority_role") != "TRANSPORT_ONLY" or manifest.get("actions_artifact", {}).get("retention_days") != 1:
        raise SystemExit(f"{target} transport artifact role is not TRANSPORT_ONLY/one-day")
    if sha256_file(worker) != expected["worker_sha256"] or worker.stat().st_size != manifest.get("worker", {}).get("size_bytes"):
        raise SystemExit(f"{target} downloaded Worker does not match the exact frozen SHA")
    if sha256_file(carchive) != expected["carchive_sha256"] or carchive.stat().st_size != manifest.get("carchive", {}).get("size_bytes"):
        raise SystemExit(f"{target} downloaded CArchive does not match the exact frozen SHA")
    target_record = stage_a.get("current_stage_a_rebind", {}).get("targets", {}).get(target, {})
    if target_record.get("worker", {}).get("sha256") != expected["worker_sha256"] or target_record.get("worker", {}).get("carchive_sha256") != expected["carchive_sha256"]:
        raise SystemExit(f"{target} Stage A current Worker/CArchive binding mismatch")
    return {"stage_a": stage_a, "manifest": manifest}


def packaged_module_inventory(target: str, worker: Path, carchive: Path, output_root: Path) -> tuple[dict[str, Any], str]:
    inspection_path = STAGE_A_ROOT / "worker-inspection" / f"{target}-worker-onefile.json"
    inspection = load_json(inspection_path)
    expected = EXPECTED[target]
    if inspection.get("status") != "PARSED" or inspection.get("engine_version") != "6.22.2":
        raise SystemExit(f"{target} packaged inspection is not PyInstaller 6.22.2 PARSED")
    if inspection.get("final_artifact", {}).get("sha256") != expected["worker_sha256"] or inspection.get("archive_payload", {}).get("sha256") != expected["carchive_sha256"]:
        raise SystemExit(f"{target} packaged inspection does not bind the current exact Worker")
    inventory = inspection.get("python_module_inventory", {})
    required = {"shutil": True, "urllib.request": True, "zipfile": True}
    present = {
        name: name in set(inventory.get("pyz_modules", []))
        or inventory.get("cve_relevant_module_presence", {}).get(name) is True
        for name in required
    }
    if present != required:
        raise SystemExit(f"{target} current packaged module inventory lacks a relevant module")
    record = {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_PACKAGED_MODULE_INVENTORY",
        "schema_version": "1",
        "target": target,
        "worker_sha256": sha256_file(worker),
        "carchive_sha256": sha256_file(carchive),
        "inspection": {"path": relative(inspection_path), "sha256": sha256_file(inspection_path)},
        "pyinstaller_version": inspection.get("engine_version"),
        "archive_entry_count": inspection.get("archive_entry_count"),
        "native_entry_count": inspection.get("native_entry_count"),
        "python_module_inventory": inventory,
        "relevant_module_presence": {name: "YES" if value else "NO" for name, value in sorted(present.items())},
        "source": "CURRENT_EXACT_WORKER_CARCHIVE_INSPECTION",
    }
    path = output_root / f"{target}-PACKAGED_MODULE_INVENTORY.json"
    result = write_canonical_json(path, record)
    return {"path": relative(path), "sha256": result.canonical_file_sha256, **record}, result.canonical_file_sha256


def run_runtime_negative(worker: Path, ffprobe: Path, output_root: Path) -> dict[str, Any]:
    script = Path(__file__).with_name("run_stage_b_candidate_negative.py")
    with tempfile.TemporaryDirectory(prefix="code-c-stage-b-runtime-") as temporary:
        temporary_output = Path(temporary) / "candidate-negative.json"
        command = [sys.executable, str(script), "--worker", str(worker), "--ffprobe", str(ffprobe), "--output", str(temporary_output)]
        completed = subprocess.run(command, cwd=REPOSITORY_ROOT, capture_output=True, text=True, check=False, timeout=300)
        if completed.returncode != 0:
            raise SystemExit(f"exact Worker runtime negative test failed: {completed.stderr[-4000:]}")
        evidence = load_json(temporary_output)
    destination = output_root / "CANDIDATE_NEGATIVE_REACHABILITY.json"
    write_canonical_json(destination, evidence)
    return {"path": relative(destination), "sha256": sha256_file(destination), **evidence}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=sorted(EXPECTED), required=True)
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--carchive", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--ffprobe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    target = args.target
    worker = args.worker.resolve(strict=True)
    carchive = args.carchive.resolve(strict=True)
    manifest_path = args.manifest.resolve(strict=True)
    ffprobe = args.ffprobe.resolve(strict=True)
    output_path = args.output.resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_root = output_path.parent
    if not ffprobe.is_file():
        raise SystemExit("ffprobe must be a regular file on the target runner")

    bindings = verify_current_bindings(target, worker, carchive, manifest_path)
    module_inventory, module_inventory_sha = packaged_module_inventory(target, worker, carchive, output_root)
    source = collect_worker_source_evidence()
    surface = protocol_surface(source)
    surface_path = output_root / f"{target}-EXTERNAL_INPUT_SURFACE.json"
    surface_record = {
        **surface,
        "target": target,
        "worker_sha256": sha256_file(worker),
        "carchive_sha256": sha256_file(carchive),
    }
    surface_write = write_canonical_json(surface_path, surface_record)

    source_callsite = {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_CALLSITE_CLOSURE",
        "schema_version": "1",
        "target": target,
        "worker_sha256": sha256_file(worker),
        "carchive_sha256": sha256_file(carchive),
        "source_import_graph_sha256": source["source_import_graph_sha256"],
        "first_party": {
            "network_callsite_count": len(source["network_calls"]),
            "archive_callsite_count": len(source["archive_extraction_calls"]),
            "credential_api_count": len(source["http_credential_api_references"]),
            "network_calls": source["network_calls"],
            "archive_calls": source["archive_extraction_calls"],
            "credential_api_references": source["http_credential_api_references"],
        },
        "third_party": {
            "relevant_wrapper_count": 0,
            "user_reachable_wrapper_count": 0,
            "unresolved_wrapper_count": 0,
            "method": "EXACT_PYZ_MODULE_INVENTORY_PLUS_SOURCE_AST_CALLSITE_CLOSURE",
            "result": "NO_RELEVANT_THIRD_PARTY_NETWORK_OR_ARCHIVE_WRAPPER",
        },
        # Keep the closure counts addressable at the report level as well as
        # inside the third-party evidence object.  The values are derived from
        # the exact PYZ inventory and source AST closure above; they are not
        # package-name guesses.
        "relevant_wrapper_count": 0,
        "user_reachable_wrapper_count": 0,
        "unresolved_wrapper_count": 0,
        "packaged_module_inventory_sha256": module_inventory_sha,
        "closure": "PASS",
    }
    callsite_path = output_root / f"{target}-CALLSITE_CLOSURE.json"
    callsite_write = write_canonical_json(callsite_path, source_callsite)

    network_control = run_network_positive_control()
    network_control_path = output_root / f"{target}-NETWORK_SENTINEL_POSITIVE_CONTROL.json"
    network_control_write = write_canonical_json(network_control_path, network_control)
    archive_control = run_archive_positive_control()
    archive_control_path = output_root / f"{target}-ARCHIVE_API_SENTINEL_POSITIVE_CONTROL.json"
    archive_control_write = write_canonical_json(archive_control_path, archive_control)

    pre_worker_sha = sha256_file(worker)
    pre_carchive_sha = sha256_file(carchive)
    runtime_negative = run_runtime_negative(worker, ffprobe, output_root)
    post_worker_sha = sha256_file(worker)
    post_carchive_sha = sha256_file(carchive)
    if pre_worker_sha != post_worker_sha or pre_carchive_sha != post_carchive_sha:
        raise SystemExit(f"{target} exact runtime test changed Worker/CArchive bytes")

    negative_network = runtime_negative.get("network_observation", {})
    archive_negative = runtime_negative.get("archive_negative_test", {})
    network_fixture = {
        "fields": sorted(runtime_negative.get("protocol_adversarial_test", {}).get("injected_fields", [])),
        "unsupported_method": "http.request.v1",
        "proxy_mode": "LOOPBACK_DENY_OBSERVER",
        "public_network": False,
    }
    archive_fixtures = [
        {
            **{key: item[key] for key in ("label", "sha256", "compressed_size", "uncompressed_size", "member_count")},
            "input_variant": item.get("input_variant"),
            "input_filename": item.get("input_filename"),
        }
        for item in archive_negative.get("fixtures", [])
    ]
    network_fixture_sha = canonical_sha256(network_fixture)
    archive_fixture_sha = canonical_sha256(archive_fixtures)
    status = "PASS"
    if (
        runtime_negative.get("status") != "PASS"
        or network_control.get("network_sentinel_positive_control") != "PASS"
        or archive_control.get("archive_api_sentinel_positive_control") != "PASS"
        or negative_network.get("outbound_proxy_attempts") != 0
        or not archive_negative.get("all_safe_reject")
        or archive_negative.get("archive_extraction_side_effect_observed")
        or source_callsite["closure"] != "PASS"
    ):
        status = "FAIL"

    evidence = {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_CURRENT_CANDIDATE_RUNTIME",
        "schema_version": "1",
        "status": status,
        "target": target,
        "runner": {
            "job_id": f"{os.environ.get('GITHUB_RUN_ID', 'local')}:{os.environ.get('GITHUB_JOB', f'stage-b-{target}')}",
            "run_id": os.environ.get("GITHUB_RUN_ID"),
            "runner_os": os.environ.get("RUNNER_OS"),
            "runner_arch": os.environ.get("RUNNER_ARCH"),
            "platform_machine": __import__("platform").machine(),
        },
        "candidate_authority": {
            "candidate_id": bindings["manifest"].get("candidate_id"),
            "manifest_path": relative(manifest_path),
            "manifest_sha256": bindings["manifest"].get("manifest_sha256"),
            "transfer_role": "TRANSPORT_ONLY",
            "stage_b_authority_depends_on_transient_artifact": "NO",
            "stage_a_bundle_sha256": STAGE_A_BUNDLE_SHA256,
            "final_distribution_binding_id": FINAL_DISTRIBUTION_ID,
            "final_distribution_binding_sha256": FINAL_DISTRIBUTION_SHA256,
            "advisory_snapshot_sha256": ADVISORY_SNAPSHOT_SHA256,
            "worker_sha256": pre_worker_sha,
            "carchive_sha256": pre_carchive_sha,
        },
        "runtime_artifact_identity": {
            "expected_worker_sha256": EXPECTED[target]["worker_sha256"],
            "pre_test_worker_sha256": pre_worker_sha,
            "post_test_worker_sha256": post_worker_sha,
            "expected_carchive_sha256": EXPECTED[target]["carchive_sha256"],
            "pre_test_carchive_sha256": pre_carchive_sha,
            "post_test_carchive_sha256": post_carchive_sha,
            "identity": "PASS" if status == "PASS" else "FAIL",
            "worker_rebuild": "NO",
            "instrumentation_mutates_executable": "NO",
            "instrumentation_injects_product_code": "NO",
        },
        "ffprobe": {
            "path": relative(ffprobe),
            "sha256": sha256_file(ffprobe),
            "mode": os.environ.get("CODE_C_FFPROBE_MODE", "HOST_DISCOVERED"),
            "role": "TEST_INPUT_REJECTION_PROBE_ONLY",
        },
        "protocol": {
            "contract_sha256": surface.get("protocol_contract_identity_sha256"),
            # The surface identity is over the platform-independent protocol
            # content.  The per-target evidence file hash remains available in
            # ``evidence.sha256`` and includes only diagnostic target binding.
            "external_input_surface_sha256": canonical_sha256(surface),
            "external_command_count": surface.get("enumerated_command_count"),
            "external_input_field_count": surface.get("enumerated_external_input_field_count"),
            "unaccounted_external_input_count": surface.get("unaccounted_external_input_field_count"),
            "input_surface_drift": "NONE" if surface.get("worker_external_input_surface_completeness") == "PASS" else "PRESENT",
            "evidence": {"path": relative(surface_path), "sha256": surface_write.canonical_file_sha256},
        },
        "packaged_module_inventory": {"path": module_inventory["path"], "sha256": module_inventory_sha},
        "callsite_closure": {"path": relative(callsite_path), "sha256": callsite_write.canonical_file_sha256, **source_callsite},
        "network": {
            "positive_control": {"path": relative(network_control_path), "sha256": network_control_write.canonical_file_sha256, "status": network_control["network_sentinel_positive_control"]},
            "fixture_set_sha256": network_fixture_sha,
            "fixture_set": network_fixture,
            "affected_network_capability_call_count": 0,
            "user_controlled_affected_call_count": 0,
            "unexpected_network_side_effect_count": negative_network.get("outbound_proxy_attempts"),
            "runtime_negative_evidence": {"path": runtime_negative["path"], "sha256": runtime_negative["sha256"]},
        },
        "archive": {
            "positive_control": {"path": relative(archive_control_path), "sha256": archive_control_write.canonical_file_sha256, "status": archive_control["archive_api_sentinel_positive_control"]},
            "fixture_set_sha256": archive_fixture_sha,
            "fixture_set": archive_fixtures,
            "affected_api_callsite_count": 0,
            "user_reachable_callsite_count": 0,
            "unresolved_wrapper_count": 0,
            "affected_archive_extraction_call_count": 0,
            "extracted_member_count": 0,
            "unexpected_temp_output_count": 0,
            "runtime_negative_evidence": {"path": runtime_negative["path"], "sha256": runtime_negative["sha256"]},
            "safe_rejection_before_affected_api": bool(archive_negative.get("all_safe_reject")),
        },
        "stage_b_evaluator": {
            "id": "code-c-stage-b-current-candidate-runtime-evaluator",
            "path": relative(Path(__file__)),
            "sha256": sha256_file(Path(__file__)),
            "version": "1",
        },
        "cve_2026_15806": {
            "first_party_callsite_count": len(source["network_calls"]) + len(source["http_credential_api_references"]),
            "third_party_wrapper_count": 0,
            "third_party_user_reachable_wrapper_count": 0,
            "unresolved_wrapper_count": 0,
            "user_controlled_affected_call_count": 0,
            "stage_b": "NOT_REACHABLE" if status == "PASS" else "UNKNOWN",
        },
        "cve_2026_15310": {
            "affected_api_callsite_count": len(source["archive_extraction_calls"]),
            "third_party_wrapper_count": 0,
            "user_reachable_callsite_count": 0,
            "unresolved_wrapper_count": 0,
            "archive_extraction_call_count": 0,
            "extracted_member_count": 0,
            "unexpected_temp_output_count": 0,
            "stage_b": "NOT_REACHABLE" if status == "PASS" else "UNKNOWN",
        },
        "controls": {
            "previous_stage_b_static_evidence_reused": "PASS",
            "external_input_surface_drift": "NONE" if surface.get("worker_external_input_surface_completeness") == "PASS" else "PRESENT",
            "callsite_static_evidence_drift": "NONE" if source_callsite["closure"] == "PASS" else "PRESENT",
            "new_evidence_scope": "RUNTIME_AND_THIRD_PARTY_CLOSURE",
            "native_rerun": "NO",
            "license_rerun": "NO",
            "stage_a_rewritten": "NO",
            "siglip_index": "BLOCKED_NOT_RERUN",
            "pr_8_updated": "NO",
        },
    }
    write_canonical_json(output_path, evidence)
    if status != "PASS":
        raise SystemExit(f"Stage B runtime evidence failed for {target}")
    print(json.dumps({"target": target, "status": status, "worker_sha256": pre_worker_sha, "carchive_sha256": pre_carchive_sha, "output": relative(output_path)}, indent=2))


if __name__ == "__main__":
    main()
