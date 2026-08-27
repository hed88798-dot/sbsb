from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path
from typing import Any

EXPORT_SCRIPT_VERSION = "siglip2-onnx-export-v1"
PREPROCESS_VERSION = "siglip2-processor-256-bicubic-mean0.5-v1"
OPSET = 18


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(payload).hexdigest()


def validate_source(source: Path, lock_path: Path) -> dict[str, Any]:
    lock = json.loads(lock_path.read_text("utf-8"))
    for name, expected in lock["files"].items():
        path = source / name
        if path.stat().st_size != expected["size"] or sha256_file(path) != expected["sha256"]:
            raise SystemExit(f"source validation failed: {name}")
    return lock


def export(source: Path, output: Path, export_commit: str, lock: dict[str, Any]) -> None:
    import numpy as np
    import onnxruntime as ort
    import torch
    from transformers import AutoModel

    output.mkdir(parents=True, exist_ok=False)
    model = AutoModel.from_pretrained(
        source,
        local_files_only=True,
        trust_remote_code=False,
        torch_dtype=torch.float32,
    ).eval()

    class ImageEncoder(torch.nn.Module):
        def forward(self, pixel_values: torch.Tensor) -> torch.Tensor:
            return model.get_image_features(pixel_values=pixel_values)

    class TextEncoder(torch.nn.Module):
        def forward(self, input_ids: torch.Tensor, attention_mask: torch.Tensor) -> torch.Tensor:
            return model.get_text_features(input_ids=input_ids, attention_mask=attention_mask)

    image_path = output / "image-encoder.onnx"
    text_path = output / "text-encoder.onnx"
    tokenizer_model_path = output / "tokenizer.model"
    tokenizer_config_path = output / "tokenizer_config.json"
    shutil.copyfile(source / "tokenizer.model", tokenizer_model_path)
    shutil.copyfile(source / "tokenizer_config.json", tokenizer_config_path)
    image_input = torch.zeros((1, 3, 256, 256), dtype=torch.float32)
    text_ids = torch.zeros((1, 64), dtype=torch.int64)
    text_mask = torch.ones((1, 64), dtype=torch.int64)
    torch.onnx.export(
        ImageEncoder(),
        (image_input,),
        image_path,
        input_names=["pixel_values"],
        output_names=["image_embeds"],
        dynamic_axes={"pixel_values": {0: "batch"}, "image_embeds": {0: "batch"}},
        opset_version=OPSET,
        do_constant_folding=True,
    )
    torch.onnx.export(
        TextEncoder(),
        (text_ids, text_mask),
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
    )
    with torch.no_grad():
        torch_image = ImageEncoder()(image_input).numpy()
        torch_text = TextEncoder()(text_ids, text_mask).numpy()
    ort_image = ort.InferenceSession(str(image_path), providers=["CPUExecutionProvider"]).run(
        None, {"pixel_values": image_input.numpy()}
    )[0]
    ort_text = ort.InferenceSession(str(text_path), providers=["CPUExecutionProvider"]).run(
        None, {"input_ids": text_ids.numpy(), "attention_mask": text_mask.numpy()}
    )[0]
    if not np.allclose(torch_image, ort_image, rtol=1e-4, atol=1e-5):
        raise SystemExit("image ONNX output validation failed")
    if not np.allclose(torch_text, ort_text, rtol=1e-4, atol=1e-5):
        raise SystemExit("text ONNX output validation failed")
    dimension = int(ort_image.shape[-1])
    if dimension != int(ort_text.shape[-1]):
        raise SystemExit("image/text embedding dimensions differ")
    import onnxruntime

    manifest = {
        "schema_version": "1.0",
        "model_id": lock["model_id"],
        "model_version": f"onnx-fp32-{lock['source_revision'][:12]}",
        "source": lock["source"],
        "source_revision": lock["source_revision"],
        "source_file_hash": canonical_hash(lock["files"]),
        "processor_revision": lock["source_revision"],
        "tokenizer_revision": lock["source_revision"],
        "license": lock["license"],
        "format": "ONNX",
        "onnx_opset": OPSET,
        "onnxruntime_version": onnxruntime.__version__,
        "runtime": "onnxruntime-cpu",
        "preprocess_version": PREPROCESS_VERSION,
        "input_shapes": {"image": ["batch", 3, 256, 256], "text": ["batch", 64]},
        "dimension": dimension,
        "dtype": "float32",
        "worker_min_version": "0.3.0",
        "index_schema_version": "1.0",
        "export_script_version": EXPORT_SCRIPT_VERSION,
        "export_commit": export_commit,
        "artifacts": {
            "image_encoder": {"path": image_path.name, "sha256": sha256_file(image_path), "size": image_path.stat().st_size},
            "text_encoder": {"path": text_path.name, "sha256": sha256_file(text_path), "size": text_path.stat().st_size},
            "tokenizer_model": {
                "path": tokenizer_model_path.name,
                "sha256": sha256_file(tokenizer_model_path),
                "size": tokenizer_model_path.stat().st_size,
            },
            "tokenizer_config": {
                "path": tokenizer_config_path.name,
                "sha256": sha256_file(tokenizer_config_path),
                "size": tokenizer_config_path.stat().st_size,
            },
        },
        "default_intra_op_threads": max(1, (os.cpu_count() or 2) // 2),
    }
    temporary = output / ".MODEL_MANIFEST.json.tmp"
    temporary.write_text(json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")), "utf-8")
    os.replace(temporary, output / "MODEL_MANIFEST.json")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--source-lock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--export-commit", required=True)
    arguments = parser.parse_args()
    if len(arguments.export_commit) != 40 or any(value not in "0123456789abcdef" for value in arguments.export_commit):
        raise SystemExit("--export-commit must be a full Git SHA")
    lock = validate_source(arguments.source, arguments.source_lock)
    export(arguments.source, arguments.output, arguments.export_commit, lock)


if __name__ == "__main__":
    main()
