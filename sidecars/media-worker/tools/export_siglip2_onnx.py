from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

EXPORT_SCRIPT_VERSION = "siglip2-onnx-export-v2"
PREPROCESS_VERSION = "siglip2-processor-256-bicubic-mean0.5-v1"
OPSET = 18
MAX_TEXT_LENGTH = 64
RTOL = 1e-4
ATOL = 1e-5
MIN_COSINE = 0.99999


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def validate_source(source: Path, lock_path: Path) -> dict[str, Any]:
    lock = json.loads(lock_path.read_text("utf-8"))
    for name, expected in lock["files"].items():
        path = source / name
        if not path.is_file():
            raise SystemExit(f"source validation failed (missing): {name}")
        if path.stat().st_size != expected["size"] or sha256_file(path) != expected["sha256"]:
            raise SystemExit(f"source validation failed (hash/size): {name}")
    return lock


def normalize_rows(values: Any) -> Any:
    import numpy as np

    array = np.asarray(values, dtype=np.float32)
    norms = np.linalg.norm(array, axis=1, keepdims=True)
    if not np.all(np.isfinite(array)) or np.any(norms <= 0):
        raise SystemExit("correctness validation produced invalid embeddings")
    return array / norms


def comparison(reference: Any, candidate: Any) -> dict[str, Any]:
    import numpy as np

    reference_array = np.asarray(reference, dtype=np.float32)
    candidate_array = np.asarray(candidate, dtype=np.float32)
    if reference_array.shape != candidate_array.shape:
        raise SystemExit(
            f"ONNX output shape mismatch: {reference_array.shape} != {candidate_array.shape}"
        )
    if not np.all(np.isfinite(reference_array)) or not np.all(np.isfinite(candidate_array)):
        raise SystemExit("ONNX correctness validation produced non-finite values")
    reference_normalized = normalize_rows(reference_array)
    candidate_normalized = normalize_rows(candidate_array)
    cosines = np.sum(reference_normalized * candidate_normalized, axis=1)
    result = {
        "shape": list(reference_array.shape),
        "max_abs_error": float(np.max(np.abs(reference_array - candidate_array))),
        "min_cosine_similarity": float(np.min(cosines)),
        "allclose": bool(np.allclose(reference_array, candidate_array, rtol=RTOL, atol=ATOL)),
    }
    if not result["allclose"] or result["min_cosine_similarity"] < MIN_COSINE:
        raise SystemExit(f"PyTorch/ORT correctness threshold failed: {result}")
    return result


def deterministic_images() -> list[Any]:
    import numpy as np

    axis = np.arange(256, dtype=np.uint8)
    horizontal = np.broadcast_to(axis[None, :], (256, 256))
    vertical = horizontal.T
    gradient = np.stack([horizontal, vertical, np.full_like(horizontal, 127)], axis=2)
    checker = (((horizontal // 32 + vertical // 32) % 2) * 255).astype(np.uint8)
    checker_rgb = np.stack([checker, np.flipud(checker), checker], axis=2)
    rng = np.random.default_rng(20260827)
    noise = rng.integers(0, 256, size=(256, 256, 3), dtype=np.uint8)
    solid = np.full((256, 256, 3), [32, 128, 224], dtype=np.uint8)
    return [gradient, checker_rgb, noise, solid]


def artifact_record(path: Path, logical_kind: str, storage_base: str) -> dict[str, Any]:
    digest = sha256_file(path)
    return {
        "logical_id": f"google-siglip2-base-patch32-256/{logical_kind}/sha256:{digest}",
        "path": path.name,
        "sha256": digest,
        "size": path.stat().st_size,
        "storage_reference": f"{storage_base.rstrip('/')}/{path.name}",
    }


def export(
    source: Path,
    output: Path,
    export_commit: str,
    storage_base: str,
    lock: dict[str, Any],
) -> None:
    import numpy as np
    import onnx
    import onnxruntime as ort
    import sentencepiece
    import torch
    import transformers
    from transformers import AutoImageProcessor, AutoModel, AutoTokenizer

    output.mkdir(parents=True, exist_ok=False)
    model = AutoModel.from_pretrained(
        source,
        local_files_only=True,
        trust_remote_code=False,
        dtype=torch.float32,
        use_safetensors=True,
    ).eval()
    image_processor = AutoImageProcessor.from_pretrained(
        source, local_files_only=True, trust_remote_code=False, use_fast=False
    )
    tokenizer = AutoTokenizer.from_pretrained(
        source, local_files_only=True, trust_remote_code=False, use_fast=False
    )

    class ImageEncoder(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.encoder = model.vision_model

        def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
            return self.encoder(
                pixel_values=pixel_values, interpolate_pos_encoding=False
            ).pooler_output

    class TextEncoder(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.encoder = model.text_model

        def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
            return self.encoder(
                input_ids=input_ids, attention_mask=attention_mask, position_ids=None
            ).pooler_output

    image_encoder = ImageEncoder().eval()
    text_encoder = TextEncoder().eval()
    image_path = output / "image-encoder.onnx"
    text_path = output / "text-encoder.onnx"
    tokenizer_model_path = output / "tokenizer.model"
    tokenizer_config_path = output / "tokenizer_config.json"
    shutil.copyfile(source / "tokenizer.model", tokenizer_model_path)
    shutil.copyfile(source / "tokenizer_config.json", tokenizer_config_path)

    image_arrays = deterministic_images()
    image_input = image_processor(images=image_arrays, return_tensors="pt")["pixel_values"]
    queries = [
        "a healthy pig standing in a clean barn",
        "a veterinary medicine bottle beside livestock",
        "健康的猪站在干净的猪舍里",
        "兽药瓶放在畜牧场景旁边",
    ]
    text_inputs = tokenizer(
        queries,
        padding="max_length",
        truncation=True,
        max_length=MAX_TEXT_LENGTH,
        return_tensors="pt",
    )

    torch.onnx.export(
        image_encoder,
        (image_input[:1],),
        image_path,
        input_names=["pixel_values"],
        output_names=["image_embeds"],
        dynamic_axes={"pixel_values": {0: "batch"}, "image_embeds": {0: "batch"}},
        opset_version=OPSET,
        do_constant_folding=True,
        dynamo=False,
        external_data=False,
    )
    torch.onnx.export(
        text_encoder,
        (text_inputs["input_ids"][:1], text_inputs["attention_mask"][:1]),
        text_path,
        input_names=["input_ids", "attention_mask"],
        output_names=["text_embeds"],
        dynamic_axes={
            "input_ids": {0: "batch"},
            "attention_mask": {0: "batch"},
            "text_embeds": {0: "batch"},
        },
        opset_version=OPSET,
        do_constant_folding=True,
        dynamo=False,
        external_data=False,
    )
    onnx.checker.check_model(str(image_path), full_check=True)
    onnx.checker.check_model(str(text_path), full_check=True)

    with torch.inference_mode():
        torch_image = image_encoder(image_input).cpu().numpy()
        torch_text = text_encoder(
            text_inputs["input_ids"], text_inputs["attention_mask"]
        ).cpu().numpy()
    image_session = ort.InferenceSession(str(image_path), providers=["CPUExecutionProvider"])
    text_session = ort.InferenceSession(str(text_path), providers=["CPUExecutionProvider"])
    ort_image = image_session.run(None, {"pixel_values": image_input.cpu().numpy()})[0]
    ort_text = text_session.run(
        None,
        {
            "input_ids": text_inputs["input_ids"].cpu().numpy(),
            "attention_mask": text_inputs["attention_mask"].cpu().numpy(),
        },
    )[0]
    image_comparison = comparison(torch_image, ort_image)
    text_comparison = comparison(torch_text, ort_text)

    torch_scores = normalize_rows(torch_text) @ normalize_rows(torch_image).T
    ort_scores = normalize_rows(ort_text) @ normalize_rows(ort_image).T
    torch_rankings = np.argsort(-torch_scores, axis=1).tolist()
    ort_rankings = np.argsort(-ort_scores, axis=1).tolist()
    if torch_rankings != ort_rankings:
        raise SystemExit("PyTorch/ORT ranking consistency failed")

    sentencepiece_tokenizer = sentencepiece.SentencePieceProcessor(
        model_file=str(tokenizer_model_path)
    )
    worker_ids: list[list[int]] = []
    worker_masks: list[list[int]] = []
    eos_id = int(sentencepiece_tokenizer.piece_to_id("<eos>"))
    pad_id = int(sentencepiece_tokenizer.piece_to_id("<pad>"))
    for query in queries:
        ids = list(sentencepiece_tokenizer.encode(query, out_type=int))[: MAX_TEXT_LENGTH - 1]
        ids.append(eos_id)
        mask = [1] * len(ids)
        ids.extend([pad_id] * (MAX_TEXT_LENGTH - len(ids)))
        mask.extend([0] * (MAX_TEXT_LENGTH - len(mask)))
        worker_ids.append(ids)
        worker_masks.append(mask)
    if not np.array_equal(np.asarray(worker_ids), text_inputs["input_ids"].cpu().numpy()):
        raise SystemExit("production worker tokenizer IDs differ from official tokenizer")
    if not np.array_equal(np.asarray(worker_masks), text_inputs["attention_mask"].cpu().numpy()):
        raise SystemExit("production worker attention masks differ from official tokenizer")

    dimension = int(ort_image.shape[-1])
    if dimension != int(ort_text.shape[-1]):
        raise SystemExit("image/text embedding dimensions differ")
    export_configuration = {
        "opset": OPSET,
        "dtype": "float32",
        "image_input": {"name": "pixel_values", "shape": ["batch", 3, 256, 256]},
        "text_inputs": {
            "input_ids": ["batch", MAX_TEXT_LENGTH],
            "attention_mask": ["batch", MAX_TEXT_LENGTH],
        },
        "outputs": {"image": ["batch", dimension], "text": ["batch", dimension]},
        "dynamic_batch": True,
        "constant_folding": True,
        "external_data": False,
        "preprocess_version": PREPROCESS_VERSION,
    }
    created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    correctness_path = output / "PYTORCH_ORT_CORRECTNESS.json"
    correctness_report = {
        "schema_version": "1.0",
        "created_at": created_at,
        "source_revision": lock["source_revision"],
        "thresholds": {"rtol": RTOL, "atol": ATOL, "min_cosine_similarity": MIN_COSINE},
        "fixtures": {"images": len(image_arrays), "queries": queries},
        "image": image_comparison,
        "text": text_comparison,
        "ranking_consistent": True,
        "production_tokenizer_matches_official": True,
        "torch_rankings": torch_rankings,
        "onnxruntime_rankings": ort_rankings,
    }
    correctness_path.write_text(
        json.dumps(correctness_report, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        "utf-8",
    )

    artifacts = {
        "image_encoder": artifact_record(image_path, "image-encoder-onnx-fp32", storage_base),
        "text_encoder": artifact_record(text_path, "text-encoder-onnx-fp32", storage_base),
        "tokenizer_model": artifact_record(tokenizer_model_path, "tokenizer-model", storage_base),
        "tokenizer_config": artifact_record(tokenizer_config_path, "tokenizer-config", storage_base),
        "correctness_report": artifact_record(
            correctness_path, "pytorch-ort-correctness", storage_base
        ),
    }
    manifest = {
        "schema_version": "1.1",
        "model_id": lock["model_id"],
        "model_version": f"onnx-fp32-{lock['source_revision'][:12]}",
        "official_model_revision": lock["source_revision"],
        "source": lock["source"],
        "source_revision": lock["source_revision"],
        "source_files": lock["files"],
        "source_file_hash": canonical_hash(lock["files"]),
        "processor_revision": lock["source_revision"],
        "tokenizer_revision": lock["source_revision"],
        "license": lock["license"],
        "format": "ONNX",
        "onnx_opset": OPSET,
        "onnxruntime_version": ort.__version__,
        "runtime": "onnxruntime-cpu",
        "preprocess_version": PREPROCESS_VERSION,
        "input_schema": {"image": export_configuration["image_input"], "text": export_configuration["text_inputs"]},
        "output_schema": export_configuration["outputs"],
        "input_shapes": {"image": ["batch", 3, 256, 256], "text": ["batch", 64]},
        "dimension": dimension,
        "dtype": "float32",
        "worker_min_version": "0.3.0",
        "index_schema_version": "1.0",
        "export_script_version": EXPORT_SCRIPT_VERSION,
        "export_commit": export_commit,
        "export_environment": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
            "machine": platform.machine(),
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "onnx": onnx.__version__,
            "onnxruntime": ort.__version__,
            "numpy": np.__version__,
            "sentencepiece": sentencepiece.__version__,
        },
        "export_configuration": export_configuration,
        "export_config_hash": canonical_hash(export_configuration),
        "created_at": created_at,
        "artifact_storage_base_reference": storage_base,
        "artifacts": artifacts,
        "runtime_compatibility": {
            "python": "3.12.*",
            "providers": ["CPUExecutionProvider"],
            "platforms": ["darwin-arm64", "linux-x64", "windows-x64"],
        },
        "correctness": {
            "status": "PASS",
            "report_sha256": artifacts["correctness_report"]["sha256"],
        },
        "golden_retrieval_metrics": {"status": "PENDING"},
        "default_intra_op_threads": max(1, (os.cpu_count() or 2) // 2),
    }
    temporary = output / ".MODEL_MANIFEST.json.tmp"
    temporary.write_text(canonical_json(manifest) + "\n", "utf-8")
    os.replace(temporary, output / "MODEL_MANIFEST.json")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--source-lock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--export-commit", required=True)
    parser.add_argument("--storage-base-reference", required=True)
    arguments = parser.parse_args()
    if len(arguments.export_commit) != 40 or any(
        value not in "0123456789abcdef" for value in arguments.export_commit
    ):
        raise SystemExit("--export-commit must be a full Git SHA")
    if "://" not in arguments.storage_base_reference:
        raise SystemExit("--storage-base-reference must be an absolute controlled-storage URI")
    lock = validate_source(arguments.source, arguments.source_lock)
    export(
        arguments.source,
        arguments.output,
        arguments.export_commit,
        arguments.storage_base_reference,
        lock,
    )


if __name__ == "__main__":
    main()
