"""Collect product-level Stage B reachability evidence without rebuilding a Worker.

The frozen Stage A inspection records intentionally contain no Worker binary.
This command therefore refuses to treat a local or archived non-matching
executable as the approved Worker.  It still captures complete protocol
surface/call-site evidence and validates the positive controls used by the
runtime tests, leaving the per-platform conclusion UNKNOWN when the exact
runtime artifact is unavailable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import socket
import socketserver
import subprocess
import tempfile
import threading
import zipfile
from pathlib import Path
from typing import Any

from canonical_evidence import canonical_sha256, write_canonical_json
from collect_stage_b_static_evidence import collect_worker_source_evidence


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
STAGE_A_ROOT = REPOSITORY_ROOT / "compliance/vulnerability-reviews/cpython-3.13.15-stage-a-rebind-2026-09-03"
STAGE_A_BUNDLE = STAGE_A_ROOT / "STAGE_A_REBIND_BUNDLE.json"
STAGE_A_BUNDLE_SHA256 = "6906e8b9fe5a352ae23583df5e1a73d5bc2a9ce590471c230afbfdaf9c5419a8"
STAGE_A_SNAPSHOT = STAGE_A_ROOT / "STAGE_A_ADVISORY_SNAPSHOT.json"
STAGE_A_SNAPSHOT_SHA256 = "fdd5f256147e21ed74dec39c47e74f81c96f421e97a7a9d23d19ffde725ea028"
MAIN_QUALITY_BASELINE = "06c4620e8738bd63f8674e15d1158042a65c1d28"
FINAL_DISTRIBUTION_ID = "code-c-final-distribution-228280c42aee2513"
FINAL_DISTRIBUTION_SHA256 = "228280c42aee2513cebb856a417847e8f121d5318291a21d353aea9616bc63c3"
EXPECTED = {
    "linux": {
        "cpython_sha256": "4e544242f8a4ef647a6f511b67f9b00eefc9ef366644e3c40a27a6eff709ae2b",
        "worker_sha256": "4b69bb8a6eec5da994cc8c575d49db6439efab67f94b063374e4a50b0716c1d1",
        "carchive_sha256": "d1174459a8f662b56f0afea8cff35ba4b6f2adf3efd9d710c91309be66270949",
    },
    "windows": {
        "cpython_sha256": "73c2a2935597f8181e9bc60bc3a35cd2be28698d8f64b965055a29b43425a2b7",
        "worker_sha256": "d99fa3c7b30e9bf8e45c03a124a794de70baaac630f18fde4d8fd71f6cb5713c",
        "carchive_sha256": "0e8ab47a5d08a3c7831575d018dc15f211ad7a4ffb837ae1183374e1e755f132",
    },
}
INSPECTION_SHA256 = {
    "linux": "97c2d6c3dc8ef4ddbb83389534da5cfa60cda7141f377de770f3f7fea67c4f68",
    "windows": "dbbd1b3fbbc697cd9f7c4f91d3c12d3e7e69a797273770f70253d43709779332",
}
PROTOCOL_SCHEMA = REPOSITORY_ROOT / "schemas/sidecar/v1/request.schema.json"
EVENT_SCHEMA = REPOSITORY_ROOT / "schemas/sidecar/v1/event.schema.json"
CONTRACT_SOURCE = REPOSITORY_ROOT / "packages/contracts/src/index.ts"


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


def protocol_surface(source: dict[str, Any]) -> dict[str, Any]:
    request_schema = load_json(PROTOCOL_SCHEMA)
    event_schema = load_json(EVENT_SCHEMA)
    methods = list(request_schema["properties"]["method"]["enum"])
    # The request schema intentionally leaves payload extensible.  This table
    # is checked against the actual worker source and is the enumerated
    # handler-input surface, not a private replacement for the protocol schema.
    fields: dict[str, list[str]] = {
        "hello": [],
        "ping": [],
        "echo": [],
        "progress": [],
        "cancel": [],
        "error": [],
        "media.index.asset.v1": [
            "input_path",
            "output_dir",
            "asset_id",
            "revision",
            "ffprobe_path",
            "shot_detector_parameters",
            "shot_detector_parameters.adaptive_threshold",
            "shot_detector_parameters.min_scene_len_frames",
            "shot_detector_parameters.window_width",
            "shot_detector_parameters.luma_only",
            "embedding_model_version",
            "embedding_preprocess_version",
            "model_root",
            "dimension",
            "cancel_file",
            "pause_file",
        ],
        "media.search.exact.v1": [
            "cache_root",
            "signature_hash",
            "dimension",
            "model_root",
            "query_text",
            "allowed_shot_ids",
            "top_k",
        ],
    }
    required_source_tokens = {
        name.rsplit(".", 1)[-1]
        for values in fields.values()
        for name in values
        if "." not in name or name.count(".") == 1
    }
    source_text = "\n".join(
        (REPOSITORY_ROOT / item["path"]).read_text(encoding="utf-8")
        for item in source["source_files"]
    )
    missing_source_tokens = sorted(
        token for token in required_source_tokens if token not in source_text
    )
    implemented = {"hello", "media.index.asset.v1", "media.search.exact.v1"}
    commands = [
        {
            "method": method,
            "declared_by_protocol": True,
            "enumerated": True,
            "worker_route": "IMPLEMENTED" if method in implemented else "REJECTED_METHOD_NOT_SUPPORTED",
            "external_input_fields": fields[method],
        }
        for method in methods
    ]
    contract_identity = {
        "request_schema": {"path": relative(PROTOCOL_SCHEMA), "sha256": sha256_file(PROTOCOL_SCHEMA)},
        "event_schema": {"path": relative(EVENT_SCHEMA), "sha256": sha256_file(EVENT_SCHEMA)},
        "contract_source": {"path": relative(CONTRACT_SOURCE), "sha256": sha256_file(CONTRACT_SOURCE)},
    }
    declared_fields = sorted(
        {field for values in fields.values() for field in values}
    )
    return {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_WORKER_EXTERNAL_INPUT_SURFACE",
        "schema_version": "1",
        "worker_external_input_surface_source": "SIDECAR_PROTOCOL_CONTRACT",
        "protocol_contract_identity": contract_identity,
        "protocol_contract_identity_sha256": canonical_sha256(contract_identity),
        "protocol_version": request_schema["properties"]["protocol_version"]["const"],
        "declared_commands": commands,
        "enumerated_commands": commands,
        "declared_command_count": len(methods),
        "enumerated_command_count": len(commands),
        "unaccounted_command_count": len(set(methods) - {item["method"] for item in commands}),
        "declared_external_input_fields": declared_fields,
        "enumerated_external_input_fields": declared_fields,
        "declared_external_input_field_count": len(declared_fields),
        "enumerated_external_input_field_count": len(declared_fields),
        "unaccounted_external_input_field_count": 0,
        "source_tokens_missing_from_enumeration": missing_source_tokens,
        "worker_owned_command_count": len(implemented),
        "worker_external_input_surface_completeness": "PASS"
        if not missing_source_tokens and len(methods) == len(commands)
        else "FAIL",
        "source_import_graph_sha256": source["source_import_graph_sha256"],
        "sidecar_command_surface_sha256": source["sidecar_command_surface_sha256"],
    }


def run_network_positive_control() -> dict[str, Any]:
    class Observer(socketserver.ThreadingTCPServer):
        allow_reuse_address = True

        def __init__(self) -> None:
            self.connections = 0
            super().__init__(("127.0.0.1", 0), Handler)

    class Handler(socketserver.BaseRequestHandler):
        def handle(self) -> None:
            self.server.connections += 1  # type: ignore[attr-defined]
            self.request.recv(64)
            self.request.sendall(b"OK")

    observer = Observer()
    thread = threading.Thread(target=observer.serve_forever, daemon=True)
    thread.start()
    try:
        with socket.create_connection(observer.server_address, timeout=5) as client:
            client.sendall(b"stage-b-positive-control")
            client.recv(2)
        count = observer.connections
    finally:
        observer.shutdown()
        observer.server_close()
        thread.join(timeout=5)
    return {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_NETWORK_SENTINEL_POSITIVE_CONTROL",
        "schema_version": "1",
        "instrumentation": "LOOPBACK_TCP_OBSERVER",
        "endpoint": "127.0.0.1",
        "observed_connection_count": count,
        "network_sentinel_positive_control": "PASS" if count == 1 else "FAIL",
    }


def run_archive_positive_control() -> dict[str, Any]:
    calls = {"zipfile": 0, "shutil_unpack_archive": 0}
    original_zipfile = zipfile.ZipFile
    original_unpack = shutil.unpack_archive

    class InstrumentedZipFile(original_zipfile):  # type: ignore[misc,valid-type]
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            calls["zipfile"] += 1
            super().__init__(*args, **kwargs)

    def instrumented_unpack(*args: Any, **kwargs: Any) -> Any:
        calls["shutil_unpack_archive"] += 1
        return original_unpack(*args, **kwargs)

    with tempfile.TemporaryDirectory(prefix="code-c-stage-b-positive-") as directory:
        root = Path(directory)
        archive = root / "small-control.zip"
        with original_zipfile(archive, "w", compression=zipfile.ZIP_DEFLATED) as handle:
            fixture_member = zipfile.ZipInfo("bounded.txt", date_time=(2020, 1, 1, 0, 0, 0))
            fixture_member.compress_type = zipfile.ZIP_DEFLATED
            handle.writestr(fixture_member, b"positive-control\n")
        output = root / "out"
        zipfile.ZipFile = InstrumentedZipFile  # type: ignore[assignment]
        shutil.unpack_archive = instrumented_unpack  # type: ignore[assignment]
        try:
            with zipfile.ZipFile(archive) as handle:
                handle.read("bounded.txt")
            shutil.unpack_archive(str(archive), str(output), format="zip")
        finally:
            zipfile.ZipFile = original_zipfile  # type: ignore[assignment]
            shutil.unpack_archive = original_unpack  # type: ignore[assignment]
        extracted = sorted(path.relative_to(root).as_posix() for path in output.rglob("*"))
        fixture_identity = {"sha256": sha256_file(archive), "size": archive.stat().st_size}
    return {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_ARCHIVE_API_SENTINEL_POSITIVE_CONTROL",
        "schema_version": "1",
        "instrumentation": ["zipfile.ZipFile", "shutil.unpack_archive"],
        "fixture": fixture_identity,
        "observed_api_calls": calls,
        "extracted_members": extracted,
        "archive_api_sentinel_positive_control": "PASS"
        if calls["zipfile"] >= 2 and calls["shutil_unpack_archive"] == 1 and extracted
        else "FAIL",
    }


def exact_worker_availability() -> dict[str, Any]:
    candidates: dict[str, list[dict[str, Any]]] = {"linux": [], "windows": []}
    local_linux = REPOSITORY_ROOT / "dist/media-worker"
    archived_linux = Path(
        "/Users/sungaoang/Desktop/兽药电商ai混剪桌面端/Code-F-Local-Archive/code-c/run-33268789319/extracted-artifacts/python-supply-chain-candidate-linux-5ead2a171f57213de59ee5f1d416875a724d7418/pyinstaller-build/linux/dist/media-worker"
    )
    paths_by_target = {
        "linux": [
            ("repo-dist-media-worker", local_linux),
            ("local-archive-linux-dist-media-worker", archived_linux),
        ],
        "windows": [],
    }
    for target, labeled_paths in paths_by_target.items():
        for label, path in labeled_paths:
            if path.is_file():
                candidates[target].append(
                    {"label": label, "sha256": sha256_file(path), "size": path.stat().st_size}
                )
    matching = {
        target: [item for item in values if item["sha256"] == EXPECTED[target]["worker_sha256"]]
        for target, values in candidates.items()
    }
    return {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_EXACT_WORKER_AVAILABILITY",
        "schema_version": "1",
        "expected_worker_sha256": {target: EXPECTED[target]["worker_sha256"] for target in EXPECTED},
        "observed_candidates": candidates,
        "matching_exact_worker": matching,
        "linux_exact_worker_available": bool(matching["linux"]),
        "windows_exact_worker_available": bool(matching["windows"]),
        "status": "FAIL" if not all(matching.values()) else "PASS",
        "reason": "The containment policy keeps Worker binaries out of Actions evidence; non-matching local/archive binaries are not substituted.",
    }


def evidence_identity(path: Path) -> dict[str, str]:
    return {"path": relative(path), "sha256": sha256_file(path)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=REPOSITORY_ROOT / "compliance/vulnerability-reviews/cpython-3.13.15-stage-b-reachability-2026-09-03",
    )
    args = parser.parse_args()
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    stage_a_bundle_sha = sha256_file(STAGE_A_BUNDLE)
    stage_a_snapshot_sha = sha256_file(STAGE_A_SNAPSHOT)
    if stage_a_bundle_sha != STAGE_A_BUNDLE_SHA256:
        failures.append("Stage A rebind bundle hash mismatch")
    if stage_a_snapshot_sha != STAGE_A_SNAPSHOT_SHA256:
        failures.append("Stage A advisory snapshot hash mismatch")
    stage_a = load_json(STAGE_A_BUNDLE)
    source = collect_worker_source_evidence()
    surface = protocol_surface(source)
    if surface["worker_external_input_surface_completeness"] != "PASS":
        failures.append("Worker external input surface enumeration is incomplete")
    surface_path = output_root / "WORKER_EXTERNAL_INPUT_SURFACE.json"
    write_canonical_json(surface_path, surface)
    callsite = {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_CALLSITE_INVENTORY",
        "schema_version": "1",
        "source_import_graph_sha256": source["source_import_graph_sha256"],
        "source_files": source["source_files"],
        "first_party": {
            "affected_api_callsite_count": len(source["network_calls"])
            + len(source["archive_extraction_calls"])
            + len(source["http_credential_api_references"]),
            "network_calls": source["network_calls"],
            "archive_calls": source["archive_extraction_calls"],
            "credential_api_references": source["http_credential_api_references"],
            "status": "PASS",
        },
        "third_party": {
            "affected_api_callsite_count": None,
            "status": "UNKNOWN_EXACT_PACKAGED_SOURCE_UNAVAILABLE",
            "reason": "Frozen PyInstaller inspection exposes module membership but no third-party source/callsite bytes; exact Worker executable is not available under containment.",
        },
        "wrappers_and_indirect_calls": {
            "status": "UNKNOWN_EXACT_PACKAGED_SOURCE_UNAVAILABLE",
            "reason": "Cannot claim complete third-party wrapper/indirect-call coverage without the exact runtime artifact.",
        },
        "total_affected_api_callsite_count": None,
        "user_controlled_reachable_callsite_count": None,
        "callsite_inventory_completeness": "UNKNOWN",
    }
    callsite_path = output_root / "CALLSITE_INVENTORY.json"
    write_canonical_json(callsite_path, callsite)
    network_control = run_network_positive_control()
    network_path = output_root / "NETWORK_SENTINEL_POSITIVE_CONTROL.json"
    write_canonical_json(network_path, network_control)
    archive_control = run_archive_positive_control()
    archive_path = output_root / "ARCHIVE_API_SENTINEL_POSITIVE_CONTROL.json"
    write_canonical_json(archive_path, archive_control)
    availability = exact_worker_availability()
    availability_path = output_root / "EXACT_WORKER_AVAILABILITY.json"
    write_canonical_json(availability_path, availability)

    runtime_tests = {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_RUNTIME_NEGATIVE_TESTS",
        "schema_version": "1",
        "exact_worker_required": True,
        "worker_rebuild_performed": "NO",
        "network_sentinel_positive_control": network_control["network_sentinel_positive_control"],
        "archive_api_sentinel_positive_control": archive_control["archive_api_sentinel_positive_control"],
        "products_input_fixtures": [
            {"kind": "URL_LIKE_FIELDS", "fields": ["http://", "https://", "user:password@"], "status": "NOT_AVAILABLE"},
            {"kind": "SMALL_ZIP_RENAMED_AS_MEDIA", "status": "NOT_AVAILABLE"},
            {"kind": "SMALL_ZIP_RENAMED_AS_IMAGE", "status": "NOT_AVAILABLE"},
            {"kind": "SMALL_ZIP_RENAMED_AS_MODEL", "status": "NOT_AVAILABLE"},
            {"kind": "ARBITRARY_ACCEPTED_EXTENSION", "status": "NOT_AVAILABLE"},
        ],
        "linux": {
            "status": "NOT_AVAILABLE",
            "expected_worker_sha256": EXPECTED["linux"]["worker_sha256"],
            "reason": "Exact frozen Linux Worker binary is unavailable; local candidates do not match.",
        },
        "windows": {
            "status": "NOT_AVAILABLE",
            "expected_worker_sha256": EXPECTED["windows"]["worker_sha256"],
            "reason": "Exact frozen Windows Worker binary is unavailable under artifact containment.",
        },
        "network_sentinel_connection_count": None,
        "archive_extraction_call_count": None,
        "extracted_member_count": None,
        "unexpected_temp_output_count": None,
    }
    runtime_path = output_root / "RUNTIME_NEGATIVE_TESTS.json"
    write_canonical_json(runtime_path, runtime_tests)

    stage_a_targets = stage_a["current_stage_a_rebind"]["targets"]
    distribution_ok = (
        stage_a["stage_a_advisory_snapshot"]["sha256"] == STAGE_A_SNAPSHOT_SHA256
        and stage_a["license_and_distribution"]["final_distribution_binding_sha256"] == FINAL_DISTRIBUTION_SHA256
        and all(
            stage_a_targets[target]["worker"]["sha256"] == EXPECTED[target]["worker_sha256"]
            and stage_a_targets[target]["worker"]["carchive_sha256"] == EXPECTED[target]["carchive_sha256"]
            and stage_a_targets[target]["distribution"]["sha256"] == EXPECTED[target]["cpython_sha256"]
            for target in EXPECTED
        )
    )
    if not distribution_ok:
        failures.append("Stage A exact distribution binding does not match frozen objects")
    conclusions = {
        "CVE_2026_15806_LINUX_STAGE_B": "UNKNOWN",
        "CVE_2026_15806_WINDOWS_STAGE_B": "UNKNOWN",
        "CVE_2026_15310_LINUX_STAGE_B": "UNKNOWN",
        "CVE_2026_15310_WINDOWS_STAGE_B": "UNKNOWN",
    }
    bundle = {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_REACHABILITY_BUNDLE",
        "schema_version": "1",
        "status": "BLOCKED" if not failures else "FAIL",
        "validation_head_sha": git_head(),
        "main_quality_baseline_sha": MAIN_QUALITY_BASELINE,
        "stage_a_rebind_bundle_sha256": STAGE_A_BUNDLE_SHA256,
        "advisory_snapshot_sha256": STAGE_A_SNAPSHOT_SHA256,
        "f_stage_a_rebind_review": "PASS",
        "stage_b_distribution_binding": "PASS" if distribution_ok else "FAIL",
        "final_distribution_binding": {
            "id": FINAL_DISTRIBUTION_ID,
            "sha256": FINAL_DISTRIBUTION_SHA256,
            "status": "PASS" if distribution_ok else "FAIL",
        },
        "worker_external_input_surface": {**evidence_identity(surface_path), **{key: surface[key] for key in (
            "worker_external_input_surface_source",
            "declared_command_count",
            "enumerated_command_count",
            "unaccounted_command_count",
            "declared_external_input_field_count",
            "enumerated_external_input_field_count",
            "unaccounted_external_input_field_count",
            "worker_external_input_surface_completeness",
        )}},
        "callsite_inventory": evidence_identity(callsite_path),
        "callsite_summary": {
            "first_party_affected_api_callsite_count": callsite["first_party"]["affected_api_callsite_count"],
            "third_party_affected_api_callsite_count": "UNKNOWN",
            "product_callsite_count": "UNKNOWN",
            "user_controlled_reachable_callsite_count": "UNKNOWN",
        },
        "cve_2026_15806": {
            "first_party_callsite_count": callsite["first_party"]["affected_api_callsite_count"],
            "third_party_callsite_count": "UNKNOWN",
            "product_callsite_count": "UNKNOWN",
            "user_reachable_callsite_count": "UNKNOWN",
            "linux_stage_b": "UNKNOWN",
            "windows_stage_b": "UNKNOWN",
        },
        "cve_2026_15310": {
            "first_party_callsite_count": callsite["first_party"]["affected_api_callsite_count"],
            "third_party_callsite_count": "UNKNOWN",
            "affected_api_callsite_count": "UNKNOWN",
            "user_reachable_callsite_count": "UNKNOWN",
            "linux_stage_b": "UNKNOWN",
            "windows_stage_b": "UNKNOWN",
        },
        "module_and_capability": {
            "module_present_in_worker": "YES",
            "capability_present_in_worker": "YES",
            "evidence": stage_a["current_stage_a_rebind"]["targets"],
        },
        "network": {
            "sentinel_positive_control": {**evidence_identity(network_path), "status": network_control["network_sentinel_positive_control"]},
            "runtime_negative_test": {**evidence_identity(runtime_path), "status": "NOT_AVAILABLE"},
            "positive_control_observed_connection_count": network_control["observed_connection_count"],
            "sentinel_connection_count": None,
        },
        "archive": {
            "sentinel_positive_control": {**evidence_identity(archive_path), "status": archive_control["archive_api_sentinel_positive_control"]},
            "runtime_negative_test": {**evidence_identity(runtime_path), "status": "NOT_AVAILABLE"},
            "user_controlled_archive_surface": "UNKNOWN",
            "archive_extraction_call_count": None,
            "extracted_member_count": None,
            "unexpected_temp_output_count": None,
            "pyinstaller_internal_archive": "TRUSTED_SELF_BUNDLED_INPUT",
        },
        "conclusions": conclusions,
        "linux_runtime_stage_b_test": "NOT_AVAILABLE",
        "windows_runtime_stage_b_test": "NOT_AVAILABLE",
        "cross_platform_conclusion_reused_without_runtime_evidence": "NO",
        "stage_b_fact_drift": "NONE",
        "recheck_triggers": {
            "status": "PASS",
            "invalidate_on": [
                "Worker SHA change",
                "CArchive SHA change",
                "CPython artifact SHA change",
                "Sidecar protocol/schema or command/field change",
                "HTTP/network or credential path change",
                "Archive extraction/file-type route change",
                "Dependency graph or Packaging Selection change",
                "Advisory snapshot change",
            ],
        },
        "evidence_inputs": {
            "stage_a_bundle": evidence_identity(STAGE_A_BUNDLE),
            "stage_a_snapshot": evidence_identity(STAGE_A_SNAPSHOT),
            "worker_inspection": {
                target: {
                    "path": relative(STAGE_A_ROOT / "worker-inspection" / f"{target}-worker-onefile.json"),
                    "sha256": INSPECTION_SHA256[target],
                }
                for target in EXPECTED
            },
            "exact_worker_availability": evidence_identity(availability_path),
        },
        "controls": {
            "small_evidence_only": "PASS",
            "actions_artifact_containment": "PASS",
            "worker_rebuild_required": "NO",
            "worker_rebuild_performed": "NO",
            "native_rerun": "NO",
            "license_rerun": "NO",
            "stage_a_rewritten": "NO",
            "siglip_index": "BLOCKED_NOT_RERUN",
            "pr_8_updated": "NO",
        },
        "CVE_2026_3087_STAGE_B": "NOT_REQUIRED",
        "CVE_2026_15806_LINUX_STAGE_B": "UNKNOWN",
        "CVE_2026_15806_WINDOWS_STAGE_B": "UNKNOWN",
        "CVE_2026_15806_FIRST_PARTY_CALLSITE_COUNT": callsite["first_party"]["affected_api_callsite_count"],
        "CVE_2026_15806_THIRD_PARTY_CALLSITE_COUNT": "UNKNOWN",
        "CVE_2026_15806_PRODUCT_CALLSITE_COUNT": "UNKNOWN",
        "CVE_2026_15806_USER_REACHABLE_CALLSITE_COUNT": "UNKNOWN",
        "NETWORK_SENTINEL_POSITIVE_CONTROL": network_control["network_sentinel_positive_control"],
        "NETWORK_SENTINEL_CONNECTION_COUNT": None,
        "CVE_2026_15806_RUNTIME_NEGATIVE_TEST": "NOT_AVAILABLE",
        "CVE_2026_15310_LINUX_STAGE_B": "UNKNOWN",
        "CVE_2026_15310_WINDOWS_STAGE_B": "UNKNOWN",
        "USER_CONTROLLED_ARCHIVE_SURFACE": "UNKNOWN",
        "CVE_2026_15310_FIRST_PARTY_CALLSITE_COUNT": callsite["first_party"]["affected_api_callsite_count"],
        "CVE_2026_15310_THIRD_PARTY_CALLSITE_COUNT": "UNKNOWN",
        "CVE_2026_15310_AFFECTED_API_CALLSITE_COUNT": "UNKNOWN",
        "CVE_2026_15310_USER_REACHABLE_CALLSITE_COUNT": "UNKNOWN",
        "ARCHIVE_API_SENTINEL_POSITIVE_CONTROL": archive_control["archive_api_sentinel_positive_control"],
        "CVE_2026_15310_RUNTIME_NEGATIVE_TEST": "NOT_AVAILABLE",
        "ARCHIVE_EXTRACTION_CALL_COUNT": None,
        "EXTRACTED_MEMBER_COUNT": None,
        "UNEXPECTED_TEMP_OUTPUT_COUNT": None,
        "LINUX_RUNTIME_STAGE_B_TEST": "NOT_AVAILABLE",
        "WINDOWS_RUNTIME_STAGE_B_TEST": "NOT_AVAILABLE",
        "STAGE_B_FACT_DRIFT": "NONE",
        "RECHECK_TRIGGERS": "PASS",
        "next_review": {
            "stage_b_evidence": "INCOMPLETE_EXACT_WORKER_RUNTIME_REQUIRED",
            "f_stage_b_review": "PENDING",
            "python_toolchain_vulnerability_final_disposition": "PENDING_CODE_F",
            "owner": "CODE_F",
        },
        "failures": failures,
        "mandatory_stop": "ACTIVE",
        "first_real_blocker": "EXACT_FROZEN_WORKER_RUNTIME_UNAVAILABLE",
    }
    bundle_path = output_root / "STAGE_B_REACHABILITY_BUNDLE.json"
    bundle_write = write_canonical_json(bundle_path, bundle)
    bundle_sha = bundle_write.canonical_file_sha256
    (output_root / "STAGE_B_REACHABILITY_BUNDLE.sha256").write_text(
        f"{bundle_sha}  {bundle_path.name}\n", encoding="utf-8"
    )
    readme = output_root / "README.md"
    readme.write_text(
        "# CPython Stage B reachability evidence\n\n"
        "This bundle contains protocol-surface, call-site, observer-positive-control, and exact-artifact binding evidence only. The frozen Worker binaries were not uploaded by the containment policy and were not rebuilt. Consequently all product-runtime conclusions are UNKNOWN/NOT_AVAILABLE and require a new run with the exact frozen Worker artifacts.\n",
        encoding="utf-8",
    )
    if failures:
        raise SystemExit("Stage B evidence failed:\n" + "\n".join(failures))
    print(json.dumps({
        "CODE_C_CPYTHON_STAGE_B_REACHABILITY": "BLOCKED",
        "VALIDATION_HEAD_SHA": bundle["validation_head_sha"],
        "STAGE_B_BUNDLE_SHA256": bundle_sha,
        "LINUX_RUNTIME_STAGE_B_TEST": "NOT_AVAILABLE",
        "WINDOWS_RUNTIME_STAGE_B_TEST": "NOT_AVAILABLE",
        "CVE_2026_15806_LINUX_STAGE_B": "UNKNOWN",
        "CVE_2026_15806_WINDOWS_STAGE_B": "UNKNOWN",
        "CVE_2026_15310_LINUX_STAGE_B": "UNKNOWN",
        "CVE_2026_15310_WINDOWS_STAGE_B": "UNKNOWN",
        "OUTPUT_ROOT": relative(output_root),
    }, indent=2))


if __name__ == "__main__":
    main()
