from __future__ import annotations

import argparse
import json
import tempfile
import time
from pathlib import Path

import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=50_000)
    parser.add_argument("--dimension", type=int, default=768)
    parser.add_argument("--queries", type=int, default=30)
    parser.add_argument("--seed", type=int, default=20260827)
    arguments = parser.parse_args()
    random = np.random.default_rng(arguments.seed)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "matrix.f16"
        with path.open("wb") as output:
            for start in range(0, arguments.rows, 4096):
                count = min(4096, arguments.rows - start)
                matrix = random.normal(size=(count, arguments.dimension)).astype(np.float32)
                matrix /= np.linalg.norm(matrix, axis=1, keepdims=True)
                output.write(matrix.astype("<f2").tobytes())
        del matrix
        mapped = np.memmap(path, dtype="<f2", mode="r", shape=(arguments.rows, arguments.dimension))
        query_times: list[float] = []
        for _ in range(arguments.queries):
            query = random.normal(size=arguments.dimension).astype(np.float32)
            query /= np.linalg.norm(query)
            started = time.perf_counter()
            top_scores = np.empty(0, dtype=np.float32)
            for start in range(0, arguments.rows, 4096):
                scores = np.asarray(mapped[start : start + 4096], dtype=np.float32) @ query
                keep = min(20, top_scores.size + scores.size)
                top_scores = np.partition(np.concatenate((top_scores, scores)), -keep)[-keep:]
            query_times.append((time.perf_counter() - started) * 1000)
        values = np.asarray(query_times)
        print(
            json.dumps(
                {
                    "rows": arguments.rows,
                    "dimension": arguments.dimension,
                    "queries": arguments.queries,
                    "p50_ms": float(np.percentile(values, 50)),
                    "p95_ms": float(np.percentile(values, 95)),
                    "max_ms": float(np.max(values)),
                    "pass_under_200ms": bool(np.percentile(values, 95) < 200),
                },
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
