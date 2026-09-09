from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np


def normalize(values: np.ndarray, axis: int = -1) -> np.ndarray:
    norms = np.linalg.norm(values, axis=axis, keepdims=True)
    if np.any(norms <= 0) or not np.all(np.isfinite(norms)):
        raise SystemExit("fixture contains invalid embeddings")
    return values / norms


def aggregate(frame_embeddings: np.ndarray, selected: np.ndarray) -> np.ndarray:
    shots = []
    for shot_index, sample_indices in enumerate(selected):
        frames = normalize(frame_embeddings[shot_index, sample_indices].astype(np.float32))
        shots.append(normalize(np.mean(frames, axis=0)))
    return np.stack(shots)


def top5_recall(shot_embeddings: np.ndarray, queries: np.ndarray, acceptable: np.ndarray) -> float:
    scores = normalize(queries.astype(np.float32)) @ normalize(shot_embeddings.astype(np.float32)).T
    top = np.argpartition(scores, -min(5, scores.shape[1]), axis=1)[:, -min(5, scores.shape[1]) :]
    hits = [bool(np.any(acceptable[index, candidates])) for index, candidates in enumerate(top)]
    return float(np.mean(hits))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compare 25/50/75 with safe/mid/best on an authorized Golden Set NPZ"
    )
    parser.add_argument("fixture", type=Path)
    arguments = parser.parse_args()
    data = np.load(arguments.fixture, allow_pickle=False)
    frames = data["frame_embeddings"]
    positions = data["frame_positions"]
    quality = data["quality"]
    queries = data["query_embeddings"]
    acceptable = data["acceptable_shots"].astype(bool)
    if frames.ndim != 3 or quality.shape != frames.shape[:2]:
        raise SystemExit("fixture shapes are invalid")
    quartile = np.stack(
        [np.argmin(np.abs(positions - target), axis=1) for target in (0.25, 0.5, 0.75)], axis=1
    )
    safe = np.argmin(np.abs(positions - 0.1), axis=1)
    middle = np.argmin(np.abs(positions - 0.5), axis=1)
    best = np.argmax(quality, axis=1)
    safe_mid_best = np.stack((safe, middle, best), axis=1)
    results = {}
    for name, selected in (("25-50-75", quartile), ("safe-mid-best", safe_mid_best)):
        shots = aggregate(frames, selected)
        results[name] = {
            "top5_recall": top5_recall(shots, queries, acceptable),
            "mean_selected_quality": float(
                np.mean(np.take_along_axis(quality, selected, axis=1))
            ),
            "selected_low_quality_rate": float(
                np.mean(np.take_along_axis(quality, selected, axis=1) < 0.35)
            ),
        }
    print(json.dumps(results, sort_keys=True))


if __name__ == "__main__":
    main()
