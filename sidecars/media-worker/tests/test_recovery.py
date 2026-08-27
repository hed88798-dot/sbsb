from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from media_worker.pipeline import _checkpoint_shot_valid, _load_checkpoint


class RecoveryTests(unittest.TestCase):
    def test_reuses_only_hash_verified_completed_shots(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "embeddings").mkdir()
            (root / "keyframes").mkdir()
            vector = root / "embeddings" / "shot.f16"
            frame = root / "keyframes" / "frame.jpg"
            vector.write_bytes(b"\0\0\0\0")
            frame.write_bytes(b"jpeg")
            shot = {
                "shot_id": "shot_1",
                "embedding": {
                    "relative_path": "embeddings/shot.f16",
                    "dimension": 2,
                    "sha256": hashlib.sha256(vector.read_bytes()).hexdigest(),
                },
                "keyframes": [
                    {
                        "relative_path": "keyframes/frame.jpg",
                        "sha256": hashlib.sha256(frame.read_bytes()).hexdigest(),
                    }
                ],
            }
            self.assertTrue(_checkpoint_shot_valid(root, shot))
            vector.write_bytes(b"damaged")
            self.assertFalse(_checkpoint_shot_valid(root, shot))

    def test_invalidates_checkpoint_when_generation_inputs_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.json"
            path.write_text(
                json.dumps(
                    {
                        "file_hash": "a" * 64,
                        "shot_detector_params_hash": "b" * 64,
                        "embedding_model_version": "model-v1",
                        "embedding_preprocess_version": "preprocess-v1",
                        "keyframe_policy_version": "safe-mid-best-v1",
                        "probe": {"duration_ms": 1000},
                        "shots": [[0, 1000]],
                    }
                ),
                "utf-8",
            )
            valid = _load_checkpoint(
                path,
                file_hash="a" * 64,
                parameter_hash="b" * 64,
                model_version="model-v1",
                preprocess_version="preprocess-v1",
            )
            self.assertIsNotNone(valid)
            invalid = _load_checkpoint(
                path,
                file_hash="c" * 64,
                parameter_hash="b" * 64,
                model_version="model-v1",
                preprocess_version="preprocess-v1",
            )
            self.assertIsNone(invalid)


if __name__ == "__main__":
    unittest.main()
