from __future__ import annotations

import unittest

import numpy as np

from media_worker.contracts import WorkerError
from media_worker.embedding import aggregate_shot_embeddings, normalize, tokenize_siglip_text


class EmbeddingTests(unittest.TestCase):
    def test_normalizes_keyframes_and_aggregated_shot(self) -> None:
        result = aggregate_shot_embeddings(
            [np.array([3.0, 0.0], dtype=np.float32), np.array([0.0, 4.0], dtype=np.float32)]
        )
        self.assertAlmostEqual(float(np.linalg.norm(result)), 1.0, places=6)
        self.assertTrue(np.allclose(result, np.array([2**-0.5, 2**-0.5], dtype=np.float32)))

    def test_rejects_zero_and_non_finite_vectors(self) -> None:
        with self.assertRaisesRegex(WorkerError, "Embedding"):
            normalize(np.zeros(4, dtype=np.float32))
        with self.assertRaises(WorkerError):
            normalize(np.array([np.nan, 1], dtype=np.float32))

    def test_text_tokenization_adds_eos_and_fixed_padding(self) -> None:
        class Tokenizer:
            def encode(self, _text: str, out_type: type[int]) -> list[int]:
                self.assert_type = out_type
                return [5, 6]

            def piece_to_id(self, piece: str) -> int:
                return {"<pad>": 0, "<eos>": 1}[piece]

        inputs = tokenize_siglip_text(Tokenizer(), " 猪群采食 ", max_length=5)
        self.assertEqual(inputs["input_ids"].tolist(), [[5, 6, 1, 0, 0]])
        self.assertEqual(set(inputs), {"input_ids"})


if __name__ == "__main__":
    unittest.main()
