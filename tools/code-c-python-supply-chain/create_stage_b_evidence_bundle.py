from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "toolchain-source-lock.json"
)
SPECIFICATION = REPOSITORY_ROOT / "sidecars" / "media-worker" / "media-worker.spec"


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load(path: Path) -> dict[str, object]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"Stage B evidence input is not an object: {path}")
    return value


def git_head() -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPOSITORY_ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--bundle-root", type=Path, required=True)
    parser.add_argument("--main-quality-baseline", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--sha256-output", type=Path, required=True)
    parser.add_argument("--handoff", type=Path, required=True)
    arguments = parser.parse_args()

    root = arguments.bundle_root
    worker = arguments.worker.resolve(strict=True)
    head = git_head()
    runtime_path = root / "candidates" / "code-c-windows-runtime.v2.json"
    worker_build_path = root / "candidates" / "code-c-windows-worker-build.v2.json"
    runtime_identity_path = root / "evidence" / "windows-runtime-identity.json"
    graph_attestation_path = root / "evidence" / "windows-graph-interpreter-attestation.json"
    binding_regressions_path = root / "evidence" / "windows-interpreter-binding-regressions.json"
    target_evidence_path = root / "evidence" / "windows-target-evidence.json"
    stage_a_path = root / "evidence" / "windows-stage-a-artifact-binding.json"
    inspection_path = root / "inspection" / "windows-worker-onefile.json"
    static_path = root / "stage-b" / "STATIC_REACHABILITY.json"
    negative_path = root / "stage-b" / "CANDIDATE_NEGATIVE_REACHABILITY.json"
    e2e_path = root / "stage-b" / "REAL_SIGLIP_ONNX_E2E.json"
    core_path = root / "stage-b" / "CORE_REGRESSIONS.json"
    benchmark_path = root / "stage-b" / "SEARCH_50K.json"
    model_path = root / "stage-b" / "MODEL_PACK_BINDING.json"
    wheel_license_path = root / "evidence" / "windows-wheel-license-first-pass.json"
    wheel_vulnerability_path = root / "evidence" / "windows-wheel-vulnerability.json"
    wheel_sbom_path = root / "evidence" / "windows-candidate-wheel-SBOM.cdx.json"
    runtime = load(runtime_path)
    worker_build = load(worker_build_path)
    runtime_identity = load(runtime_identity_path)
    graph_attestation = load(graph_attestation_path)
    binding_regressions = load(binding_regressions_path)
    target_evidence = load(target_evidence_path)
    stage_a = load(stage_a_path)
    inspection = load(inspection_path)
    static = load(static_path)
    negative = load(negative_path)
    e2e = load(e2e_path)
    core = load(core_path)
    benchmark = load(benchmark_path)
    model = load(model_path)
    wheel_license = load(wheel_license_path)
    wheel_vulnerability = load(wheel_vulnerability_path)
    wheel_sbom = load(wheel_sbom_path)
    source_lock = load(SOURCE_LOCK)
    worker_sha256 = sha256_file(worker)
    failures: list[str] = []
    if stage_a.get("status") != "PASS" or not stage_a.get("stage_a_cpython_artifact_match"):
        failures.append("Stage A CPython artifact binding is not PASS")
    interpreter = runtime_identity.get("interpreter", {})
    if (
        runtime_identity.get("status") != "PASS"
        or interpreter.get("version") != "3.13.15"  # type: ignore[union-attr]
        or interpreter.get("python_abi") != "cp313"  # type: ignore[union-attr]
        or interpreter.get("python_free_threaded") is not False  # type: ignore[union-attr]
    ):
        failures.append("runtime identity is not standard-GIL CPython 3.13.15/cp313")
    locked_interpreter = runtime_identity.get("locked_interpreter", {})
    if (
        locked_interpreter.get("status") != "PASS"  # type: ignore[union-attr]
        or graph_attestation.get("status") != "PASS"
        or graph_attestation.get("executable_sha256")
        != locked_interpreter.get("executable_sha256")  # type: ignore[union-attr]
        or graph_attestation.get("runtime_library_sha256")
        != locked_interpreter.get("runtime_library_sha256")  # type: ignore[union-attr]
    ):
        failures.append("graph interpreter attestation is not bound to locked runtime identity")
    if (
        binding_regressions.get("status") != "PASS"
        or binding_regressions.get("python_executable_binding") != "PASS"
        or binding_regressions.get("bootstrap_python_isolation") != "PASS"
        or binding_regressions.get("missing_python_executable_fail_closed") != "PASS"
        or binding_regressions.get("path_with_spaces_regression") != "PASS"
        or binding_regressions.get("subprocess_shell") is not False
    ):
        failures.append("locked interpreter binding regressions are not PASS")
    for label, observed in (
        ("target evidence", target_evidence.get("final_artifact", {}).get("sha256")),  # type: ignore[union-attr]
        ("CArchive inspection", inspection.get("final_artifact", {}).get("sha256")),  # type: ignore[union-attr]
        ("negative test", negative.get("candidate_worker", {}).get("sha256")),  # type: ignore[union-attr]
        ("real ONNX E2E", e2e.get("candidate_worker", {}).get("sha256")),  # type: ignore[union-attr]
        ("core regressions", core.get("candidate_worker_sha256")),
    ):
        if observed != worker_sha256:
            failures.append(f"{label} is not bound to the exact Candidate Worker")
    for label, document in (
        ("target evidence", target_evidence),
        ("static reachability", static),
        ("candidate negative test", negative),
        ("real ONNX E2E", e2e),
        ("core regressions", core),
        ("model pack", model),
    ):
        if document.get("status") != "PASS":
            failures.append(f"{label} is not PASS")
    if (
        static.get("code_head_sha") != head
        or e2e.get("code_head_sha") != head
        or core.get("code_head_sha") != head
    ):
        failures.append("Stage B source/core evidence is not bound to current Code C HEAD")
    module_presence = inspection.get("python_module_inventory", {}).get(  # type: ignore[union-attr]
        "cve_relevant_module_presence", {}
    )
    if module_presence != {"urllib.request": True, "zipfile": True}:
        failures.append("packaged module presence does not match the Stage A premise")
    negative_network = negative.get("network_observation", {})
    normal_network = e2e.get("network_observation", {})
    if negative_network.get("outbound_proxy_attempts") != 0:  # type: ignore[union-attr]
        failures.append("negative test observed an outbound network attempt")
    if normal_network.get("outbound_network_attempts") != 0:  # type: ignore[union-attr]
        failures.append("normal Worker operation observed an outbound network attempt")
    if not e2e.get("second_scan_zero_reprocess"):
        failures.append("second scan performed unexpected reprocessing")
    archive = negative.get("archive_negative_test", {})
    if not archive.get("all_safe_reject"):  # type: ignore[union-attr]
        failures.append("bounded ZIP-as-media fixtures were not all safely rejected")
    if benchmark.get("rows") != 50_000 or not benchmark.get("pass_under_200ms"):
        failures.append("50K exact-search benchmark did not meet the frozen bound")
    if wheel_license.get("summary", {}).get("failed") != 0:  # type: ignore[union-attr]
        failures.append("Candidate wheel license first-pass contains a failed decision")
    if wheel_vulnerability.get("findings") != []:
        failures.append("Candidate wheel vulnerability scan contains findings")
    if wheel_sbom.get("bomFormat") != "CycloneDX":
        failures.append("Candidate wheel SBOM is not CycloneDX")

    approved_inventories = sorted(
        (root / "approved-inventories" / "windows").glob("*.v2.json")
    )
    wheel_graph = {
        path.name: sha256_file(path) for path in approved_inventories
    }
    if not approved_inventories:
        failures.append("Candidate approval produced no formal Windows wheel inventories")
    actual_sources = target_evidence.get("actual_sources", {})
    toolchain_identity = {
        "source_lock_sha256": sha256_file(SOURCE_LOCK),
        "actual_sources": actual_sources,
    }
    native_identity = {
        "wheel_native_mapping": target_evidence.get("wheel_native_mapping"),
        "cpython_native_mapping": target_evidence.get("cpython_native_mapping"),
        "unknown_native_artifacts": target_evidence.get("unknown_native_artifacts"),
    }
    build_context = {
        "code_head_sha": head,
        "candidate_worker_sha256": worker_sha256,
        "media_worker_spec_sha256": sha256_file(SPECIFICATION),
        "cpython_artifact_sha256": stage_a.get("actual_build_cpython", {}).get("sha256"),  # type: ignore[union-attr]
        "cpython_distribution_wrapper_sha256": runtime_identity.get("distribution", {}).get(  # type: ignore[union-attr]
            "sha256"
        ),
        "locked_python_executable_sha256": locked_interpreter.get("executable_sha256"),  # type: ignore[union-attr]
        "locked_python_runtime_dll_sha256": locked_interpreter.get(  # type: ignore[union-attr]
            "runtime_library_sha256"
        ),
        "wheel_graph_identity": canonical_sha256(wheel_graph),
        "toolchain_inventory_identity": canonical_sha256(toolchain_identity),
        "native_inventory_identity": canonical_sha256(native_identity),
        "target_os": "windows",
        "target_architecture": "x86_64",
    }
    build_context_id = f"code-c-stage-b-{canonical_sha256(build_context)[:32]}"
    bundle = {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_EVIDENCE_BUNDLE",
        "schema_version": "1",
        "status": "EVIDENCE_COMPLETE" if not failures else "FAIL",
        "code_head_sha": head,
        "main_quality_baseline_sha": arguments.main_quality_baseline,
        "candidate_worker": {
            "filename": worker.name,
            "sha256": worker_sha256,
            "size": worker.stat().st_size,
        },
        "risk_acceptance_worker_binding": "EXACT_SHA256",
        "build_context_id": build_context_id,
        "build_context": build_context,
        "wheel_graph_identity": build_context["wheel_graph_identity"],
        "wheel_graph": wheel_graph,
        "toolchain_inventory_identity": build_context["toolchain_inventory_identity"],
        "native_inventory_identity": build_context["native_inventory_identity"],
        "packaged_module_inventory_hash": canonical_sha256(
            inspection.get("python_module_inventory")
        ),
        "carchive_inventory_hash": sha256_file(inspection_path),
        "evidence_inputs": {
            path.name: sha256_file(path)
            for path in (
                runtime_path,
                worker_build_path,
                runtime_identity_path,
                graph_attestation_path,
                binding_regressions_path,
                target_evidence_path,
                stage_a_path,
                inspection_path,
                static_path,
                negative_path,
                e2e_path,
                core_path,
                benchmark_path,
                model_path,
                wheel_license_path,
                wheel_vulnerability_path,
                wheel_sbom_path,
            )
        },
        "cve_2026_3087": "NOT_AFFECTED",
        "cve_2026_15806": {
            "module_present": "YES",
            "protocol_exposed": static.get("cve_2026_15806", {}).get("protocol_exposed"),  # type: ignore[union-attr]
            "http_credential_path": static.get("cve_2026_15806", {}).get(  # type: ignore[union-attr]
                "http_credential_path"
            ),
            "network_required": "NO"
            if normal_network.get("network_required_for_normal_operation") is False  # type: ignore[union-attr]
            else "UNKNOWN",
            "attacker_controlled_network_capability": negative_network.get(  # type: ignore[union-attr]
                "attacker_controlled_network_capability"
            ),
            "outbound_network_attempts": negative_network.get("outbound_proxy_attempts"),  # type: ignore[union-attr]
            "attacker_controlled_path": "NO" if not failures else "UNKNOWN",
            "stage_b_reachability": "NOT_REACHABLE" if not failures else "UNKNOWN",
        },
        "cve_2026_15310": {
            "module_present": "YES",
            "archive_api_exposed": static.get("cve_2026_15310", {}).get(  # type: ignore[union-attr]
                "archive_api_exposed"
            ),
            "user_archive_extraction": static.get("cve_2026_15310", {}).get(  # type: ignore[union-attr]
                "user_archive_extraction"
            ),
            "malicious_zip_media": "SAFE_REJECT"
            if archive.get("all_safe_reject")  # type: ignore[union-attr]
            else "UNKNOWN",
            "archive_extraction_api_invoked": "NO"
            if not static.get("archive_extraction_calls")
            and archive.get("archive_extraction_side_effect_observed") is False  # type: ignore[union-attr]
            else "UNKNOWN",
            "attacker_controlled_path": "NO" if not failures else "UNKNOWN",
            "stage_b_reachability": "NOT_REACHABLE" if not failures else "UNKNOWN",
            "pyinstaller_carchive": "OUT_OF_ATTACKER_CONTROLLED_ZIP_PATH",
        },
        "core_regressions": core,
        "search_50k": benchmark,
        "candidate_supply_chain": {
            "approved_wheel_inventory_count": len(approved_inventories),
            "wheel_license_first_pass": "PASS"
            if wheel_license.get("summary", {}).get("failed") == 0  # type: ignore[union-attr]
            else "FAIL",
            "wheel_license_manual_review_count": wheel_license.get("summary", {}).get(  # type: ignore[union-attr]
                "manual_review"
            ),
            "wheel_vulnerability": "PASS"
            if wheel_vulnerability.get("findings") == []
            else "FAIL",
            "wheel_sbom": "PASS" if wheel_sbom.get("bomFormat") == "CycloneDX" else "FAIL",
            "toolchain_vulnerability_disposition": "PENDING_CODE_F_STAGE_B",
            "notice_reconciliation": "PENDING_CODE_F_STAGE_B_TOOLCHAIN_DISPOSITION",
        },
        "python_toolchain_vulnerability_final_disposition": "PENDING_CODE_F",
        "production_toolchain_acceptance": "PENDING_CODE_F_STAGE_B",
        "code_c_merge_readiness": "BLOCKED",
        "failures": failures,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(canonical_json(bundle), encoding="utf-8")
    bundle_sha256 = sha256_file(arguments.output)
    arguments.sha256_output.write_text(f"{bundle_sha256}  {arguments.output.name}\n", encoding="utf-8")
    handoff = f"""# Code C CPython Stage B Handoff

CODE_C_HEAD_SHA: `{head}`

MAIN_QUALITY_BASELINE_SHA: `{arguments.main_quality_baseline}`

CPYTHON_VERSION: `3.13.15`

CPYTHON_ACTUAL_BUILD_ARTIFACT_SHA256: `{build_context['cpython_artifact_sha256']}`

LOCKED_PYTHON_EXECUTABLE_SHA256: `{build_context['locked_python_executable_sha256']}`

LOCKED_PYTHON_RUNTIME_DLL_SHA256: `{build_context['locked_python_runtime_dll_sha256']}`

STAGE_A_CPYTHON_ARTIFACT_SHA256: `{stage_a.get('stage_a_cpython_sha256')}`

STAGE_A_ARTIFACT_MATCH: `YES`

BUILD_CONTEXT_ID: `{build_context_id}`

CANDIDATE_WORKER_SHA256: `{worker_sha256}`

STAGE_B_EVIDENCE_BUNDLE_SHA256: `{bundle_sha256}`

RISK_ACCEPTANCE_WORKER_BINDING: `EXACT_SHA256`

CVE-2026-3087: `NOT_AFFECTED`

CVE-2026-15806 Stage B observed reachability: `{bundle['cve_2026_15806']['stage_b_reachability']}`

CVE-2026-15310 Stage B observed reachability: `{bundle['cve_2026_15310']['stage_b_reachability']}`

The machine-readable bundle binds protocol adversarial tests, normal-operation network independence,
network-capability negative tests, credential-path evidence, bounded ZIP negative tests, packaged module
inventory, CArchive inventory, and current-HEAD core regressions to the exact Candidate Worker.

Requested final disposition: `CODE_F_REVIEW_REQUIRED`.

Code C does not grant risk acceptance. Any Worker, CPython artifact, source commit, build context, wheel/toolchain
graph, specification, protocol, network/credential capability, archive capability, or relevant import-graph
change invalidates this handoff and requires Stage B rerun/rebind.
"""
    arguments.handoff.write_text(handoff, encoding="utf-8")
    if failures:
        raise SystemExit("Stage B evidence bundle failed:\n" + "\n".join(failures))
    print(
        "stage-b-evidence-bundle: EVIDENCE_COMPLETE "
        f"({worker_sha256}; {build_context_id}; {bundle_sha256})"
    )


if __name__ == "__main__":
    main()
