from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def normalize(values: np.ndarray) -> np.ndarray:
    return values / np.linalg.norm(values, axis=-1, keepdims=True)


def recall(vectors: np.ndarray, queries: np.ndarray, acceptable: np.ndarray) -> float:
    scores = normalize(queries.astype(np.float32)) @ normalize(vectors.astype(np.float32)).T
    count = min(5, scores.shape[1])
    top = np.argpartition(scores, -count, axis=1)[:, -count:]
    return float(np.mean([np.any(acceptable[index, row]) for index, row in enumerate(top)]))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Gate PyTorch/ONNX/INT8 Top-5 retrieval regression using a fixed Golden Set"
    )
    parser.add_argument("fixture", type=Path)
    arguments = parser.parse_args()
    data = np.load(arguments.fixture, allow_pickle=False)
    baseline = recall(data["fp32_vectors"], data["query_vectors"], data["acceptable_shots"])
    onnx = recall(data["onnx_vectors"], data["query_vectors"], data["acceptable_shots"])
    result: dict[str, object] = {
        "fp32_top5": baseline,
        "onnx_top5": onnx,
        "onnx_delta_percentage_points": (onnx - baseline) * 100,
        "onnx_pass": onnx >= baseline - 0.02,
    }
    if "int8_vectors" in data:
        int8 = recall(data["int8_vectors"], data["query_vectors"], data["acceptable_shots"])
        result.update(
            {
                "int8_top5": int8,
                "int8_delta_percentage_points": (int8 - baseline) * 100,
                "int8_pass": int8 >= baseline - 0.02,
            }
        )
    print(json.dumps(result, sort_keys=True))
    if not result["onnx_pass"] or result.get("int8_pass") is False:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
