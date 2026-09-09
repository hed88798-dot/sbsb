from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import tempfile
from pathlib import Path

import numpy as np


EXPECTED_TEXT_ENCODER_SHA256 = (
    "12bccdb491a98d224df1e6b6b249378118c6cfb54c18f6eb12286ffce8b26f30"
)
EXPECTED_TOKENIZER_SHA256 = "61a7b147390c64585d6c3543dd6fc636906c9af3865a5548f27f31aee1d4c8e2"
DIMENSION = 768
SIGNATURE = hashlib.sha256(b"code-c-windows-literal-unicode-search-e2e-v1").hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_cache(cache_root: Path) -> None:
    """Create one deterministic, schema-valid search row without mock text inference."""
    generation_id = "generation_windows_unicode_e2e"
    generation = cache_root / generation_id
    generation.mkdir(parents=True)
    matrix_path = generation / "matrix.f16"
    vector = np.full((1, DIMENSION), 1.0 / math.sqrt(DIMENSION), dtype="<f2")
    matrix_path.write_bytes(vector.tobytes())
    row_map = {
        "schema_version": "1.0",
        "generation_id": generation_id,
        "signature_hash": SIGNATURE,
        "dimension": DIMENSION,
        "rows": [
            {
                "shot_id": "shot_windows_unicode_e2e",
                "asset_id": "asset_windows_unicode_e2e",
                "revision": 1,
                "start_ms": 0,
                "end_ms": 1000,
            }
        ],
    }
    row_bytes = json.dumps(row_map, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    row_path = generation / "rows.json"
    row_path.write_bytes(row_bytes)
    manifest = {
        "schema_version": "1.0",
        "generation_id": generation_id,
        "signature_hash": SIGNATURE,
        "dimension": DIMENSION,
        "row_count": 1,
        "matrix_file": "matrix.f16",
        "matrix_sha256": sha256_file(matrix_path),
        "row_map_file": "rows.json",
        "row_map_sha256": sha256_file(row_path),
        "created_at": "2026-09-08T00:00:00.000Z",
    }
    (generation / "manifest.json").write_bytes(
        (json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode(
            "utf-8"
        )
    )
    (cache_root / "active.json").write_bytes(
        (
            json.dumps(
                {"generation_id": generation_id, "signature_hash": SIGNATURE},
                sort_keys=True,
                separators=(",", ":"),
            )
            + "\n"
        ).encode("utf-8")
    )


def call_worker(worker: Path, cache_root: Path, model_root: Path, query_text: str, *, escaped: bool) -> dict:
    request = {
        "type": "request",
        "protocol_version": "1.0",
        "request_id": f"windows_unicode_{'escaped' if escaped else 'literal'}",
        "method": "media.search.exact.v1",
        "payload": {
            "cache_root": str(cache_root),
            "signature_hash": SIGNATURE,
            "model_root": str(model_root),
            "dimension": DIMENSION,
            "query_text": query_text,
            "top_k": 1,
        },
    }
    # ensure_ascii=False is the literal-UTF-8 regression.  The escaped case is
    # generated from the same literal value so it exercises both wire forms.
    wire = (json.dumps(request, ensure_ascii=escaped, separators=(",", ":")) + "\n").encode("utf-8")
    completed = subprocess.run(
        [str(worker)],
        input=wire,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        shell=False,
        timeout=180,
    )
    if completed.returncode != 0:
        raise SystemExit(
            f"packaged Worker exited {completed.returncode}: "
            f"{completed.stderr.decode('utf-8', errors='replace')[-4000:]}"
        )
    try:
        events = [json.loads(line) for line in completed.stdout.decode("utf-8", errors="strict").splitlines() if line]
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit(f"packaged Worker emitted invalid UTF-8/JSON: {error}") from error
    errors = [event for event in events if event.get("type") == "error"]
    if errors:
        raise SystemExit(f"packaged Worker rejected {query_text!r}: {errors[-1]}")
    result_events = [event for event in events if event.get("type") == "result"]
    if not result_events:
        raise SystemExit(f"packaged Worker emitted no result for {query_text!r}: {events!r}")
    candidates = result_events[-1].get("payload", {}).get("candidates", [])
    if not isinstance(candidates, list) or not candidates:
        raise SystemExit(f"packaged Worker returned no candidates for {query_text!r}")
    top = candidates[0]
    score = top.get("semantic_score") if isinstance(top, dict) else None
    if not isinstance(score, (int, float)) or not math.isfinite(float(score)):
        raise SystemExit(f"packaged Worker returned a non-finite semantic score: {top!r}")
    return {
        "query_text": query_text,
        "wire_encoding": "escaped-json" if escaped else "literal-utf8",
        "candidate_count": len(candidates),
        "top_candidate": top,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    worker = args.worker.resolve(strict=True)
    model_root = args.model_root.resolve(strict=True)
    model_manifest = json.loads((model_root / "MODEL_MANIFEST.json").read_text(encoding="utf-8"))
    artifacts = model_manifest.get("artifacts", {})
    if artifacts.get("text_encoder", {}).get("sha256") != EXPECTED_TEXT_ENCODER_SHA256:
        raise SystemExit("text encoder manifest identity mismatch")
    if artifacts.get("tokenizer_model", {}).get("sha256") != EXPECTED_TOKENIZER_SHA256:
        raise SystemExit("tokenizer manifest identity mismatch")
    with tempfile.TemporaryDirectory(prefix="windows-unicode-search-e2e-") as directory:
        cache_root = Path(directory) / "search-cache"
        cache_root.mkdir()
        write_cache(cache_root)
        results = [
            call_worker(worker, cache_root, model_root, "猪场", escaped=False),
            call_worker(worker, cache_root, model_root, "猪场", escaped=True),
            call_worker(worker, cache_root, model_root, "pig farm", escaped=False),
        ]
    report = {
        "report_kind": "CODE_C_PACKAGED_WINDOWS_UTF8_TEXT_SEARCH_E2E",
        "schema_version": "1",
        "status": "PASS",
        "protocol_version": "1.0",
        "worker_sha256": sha256_file(worker),
        "model_text_encoder_sha256": EXPECTED_TEXT_ENCODER_SHA256,
        "model_tokenizer_sha256": EXPECTED_TOKENIZER_SHA256,
        "results": results,
        "model_execution": "REAL_ONNX_TEXT_ENCODER_AND_SENTENCEPIECE",
        "cache_fixture": "deterministic-single-row-search-cache",
        "corpus_execution": "NOT_RUN",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("packaged-windows-utf8-text-search-e2e: PASS (literal Chinese, escaped Chinese, English)")


if __name__ == "__main__":
    main()
