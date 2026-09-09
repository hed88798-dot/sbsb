#!/usr/bin/env python3
"""Evaluate captured V3 retrieval results without changing the index or Contract.

The worker is intentionally outside this harness.  A result bundle is captured by
the target-platform runner and supplied as JSON.  This keeps the benchmark's
transport, embeddings, and cache fixed while allowing deterministic reporting
experiments (query expansion, route filtering, and species diagnostics).
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any, Iterable

EXPECTED_WORKER_SHA256 = "e56b32c1d547df0391e40a656230cdb2924b8ba6fb94f1b062632c5b1ca05d99"
EXPECTED_TRANSPORT = "direct_utf8_bytes_via_System.Diagnostics.Process"
EXPECTED_EXPANSION_VERSION = "visual-zh-v1"
EXPECTED_GQ006_ASSET_ORDER = [
    "v2_asset_084",
    "v2_asset_085",
    "v2_asset_088",
    "v2_asset_086",
    "v2_asset_065",
]

QUERY_EXPANSIONS = {
    "牛吃料": "牛在料槽前采食饲料",
    "猪吃料": "猪在料槽前采食饲料",
    "羊吃料": "羊在料槽前采食饲料",
    "羊喝水": "羊在饮水槽前喝水",
    "猪打疫苗": "工作人员正在给猪注射疫苗",
    "清理猪圈": "工作人员正在猪舍内清理猪圈",
}

_SPECIES_BY_QUERY = {
    "牛": "cattle",
    "牛吃料": "cattle",
    "牛喝水": "cattle",
    "cattle": "cattle",
    "cattle eating feed": "cattle",
    "cattle drinking water": "cattle",
    "猪": "pig",
    "猪吃料": "pig",
    "猪喝水": "pig",
    "猪打疫苗": "pig",
    "羊": "sheep",
    "羊吃料": "sheep",
    "羊喝水": "sheep",
    "sheep": "sheep",
    "sheep eating feed": "sheep",
    "sheep drinking water": "sheep",
}


def expand_query(query: str) -> tuple[str, str]:
    """Return (expanded query, version), retaining the original separately."""

    return QUERY_EXPANSIONS.get(query, query), EXPECTED_EXPANSION_VERSION


def _candidate_asset_id(candidate: dict[str, Any]) -> str:
    asset_id = candidate.get("asset_id")
    if not isinstance(asset_id, str) or not asset_id:
        raise ValueError("each candidate must contain a non-empty asset_id")
    return asset_id


def unique_asset_top5(candidates: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse shot results to the first five unique assets, preserving rank."""

    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for candidate in candidates:
        asset_id = _candidate_asset_id(candidate)
        if asset_id in seen:
            continue
        seen.add(asset_id)
        result.append(candidate)
        if len(result) == 5:
            break
    return result


def apply_route_filter(
    candidates: Iterable[dict[str, Any]], route: str | None
) -> tuple[list[dict[str, Any]], str]:
    """Filter only on explicit candidate/query route metadata.

    Missing route metadata is deliberately not inferred from filenames or names;
    it is reported as NOT_APPLICABLE so this diagnostic cannot change Contract
    semantics by guessing.
    """

    materialized = list(candidates)
    if route not in {"ANIMAL", "PRODUCT"}:
        return materialized, "NOT_APPLICABLE"
    if any(candidate.get("route") not in {"ANIMAL", "PRODUCT"} for candidate in materialized):
        return materialized, "NOT_APPLICABLE"
    return [candidate for candidate in materialized if candidate["route"] == route], "APPLIED"


def _species_for_query(query: str) -> str | None:
    return _SPECIES_BY_QUERY.get(query)


def classify_species_confusion(
    query: str, candidates: Iterable[dict[str, Any]]
) -> str | None:
    """Classify a sheep/cattle top-result inversion when explicit metadata exists."""

    expected = _species_for_query(query)
    if expected not in {"sheep", "cattle"}:
        return None
    first = next(iter(candidates), None)
    if first is None or not isinstance(first.get("species"), str):
        return None
    actual = first["species"].lower()
    if expected == "sheep" and actual == "cattle":
        return "SHEEP_TO_CATTLE"
    if expected == "cattle" and actual == "sheep":
        return "CATTLE_TO_SHEEP"
    return None


def _validate_scores(candidates: Iterable[dict[str, Any]]) -> None:
    for candidate in candidates:
        score = candidate.get("semantic_score")
        if score is None:
            continue
        if not isinstance(score, (int, float)) or not math.isfinite(float(score)):
            raise ValueError("semantic_score must be a finite number when present")


def _top5_pass(candidates: list[dict[str, Any]], positives: set[str]) -> bool:
    return bool(candidates) and _candidate_asset_id(candidates[0]) in positives


def _wrong_route_count(
    candidates: list[dict[str, Any]], expected_route: str | None
) -> int | str:
    if expected_route not in {"ANIMAL", "PRODUCT"}:
        return "UNKNOWN"
    if any(candidate.get("route") not in {"ANIMAL", "PRODUCT"} for candidate in candidates):
        return "UNKNOWN"
    return sum(candidate["route"] != expected_route for candidate in candidates[:5])


def evaluate_query(record: dict[str, Any]) -> dict[str, Any]:
    original = record.get("original_query", record.get("query"))
    if not isinstance(original, str) or not original:
        raise ValueError("query record must contain original_query")
    expected_expanded, expected_version = expand_query(original)
    expanded = record.get("expanded_query", expected_expanded)
    version = record.get("expansion_version", expected_version)
    if expanded != expected_expanded or version != expected_version:
        raise ValueError(f"query expansion drift for {original!r}")

    positives = record.get("ground_truth_asset_ids", [])
    if not isinstance(positives, list) or not all(isinstance(value, str) for value in positives):
        raise ValueError("ground_truth_asset_ids must be a list of strings")
    expected_route = record.get("route")
    before_record = record.get("before", {})
    after_record = record.get("after", {})
    before_shots = before_record.get("shots", [])
    after_shots = after_record.get("shots", [])
    if not isinstance(before_shots, list) or not isinstance(after_shots, list):
        raise ValueError("before.shots and after.shots must be lists")
    _validate_scores(before_shots)
    _validate_scores(after_shots)
    before_unique = unique_asset_top5(before_shots)
    after_unique = unique_asset_top5(after_shots)
    before_route, before_route_status = apply_route_filter(before_shots, expected_route)
    after_route, after_route_status = apply_route_filter(after_shots, expected_route)
    return {
        "query_id": record.get("query_id"),
        "original_query": original,
        "expanded_query": expanded,
        "expansion_version": version,
        "route": expected_route,
        "top5_shot_before": before_shots[:5],
        "top5_shot_after": after_shots[:5],
        "top5_unique_asset_before": before_unique,
        "top5_unique_asset_after": after_unique,
        "top1_before_pass": _top5_pass(before_unique, set(positives)),
        "top1_after_pass": _top5_pass(after_unique, set(positives)),
        "wrong_route_before": _wrong_route_count(before_unique, expected_route),
        "wrong_route_after": _wrong_route_count(after_unique, expected_route),
        "route_filter_before": before_route_status,
        "route_filter_after": after_route_status,
        "route_filtered_unique_asset_top5": unique_asset_top5(after_route),
        "species_confusion_before": classify_species_confusion(original, before_unique),
        "species_confusion_after": classify_species_confusion(original, after_unique),
    }


def validate_baseline(baseline: dict[str, Any]) -> None:
    if baseline.get("benchmark_version") != "v3":
        raise ValueError("only Golden Benchmark V3 is authoritative")
    if baseline.get("transport") != EXPECTED_TRANSPORT:
        raise ValueError("benchmark must use explicit UTF-8 byte transport")
    if baseline.get("worker", {}).get("sha256") != EXPECTED_WORKER_SHA256:
        raise ValueError("result does not bind the approved Worker")
    corpus = baseline.get("corpus", {})
    golden = baseline.get("golden", {})
    expected = {
        "authorized_real_assets": 100,
        "indexed_assets": 100,
        "shots": 103,
        "canonical_queries": 40,
        "total_searches": 120,
        "search_errors": 0,
    }
    for key, value in expected.items():
        actual = corpus.get(key) if key in corpus else golden.get(key)
        if actual != value:
            raise ValueError(f"baseline {key} must be {value}, got {actual!r}")


def validate_gq006_regression(regression: dict[str, Any]) -> None:
    """Validate the fixed literal-Chinese GQ006 result from a captured bundle."""

    if regression.get("query") != "猪喝水":
        raise ValueError("GQ006 must remain the literal Chinese query 猪喝水")
    if regression.get("transport") != EXPECTED_TRANSPORT:
        raise ValueError("GQ006 must use explicit UTF-8 byte transport")
    if regression.get("worker_sha256") != EXPECTED_WORKER_SHA256:
        raise ValueError("GQ006 is bound to an unexpected Worker")
    if regression.get("status") != "PASS":
        raise ValueError("GQ006 captured status is not PASS")
    assets = regression.get("top5_unique_assets")
    if not isinstance(assets, list):
        raise ValueError("GQ006 must contain top5_unique_assets")
    actual_order = [item.get("asset_id") for item in assets]
    if actual_order != EXPECTED_GQ006_ASSET_ORDER:
        raise ValueError(f"GQ006 Top5 drift: expected {EXPECTED_GQ006_ASSET_ORDER}, got {actual_order}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--results", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    baseline = json.loads(args.baseline.read_text(encoding="utf-8"))
    result_bundle = json.loads(args.results.read_text(encoding="utf-8"))
    validate_baseline(baseline)
    if result_bundle.get("benchmark_version") != "v3":
        raise ValueError("captured results must be V3")
    if result_bundle.get("worker_sha256") != EXPECTED_WORKER_SHA256:
        raise ValueError("captured results bind a different Worker")
    records = result_bundle.get("queries")
    if not isinstance(records, list):
        raise ValueError("captured results must contain a queries list")
    report = {
        "benchmark_version": "v3",
        "transport": EXPECTED_TRANSPORT,
        "worker_sha256": EXPECTED_WORKER_SHA256,
        "query_count": len(records),
        "queries": [evaluate_query(record) for record in records],
        "formal_contract_changed": False,
        "embedding_model_changed": False,
        "code_d_logic_implemented": False,
        "recall_at_5_hard_gate": "NOT_APPLIED",
    }
    encoded = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8")
    else:
        print(encoded, end="")


if __name__ == "__main__":
    main()
