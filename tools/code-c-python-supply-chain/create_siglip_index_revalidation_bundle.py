from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any

from canonical_evidence import write_canonical_json


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MAIN_QUALITY_BASELINE = "d4d6793363aeef3a48147e135d2188f04ec6dd09"
FINAL_VULNERABILITY_RECORD = (
    REPOSITORY_ROOT
    / "compliance"
    / "vulnerability-reviews"
    / "cpython-3.13.15-final-vulnerability-review-current-candidate"
    / "FINAL_VULNERABILITY_REVIEW_RECORD_V2.json"
)
FINAL_VULNERABILITY_RECORD_SHA = (
    "5a3ce03bf73164df9e5b931edca18632e641b228820b939e8bc2afe9732fb35f"
)
GOLDEN_GOVERNANCE = REPOSITORY_ROOT / "docs" / "quality" / "GOLDEN_SET_GOVERNANCE.md"
COMPLETION_REPORT = REPOSITORY_ROOT / "CODE_C_COMPLETION_REPORT.md"
MODEL_MANIFEST = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "model-manifests"
    / "siglip2-base-patch32-256.onnx-fp32.manifest.json"
)
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


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def require(value: bool, message: str) -> None:
    if not value:
        raise SystemExit(message)


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
    parser.add_argument("--linux-evidence", type=Path, required=True)
    parser.add_argument("--windows-evidence", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    args = parser.parse_args()

    evidence: dict[str, dict[str, Any]] = {
        "linux": load_json(args.linux_evidence.resolve(strict=True)),
        "windows": load_json(args.windows_evidence.resolve(strict=True)),
    }
    for target, item in evidence.items():
        expected = EXPECTED[target]
        require(item.get("status") == "PASS", f"{target} functional revalidation did not PASS")
        candidate = item.get("candidate", {})
        require(candidate.get("worker_sha256") == expected["worker_sha256"], f"{target} Worker binding drift")
        require(candidate.get("carchive_sha256") == expected["carchive_sha256"], f"{target} CArchive binding drift")
        require(candidate.get("transfer_role") == "TRANSPORT_ONLY", f"{target} transfer role drift")
        require(candidate.get("stage_b_authority_depends_on_transient_artifact") == "NO", f"{target} Stage B authority drift")
        require(candidate.get("final_distribution_binding", {}).get("id") == "code-c-final-distribution-6cd09589d42329c7", f"{target} final distribution binding drift")
        require(item.get("model", {}).get("identity_binding") == "PASS", f"{target} model identity was not bound")
        require(item.get("functional_revalidation", {}).get("functional_drift") == "NONE", f"{target} functional drift detected")

    vulnerability_record = load_json(FINAL_VULNERABILITY_RECORD)
    require(sha256_file(FINAL_VULNERABILITY_RECORD) == FINAL_VULNERABILITY_RECORD_SHA, "Final Vulnerability Review v2 record hash mismatch")
    require(vulnerability_record.get("record_id") == "code-f-current-candidate-final-vulnerability-ac992fcb3447e647-v2", "unexpected Final Vulnerability Review v2 record")
    require(vulnerability_record.get("review_authority", {}).get("status") == "PASS", "Final Vulnerability Review v2 is not PASS")
    require(vulnerability_record.get("candidate", {}).get("linux_worker_sha256") == EXPECTED["linux"]["worker_sha256"], "review record Linux Worker mismatch")
    require(vulnerability_record.get("candidate", {}).get("windows_worker_sha256") == EXPECTED["windows"]["worker_sha256"], "review record Windows Worker mismatch")

    model_manifest = load_json(MODEL_MANIFEST)
    require(model_manifest.get("model_id") == "google/siglip2-base-patch32-256", "SigLIP model id drift")
    require(model_manifest.get("official_model_revision") == "9e7ee68506177b546b2d5dc578f54afdc5e425f1", "SigLIP revision drift")
    model_artifacts = model_manifest.get("artifacts", {})
    require(model_artifacts.get("image_encoder", {}).get("sha256") == "ef5f7b69830c352e57f15668092d7323521836c16fff2d71d14549b75eca6059", "image ONNX identity drift")
    require(model_artifacts.get("text_encoder", {}).get("sha256") == "12bccdb491a98d224df1e6b6b249378118c6cfb54c18f6eb12286ffce8b26f30", "text ONNX identity drift")

    # The repository explicitly records that no authorized real-media corpus,
    # golden retrieval acceptance, or Windows low-end measurements exist yet.
    # Preserve those facts and do not turn synthetic E2E evidence into a real
    # index acceptance claim.
    governance_sha = sha256_file(GOLDEN_GOVERNANCE)
    completion_sha = sha256_file(COMPLETION_REPORT)
    current_head = git_head()
    target_records = {
        target: {
            **item,
            "target_evidence": {
                "path": Path(args.linux_evidence if target == "linux" else args.windows_evidence).name,
                "sha256": sha256_file(args.linux_evidence if target == "linux" else args.windows_evidence),
            },
        }
        for target, item in evidence.items()
    }
    bundle = {
        "report_kind": "CODE_C_CURRENT_CANDIDATE_SIGLIP_INDEX_AND_REAL_INDEX_GATE",
        "schema_version": "1",
        "status": "BLOCKED_PENDING_REAL_INDEX_ACCEPTANCE",
        "code_c_head_sha": current_head,
        "main_quality_baseline": MAIN_QUALITY_BASELINE,
        "final_vulnerability_review_v2": {
            "on_main": "PASS",
            "record_id": vulnerability_record["record_id"],
            "record_sha256": FINAL_VULNERABILITY_RECORD_SHA,
        },
        "candidate": {
            "linux_worker_sha256": EXPECTED["linux"]["worker_sha256"],
            "linux_carchive_sha256": EXPECTED["linux"]["carchive_sha256"],
            "windows_worker_sha256": EXPECTED["windows"]["worker_sha256"],
            "windows_carchive_sha256": EXPECTED["windows"]["carchive_sha256"],
            "final_distribution_binding_id": "code-c-final-distribution-6cd09589d42329c7",
            "final_distribution_binding_sha256": "6cd09589d42329c75e4ecac05411c898b81e60f5813cb8aa704b6e9b3ce0e799",
        },
        "siglip": {
            "model_id": model_manifest["model_id"],
            "official_revision": model_manifest["official_model_revision"],
            "image_onnx_sha256": model_artifacts["image_encoder"]["sha256"],
            "text_onnx_sha256": model_artifacts["text_encoder"]["sha256"],
            "manifest_sha256": sha256_file(MODEL_MANIFEST),
            "identity_binding": "PASS",
        },
        "functional_revalidation": {
            "status": "PASS",
            "worker_runtime_smoke": "PASS",
            "media_index_protocol": "PASS",
            "shot_keyframe_path": "PASS",
            "siglip_embedding_path": "PASS",
            "index_persistence": "PASS",
            "index_retrieval": "PASS",
            "linux_current_candidate_regression": "PASS",
            "windows_current_candidate_regression": "PASS",
            "functional_drift": "NONE",
            "targets": target_records,
        },
        "real_index_acceptance": {
            "evidence_status": "NOT_PREVIOUSLY_CLOSED",
            "evidence_rebind": "NOT_AVAILABLE",
            "authorized_real_asset_count": 0,
            "real_asset_provenance": "NOT_AVAILABLE",
            "real_index_500_asset_gate": "NOT_AVAILABLE",
            "golden_retrieval_protocol_id": None,
            "golden_retrieval_gate": "NOT_AVAILABLE",
            "golden_retrieval_drift": "NONE",
            "windows_4c_8gb_gate": "NOT_AVAILABLE",
            "windows_4c_16gb_gate": "NOT_AVAILABLE",
            "windows_low_end_profile_gate": "NOT_AVAILABLE",
            "authority_references": {
                "golden_set_governance": {"path": GOLDEN_GOVERNANCE.relative_to(REPOSITORY_ROOT).as_posix(), "sha256": governance_sha},
                "completion_report": {"path": COMPLETION_REPORT.relative_to(REPOSITORY_ROOT).as_posix(), "sha256": completion_sha},
            },
            "reason": "Repository has no authorized real-media corpus or formal 500-asset, golden-retrieval, or Windows 4C/8GB and 4C/16GB acceptance evidence.",
        },
        "recheck_trigger_binding": {
            "status": "PASS",
            "invalidate_on": [
                "Worker SHA change",
                "CArchive SHA change",
                "SigLIP model or ONNX SHA change",
                "Media Index protocol or index algorithm change",
                "Retrieval semantics or benchmark/golden corpus change",
                "Final Distribution Binding change",
            ],
        },
        "gates": {
            "code_c_current_candidate_siglip_index_functional_revalidation": "PASS",
            "real_index_acceptance_evidence_rebind": "NOT_AVAILABLE",
            "code_c_version_acceptance": "BLOCKED_PENDING_REAL_INDEX_ACCEPTANCE",
            "code_d_entry_gate": "BLOCKED",
        },
        "prohibited_reruns": {
            "worker_rebuild": "NO",
            "native_rerun": "NO",
            "license_rerun": "NO",
            "stage_a_rerun": "NO",
            "stage_b_rerun": "NO",
            "vulnerability_rerun": "NO",
            "pr_8_updated": "NO",
        },
        "next_owner": "CODE_C_REAL_INDEX_ACCEPTANCE",
    }
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    result = write_canonical_json(output_root / "SIGLIP_INDEX_REVALIDATION_BUNDLE.json", bundle)
    (output_root / "SIGLIP_INDEX_REVALIDATION_BUNDLE.sha256").write_text(
        f"{result.canonical_file_sha256}  SIGLIP_INDEX_REVALIDATION_BUNDLE.json\n",
        encoding="utf-8",
    )
    print(json.dumps({"status": bundle["status"], "bundle_sha256": result.canonical_file_sha256}, sort_keys=True))


if __name__ == "__main__":
    main()
