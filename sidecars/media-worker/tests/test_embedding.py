from __future__ import annotations

import os
import unittest
from pathlib import Path

import numpy as np

from media_worker.contracts import WorkerError
from media_worker.embedding import SiglipOnnx, aggregate_shot_embeddings, normalize, tokenize_siglip_text


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

    def test_text_tokenization_runtime_failure_is_not_request_invalid(self) -> None:
        class BrokenTokenizer:
            def encode(self, _text: str, out_type: type[int]) -> list[int]:
                raise ValueError("native tokenizer failure")

        with self.assertRaises(WorkerError) as context:
            tokenize_siglip_text(BrokenTokenizer(), "猪场")
        self.assertEqual(context.exception.code, "TOKENIZER_RUNTIME_ERROR")
        self.assertIn("ValueError", context.exception.message)

    def test_text_tokenization_rejects_non_string_request(self) -> None:
        with self.assertRaises(WorkerError) as context:
            tokenize_siglip_text(object(), 123)  # type: ignore[arg-type]
        self.assertEqual(context.exception.code, "QUERY_TEXT_INVALID")

    def test_text_session_contract_requires_frozen_input(self) -> None:
        class InputInfo:
            name = "input_ids"
            type = "tensor(int64)"
            shape = ["batch", 64]

        class Session:
            def get_inputs(self) -> list[InputInfo]:
                return [InputInfo()]

        SiglipOnnx._validate_text_session_contract(Session())

    def test_text_session_value_error_is_reported_as_model_runtime_error(self) -> None:
        class Tokenizer:
            def encode(self, _text: str, out_type: type[int]) -> list[int]:
                return [5]

            def piece_to_id(self, piece: str) -> int:
                return {"<pad>": 0, "<eos>": 1}[piece]

        class Session:
            def run(self, _outputs: object, _inputs: dict[str, np.ndarray]) -> list[np.ndarray]:
                raise ValueError("ORT execution failure")

        model = object.__new__(SiglipOnnx)
        model._text_session = Session()
        model._tokenizer = Tokenizer()
        model._dimension = 768
        with self.assertRaises(WorkerError) as context:
            model.text_embedding("猪场")
        self.assertEqual(context.exception.code, "MODEL_RUNTIME_ERROR")
        self.assertIn("ValueError", context.exception.message)

    @unittest.skipUnless(
        os.environ.get("CODE_C_REAL_MODEL_ROOT"),
        "requires the approved real SigLIP model pack",
    )
    def test_real_model_pack_text_encoder_and_sentencepiece(self) -> None:
        model = SiglipOnnx(Path(os.environ["CODE_C_REAL_MODEL_ROOT"]), 768)
        embedding = model.text_embedding("猪场")
        self.assertEqual(embedding.shape, (768,))
        self.assertTrue(np.all(np.isfinite(embedding)))
        self.assertAlmostEqual(float(np.linalg.norm(embedding)), 1.0, places=5)


if __name__ == "__main__":
    unittest.main()
