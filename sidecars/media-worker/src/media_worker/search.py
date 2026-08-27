from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from .contracts import WorkerError, require_contained_file, sha256_file
from .embedding import normalize


class ExactSearchCache:
    def __init__(self, cache_root: Path, expected_signature: str) -> None:
        try:
            active: dict[str, Any] = json.loads((cache_root / "active.json").read_text("utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise WorkerError("CACHE_MISSING", "Search cache is unavailable", True) from error
        if active.get("signature_hash") != expected_signature:
            raise WorkerError("CACHE_SIGNATURE_MISMATCH", "Search cache signature mismatch", True)
        generation_id = active.get("generation_id")
        if not isinstance(generation_id, str) or Path(generation_id).name != generation_id:
            raise WorkerError("CACHE_GENERATION_INVALID", "Search cache generation is invalid", True)
        generation_root = cache_root / generation_id
        try:
            manifest = json.loads((generation_root / "manifest.json").read_text("utf-8"))
            rows_document = json.loads(
                require_contained_file(generation_root, manifest["row_map_file"]).read_text("utf-8")
            )
        except (OSError, KeyError, json.JSONDecodeError) as error:
            raise WorkerError("CACHE_MANIFEST_INVALID", "Search cache manifest is invalid", True) from error
        if manifest.get("signature_hash") != expected_signature:
            raise WorkerError("CACHE_SIGNATURE_MISMATCH", "Search cache manifest mismatch", True)
        row_path = require_contained_file(generation_root, manifest["row_map_file"])
        matrix_path = require_contained_file(generation_root, manifest["matrix_file"])
        if sha256_file(row_path) != manifest.get("row_map_sha256"):
            raise WorkerError("CACHE_ROW_MAP_HASH_MISMATCH", "Search row map is damaged", True)
        if sha256_file(matrix_path) != manifest.get("matrix_sha256"):
            raise WorkerError("CACHE_MATRIX_HASH_MISMATCH", "Search matrix is damaged", True)
        self.rows: list[dict[str, Any]] = rows_document.get("rows", [])
        self.dimension = int(manifest.get("dimension", 0))
        row_count = int(manifest.get("row_count", -1))
        if (
            rows_document.get("generation_id") != generation_id
            or rows_document.get("signature_hash") != expected_signature
            or rows_document.get("dimension") != self.dimension
        ):
            raise WorkerError("CACHE_ROW_MAPPING_MISMATCH", "Vector rows do not match generation", True)
        expected_bytes = row_count * self.dimension * np.dtype("<f2").itemsize
        if row_count != len(self.rows) or matrix_path.stat().st_size != expected_bytes:
            raise WorkerError("CACHE_ROW_MAPPING_MISMATCH", "Vector rows do not match Shot rows", True)
        shot_ids: set[str] = set()
        for row in self.rows:
            try:
                shot_id = str(row["shot_id"])
                valid_range = int(row["start_ms"]) >= 0 and int(row["end_ms"]) > int(row["start_ms"])
                valid_revision = int(row["revision"]) > 0
            except (KeyError, TypeError, ValueError) as error:
                raise WorkerError("CACHE_ROW_MAPPING_MISMATCH", "Search row is invalid", True) from error
            if not shot_id or shot_id in shot_ids or not valid_range or not valid_revision:
                raise WorkerError("CACHE_ROW_MAPPING_MISMATCH", "Search row is invalid", True)
            shot_ids.add(shot_id)
        self.matrix_path = matrix_path
        self.row_count = row_count

    def search(
        self,
        query: np.ndarray,
        top_k: int,
        chunk_rows: int = 4096,
        allowed_shot_ids: set[str] | None = None,
    ) -> list[dict[str, Any]]:
        normalized_query = normalize(query)
        if normalized_query.size != self.dimension:
            raise WorkerError("QUERY_DIMENSION_MISMATCH", "Text embedding dimension mismatch")
        if not 1 <= top_k <= 1000:
            raise WorkerError("QUERY_TOP_K_INVALID", "top_k is outside the supported range")
        matrix = np.memmap(
            self.matrix_path,
            dtype="<f2",
            mode="r",
            shape=(self.row_count, self.dimension),
        )
        try:
            best_indices = np.empty(0, dtype=np.int64)
            best_scores = np.empty(0, dtype=np.float32)
            for start in range(0, len(self.rows), chunk_rows):
                stop = min(start + chunk_rows, len(self.rows))
                chunk = np.asarray(matrix[start:stop], dtype=np.float32)
                scores = chunk @ normalized_query.astype(np.float32, copy=False)
                if allowed_shot_ids is not None:
                    allowed = np.fromiter(
                        (
                            self.rows[index]["shot_id"] in allowed_shot_ids
                            for index in range(start, stop)
                        ),
                        dtype=bool,
                        count=stop - start,
                    )
                    scores = np.where(allowed, scores, -np.inf)
                indices = np.arange(start, stop, dtype=np.int64)
                merged_scores = np.concatenate((best_scores, scores))
                merged_indices = np.concatenate((best_indices, indices))
                keep = min(top_k, merged_scores.size)
                selected = np.argpartition(merged_scores, -keep)[-keep:]
                best_scores = merged_scores[selected]
                best_indices = merged_indices[selected]
        finally:
            if matrix._mmap is not None:
                matrix._mmap.close()
        order = np.argsort(-best_scores, kind="stable")
        return [
            {**self.rows[int(best_indices[index])], "semantic_score": float(best_scores[index])}
            for index in order
            if np.isfinite(best_scores[index])
        ]
