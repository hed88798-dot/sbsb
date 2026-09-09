from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from canonical_evidence import write_canonical_json


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MODEL_SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "model-manifests"
    / "siglip2-base-patch32-256.source-lock.json"
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
EXPECTED_MODEL = {
    "model_id": "google/siglip2-base-patch32-256",
    "revision": "9e7ee68506177b546b2d5dc578f54afdc5e425f1",
    "image_encoder_sha256": "ef5f7b69830c352e57f15668092d7323521836c16fff2d71d14549b75eca6059",
    "text_encoder_sha256": "12bccdb491a98d224df1e6b6b249378118c6cfb54c18f6eb12286ffce8b26f30",
}
FINAL_DISTRIBUTION = {
    "id": "code-c-final-distribution-6cd09589d42329c7",
    "sha256": "6cd09589d42329c75e4ecac05411c898b81e60f5813cb8aa704b6e9b3ce0e799",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def document_hash(document: dict[str, Any], field: str) -> str:
    copy = dict(document)
    copy.pop(field, None)
    payload = json.dumps(copy, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise SystemExit(f"expected JSON object: {path}")
    return value


def require(value: bool, message: str) -> None:
    if not value:
        raise SystemExit(message)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=sorted(EXPECTED), required=True)
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--carchive", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--model-evidence", type=Path, required=True)
    parser.add_argument("--e2e-report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    target = args.target
    worker = args.worker.resolve(strict=True)
    carchive = args.carchive.resolve(strict=True)
    manifest_path = args.manifest.resolve(strict=True)
    model_root = args.model_root.resolve(strict=True)
    model_evidence_path = args.model_evidence.resolve(strict=True)
    e2e_path = args.e2e_report.resolve(strict=True)

    manifest = load_json(manifest_path)
    expected = EXPECTED[target]
    require(manifest.get("schema_version") == "2", f"{target} candidate manifest schema mismatch")
    require(manifest.get("platform", {}).get("os") == target, f"{target} candidate platform mismatch")
    require(manifest.get("platform", {}).get("architecture") == "x86_64", f"{target} candidate architecture mismatch")
    require(manifest.get("transfer_role") == "TRANSIENT_ACTIONS_TRANSFER", f"{target} transfer role mismatch")
    require(manifest.get("actions_artifact", {}).get("authority_role") == "TRANSPORT_ONLY", f"{target} transport authority mismatch")
    require(manifest.get("actions_artifact", {}).get("retention_days") == 1, f"{target} transfer retention mismatch")
    require(manifest.get("final_retention", {}).get("channel") == "MAC_LOCAL_PROJECT_FOLDER", f"{target} retention channel mismatch")
    require(manifest.get("worker", {}).get("sha256") == expected["worker_sha256"], f"{target} manifest Worker binding mismatch")
    require(manifest.get("carchive", {}).get("sha256") == expected["carchive_sha256"], f"{target} manifest CArchive binding mismatch")
    require(sha256_file(worker) == expected["worker_sha256"], f"{target} Worker SHA mismatch")
    require(sha256_file(carchive) == expected["carchive_sha256"], f"{target} CArchive SHA mismatch")
    require(document_hash(manifest, "manifest_sha256") == str(manifest.get("manifest_sha256")), f"{target} manifest canonical hash mismatch")

    model_manifest_path = model_root / "MODEL_MANIFEST.json"
    model_manifest = load_json(model_manifest_path)
    require(model_manifest.get("model_id") == EXPECTED_MODEL["model_id"], f"{target} model id drift")
    require(model_manifest.get("official_model_revision") == EXPECTED_MODEL["revision"], f"{target} model revision drift")
    artifacts = model_manifest.get("artifacts", {})
    require(artifacts.get("image_encoder", {}).get("sha256") == EXPECTED_MODEL["image_encoder_sha256"], f"{target} image ONNX manifest binding mismatch")
    require(artifacts.get("text_encoder", {}).get("sha256") == EXPECTED_MODEL["text_encoder_sha256"], f"{target} text ONNX manifest binding mismatch")
    model_evidence = load_json(model_evidence_path)
    require(model_evidence.get("status") == "PASS", f"{target} model hydration evidence is not PASS")
    hydrated = {str(item.get("role")): item for item in model_evidence.get("artifacts", []) if isinstance(item, dict)}
    require(hydrated.get("image_encoder", {}).get("sha256") == EXPECTED_MODEL["image_encoder_sha256"], f"{target} hydrated image ONNX hash mismatch")
    require(hydrated.get("text_encoder", {}).get("sha256") == EXPECTED_MODEL["text_encoder_sha256"], f"{target} hydrated text ONNX hash mismatch")

    e2e = load_json(e2e_path)
    require(e2e.get("status") == "PASS", f"{target} exact Worker E2E did not PASS")
    require(e2e.get("worker_execution") == "PYINSTALLER_ONEFILE", f"{target} E2E did not execute the packaged Worker")
    require(e2e.get("candidate_worker", {}).get("sha256") == expected["worker_sha256"], f"{target} E2E Worker binding mismatch")
    stages = set(str(stage) for stage in e2e.get("index_stages", []))
    require({"PROBE", "SHOT_DETECTION", "EMBEDDING", "MANIFEST"}.issubset(stages), f"{target} E2E index stages are incomplete")
    second_scan = set(str(stage) for stage in e2e.get("second_scan_stages", []))
    require("RESUME" in second_scan and e2e.get("second_scan_zero_reprocess") is True, f"{target} second-scan persistence regression")
    shot_count = int(e2e.get("shot_count", 0))
    truth_rows = int(e2e.get("sqlite_embedding_truth_rows", 0))
    require(shot_count >= 2 and truth_rows == shot_count, f"{target} embedding persistence rows are incomplete")
    require(int(e2e.get("network_observation", {}).get("outbound_network_attempts", -1)) == 0, f"{target} functional E2E observed outbound network")
    top = e2e.get("top_candidate", {})
    require(isinstance(top, dict) and top.get("asset_id") == "asset_real_siglip_fixture" and int(top.get("revision", 0)) == 1, f"{target} exact retrieval result is invalid")

    output = {
        "report_kind": "CODE_C_CURRENT_CANDIDATE_SIGLIP_INDEX_REVALIDATION",
        "schema_version": "1",
        "status": "PASS",
        "target": target,
        "candidate": {
            "candidate_id": manifest.get("candidate_id"),
            "manifest_sha256": manifest.get("manifest_sha256"),
            "worker_sha256": expected["worker_sha256"],
            "carchive_sha256": expected["carchive_sha256"],
            "transfer_role": "TRANSPORT_ONLY",
            "stage_b_authority_depends_on_transient_artifact": "NO",
            "final_distribution_binding": FINAL_DISTRIBUTION,
        },
        "model": {
            "model_id": EXPECTED_MODEL["model_id"],
            "official_revision": EXPECTED_MODEL["revision"],
            "image_onnx_sha256": EXPECTED_MODEL["image_encoder_sha256"],
            "text_onnx_sha256": EXPECTED_MODEL["text_encoder_sha256"],
            "manifest_sha256": sha256_file(model_manifest_path),
            "source_lock_sha256": sha256_file(MODEL_SOURCE_LOCK),
            "identity_binding": "PASS",
        },
        "functional_revalidation": {
            "worker_runtime_smoke": "PASS",
            "media_index_protocol": "PASS",
            "shot_keyframe_path": "PASS",
            "siglip_embedding_path": "PASS",
            "index_persistence": "PASS",
            "index_retrieval": "PASS",
            "current_candidate_regression": "PASS",
            "functional_drift": "NONE",
            "e2e_report": {"path": e2e_path.name, "sha256": sha256_file(e2e_path)},
            "index_stages": e2e.get("index_stages", []),
            "second_scan_stages": e2e.get("second_scan_stages", []),
            "shot_count": shot_count,
            "sqlite_embedding_truth_rows": truth_rows,
            "outbound_network_attempts": e2e.get("network_observation", {}).get("outbound_network_attempts"),
            "top_candidate": top,
        },
        "evidence": {
            "candidate_manifest": {"path": manifest_path.name, "sha256": sha256_file(manifest_path)},
            "model_hydration": {"path": model_evidence_path.name, "sha256": sha256_file(model_evidence_path)},
            "runtime_mode": "EXACT_FROZEN_PYINSTALLER_ONEFILE",
            "worker_rebuild": "NO",
            "instrumentation_mutates_worker": "NO",
        },
    }
    result = write_canonical_json(args.output.resolve(), output)
    print(json.dumps({"target": target, "status": "PASS", "sha256": result.canonical_file_sha256}, sort_keys=True))


if __name__ == "__main__":
    main()
