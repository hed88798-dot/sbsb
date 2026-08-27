from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from .contracts import WorkerError, require_contained_file, sha256_file


def normalize(vector: np.ndarray) -> np.ndarray:
    value = np.asarray(vector, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(value))
    if not np.isfinite(norm) or norm <= 0:
        raise WorkerError("MODEL_OUTPUT_INVALID", "Embedding is empty or non-finite")
    return value / norm


def aggregate_shot_embeddings(vectors: list[np.ndarray]) -> np.ndarray:
    if not vectors:
        raise WorkerError("MODEL_OUTPUT_INVALID", "No keyframe embeddings were produced")
    normalized = np.stack([normalize(vector) for vector in vectors], axis=0)
    return normalize(np.mean(normalized, axis=0, dtype=np.float32))


def tokenize_siglip_text(tokenizer: Any, text: str, max_length: int = 64) -> dict[str, np.ndarray]:
    query = text.strip()
    if not query or len(query) > 2000:
        raise WorkerError("QUERY_TEXT_INVALID", "Text query must contain 1-2000 characters")
    tokens = list(tokenizer.encode(query, out_type=int))
    eos_id = int(tokenizer.piece_to_id("<eos>"))
    pad_id = int(tokenizer.piece_to_id("<pad>"))
    tokens = tokens[: max_length - 1] + [eos_id]
    tokens.extend([pad_id] * (max_length - len(tokens)))
    return {"input_ids": np.asarray([tokens], dtype=np.int64)}


class SiglipOnnx:
    def __init__(self, model_root: Path, expected_dimension: int) -> None:
        try:
            import onnxruntime as ort
        except ImportError as error:
            raise WorkerError("MODEL_RUNTIME_MISSING", "ONNX Runtime CPU is unavailable") from error

        manifest_path = model_root / "MODEL_MANIFEST.json"
        try:
            manifest: dict[str, Any] = json.loads(manifest_path.read_text("utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise WorkerError("MODEL_MANIFEST_INVALID", "SigLIP model manifest is unreadable") from error
        if manifest.get("model_id") != "google/siglip2-base-patch32-256":
            raise WorkerError("MODEL_MANIFEST_INVALID", "Unexpected embedding model")
        if manifest.get("dimension") != expected_dimension or manifest.get("dtype") != "float32":
            raise WorkerError("MODEL_MANIFEST_INVALID", "Embedding model output contract mismatch")
        artifacts = manifest.get("artifacts", {})
        artifact = artifacts.get("image_encoder")
        if not isinstance(artifact, dict):
            raise WorkerError("MODEL_MANIFEST_INVALID", "Image encoder artifact is missing")
        model_path = require_contained_file(model_root, str(artifact.get("path", "")))
        if sha256_file(model_path) != artifact.get("sha256"):
            raise WorkerError("MODEL_HASH_MISMATCH", "Image encoder hash validation failed")
        threads = max(1, int(manifest.get("default_intra_op_threads", 1)))
        session_options = ort.SessionOptions()
        session_options.intra_op_num_threads = threads
        session_options.inter_op_num_threads = 1
        session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self._session = ort.InferenceSession(
            str(model_path), session_options, providers=["CPUExecutionProvider"]
        )
        self._input_name = self._session.get_inputs()[0].name
        self._dimension = expected_dimension
        self._model_root = model_root
        self._artifacts = artifacts
        self._session_options = session_options
        self._ort = ort
        self._text_session: Any | None = None
        self._tokenizer: Any | None = None

    @staticmethod
    def preprocess(rgb: np.ndarray) -> np.ndarray:
        try:
            from PIL import Image
        except ImportError as error:
            raise WorkerError("IMAGE_RUNTIME_MISSING", "Pillow is unavailable") from error
        image = Image.fromarray(rgb, mode="RGB").resize((256, 256), Image.Resampling.BICUBIC)
        pixels = np.asarray(image, dtype=np.float32) / np.float32(255.0)
        pixels = (pixels - np.float32(0.5)) / np.float32(0.5)
        return np.transpose(pixels, (2, 0, 1))[None, ...].astype(np.float32, copy=False)

    def image_embedding(self, rgb: np.ndarray) -> np.ndarray:
        outputs = self._session.run(None, {self._input_name: self.preprocess(rgb)})
        if not outputs:
            raise WorkerError("MODEL_OUTPUT_INVALID", "ONNX returned no image embedding")
        embedding = normalize(np.asarray(outputs[0], dtype=np.float32))
        if embedding.size != self._dimension:
            raise WorkerError("MODEL_OUTPUT_INVALID", "Embedding dimension mismatch")
        return embedding

    def _verified_artifact(self, name: str) -> Path:
        artifact = self._artifacts.get(name)
        if not isinstance(artifact, dict):
            raise WorkerError("MODEL_MANIFEST_INVALID", f"{name} artifact is missing")
        path = require_contained_file(self._model_root, str(artifact.get("path", "")))
        if sha256_file(path) != artifact.get("sha256"):
            raise WorkerError("MODEL_HASH_MISMATCH", f"{name} hash validation failed")
        return path

    def text_embedding(self, text: str) -> np.ndarray:
        if self._text_session is None or self._tokenizer is None:
            try:
                import sentencepiece as sentencepiece
            except ImportError as error:
                raise WorkerError("TOKENIZER_RUNTIME_MISSING", "SentencePiece is unavailable") from error
            text_model = self._verified_artifact("text_encoder")
            tokenizer_model = self._verified_artifact("tokenizer_model")
            self._text_session = self._ort.InferenceSession(
                str(text_model), self._session_options, providers=["CPUExecutionProvider"]
            )
            self._tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(tokenizer_model))
        inputs = tokenize_siglip_text(self._tokenizer, text)
        outputs = self._text_session.run(None, inputs)
        if not outputs:
            raise WorkerError("MODEL_OUTPUT_INVALID", "ONNX returned no text embedding")
        embedding = normalize(np.asarray(outputs[0], dtype=np.float32))
        if embedding.size != self._dimension:
            raise WorkerError("MODEL_OUTPUT_INVALID", "Text embedding dimension mismatch")
        return embedding
