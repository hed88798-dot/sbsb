from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import numpy as np

from media_worker.contracts import WorkerError
from media_worker.search import ExactSearchCache


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class SearchTests(unittest.TestCase):
    def create_cache(self, root: Path) -> str:
        signature = "a" * 64
        generation = root / "generation_test"
        generation.mkdir()
        matrix = np.array([[1, 0, 0, 0], [0, 1, 0, 0], [-1, 0, 0, 0]], dtype="<f2")
        matrix_path = generation / "matrix.f16"
        matrix.tofile(matrix_path)
        rows = {
            "schema_version": "1.0",
            "generation_id": "generation_test",
            "signature_hash": signature,
            "dimension": 4,
            "rows": [
                {"shot_id": "shot_a", "asset_id": "asset_a", "revision": 1, "start_ms": 0, "end_ms": 1000},
                {"shot_id": "shot_b", "asset_id": "asset_b", "revision": 1, "start_ms": 1000, "end_ms": 2000},
                {"shot_id": "shot_c", "asset_id": "asset_c", "revision": 1, "start_ms": 2000, "end_ms": 3000},
            ],
        }
        row_path = generation / "rows.json"
        row_path.write_text(json.dumps(rows, sort_keys=True, separators=(",", ":")), "utf-8")
        manifest = {
            "schema_version": "1.0",
            "generation_id": "generation_test",
            "signature_hash": signature,
            "dimension": 4,
            "row_count": 3,
            "matrix_file": "matrix.f16",
            "matrix_sha256": sha256(matrix_path),
            "row_map_file": "rows.json",
            "row_map_sha256": sha256(row_path),
            "created_at": "2026-08-27T00:00:00.000Z",
        }
        (generation / "manifest.json").write_text(json.dumps(manifest), "utf-8")
        (root / "active.json").write_text(
            json.dumps({"generation_id": "generation_test", "signature_hash": signature}), "utf-8"
        )
        return signature

    def test_exact_search_returns_shot_range_and_float32_score(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            signature = self.create_cache(root)
            cache = ExactSearchCache(root, signature)
            results = cache.search(np.array([1, 0, 0, 0], dtype=np.float32), top_k=2, chunk_rows=1)
            self.assertEqual(results[0]["shot_id"], "shot_a")
            self.assertEqual(results[0]["start_ms"], 0)
            self.assertEqual(results[0]["end_ms"], 1000)
            self.assertAlmostEqual(results[0]["semantic_score"], 1.0, places=6)

    def test_signature_and_row_mapping_mismatch_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            signature = self.create_cache(root)
            with self.assertRaisesRegex(WorkerError, "signature"):
                ExactSearchCache(root, "b" * 64)
            matrix_path = root / "generation_test" / "matrix.f16"
            matrix_path.write_bytes(b"\0\0")
            with self.assertRaises(WorkerError):
                ExactSearchCache(root, signature)


if __name__ == "__main__":
    unittest.main()
