from __future__ import annotations

import importlib.util
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).parents[2]
MODULE_PATH = ROOT / "tests/performance/real_retrieval_v3_harness.py"
SPEC = importlib.util.spec_from_file_location("real_retrieval_v3_harness", MODULE_PATH)
assert SPEC and SPEC.loader
HARNESS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(HARNESS)


class RealRetrievalV3HarnessTests(unittest.TestCase):
    def test_expansion_is_deterministic_and_versioned(self) -> None:
        self.assertEqual(
            HARNESS.expand_query("牛吃料"),
            ("牛在料槽前采食饲料", "visual-zh-v1"),
        )
        self.assertEqual(HARNESS.expand_query("猪喝水"), ("猪喝水", "visual-zh-v1"))

    def test_unique_asset_view_deduplicates_shots(self) -> None:
        candidates = [
            {"shot_id": "s1", "asset_id": "a1"},
            {"shot_id": "s2", "asset_id": "a1"},
            {"shot_id": "s3", "asset_id": "a2"},
            {"shot_id": "s4", "asset_id": "a3"},
            {"shot_id": "s5", "asset_id": "a4"},
            {"shot_id": "s6", "asset_id": "a5"},
            {"shot_id": "s7", "asset_id": "a6"},
        ]
        self.assertEqual(
            [item["asset_id"] for item in HARNESS.unique_asset_top5(candidates)],
            ["a1", "a2", "a3", "a4", "a5"],
        )

    def test_route_filter_requires_explicit_metadata(self) -> None:
        candidates = [{"asset_id": "a1", "route": "PRODUCT"}]
        filtered, status = HARNESS.apply_route_filter(candidates, "ANIMAL")
        self.assertEqual(status, "APPLIED")
        self.assertEqual(filtered, [])
        _, missing_status = HARNESS.apply_route_filter([{"asset_id": "a1"}], "ANIMAL")
        self.assertEqual(missing_status, "NOT_APPLICABLE")

    def test_species_diagnostic_never_guesses_without_metadata(self) -> None:
        self.assertIsNone(
            HARNESS.classify_species_confusion("羊喝水", [{"asset_id": "a1"}])
        )
        self.assertEqual(
            HARNESS.classify_species_confusion(
                "羊喝水", [{"asset_id": "a1", "species": "cattle"}]
            ),
            "SHEEP_TO_CATTLE",
        )

    def test_gq006_fixture_is_fixed_to_worker_and_transport(self) -> None:
        fixture = json.loads(
            (ROOT / "tests/fixtures/real-retrieval/gq006-pig-drinking-water.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(fixture["query_id"], "GQ006")
        self.assertEqual(fixture["query"], "猪喝水")
        self.assertEqual(fixture["status"], "PASS")
        self.assertEqual(fixture["worker_sha256"], HARNESS.EXPECTED_WORKER_SHA256)
        self.assertEqual(fixture["transport"], HARNESS.EXPECTED_TRANSPORT)
        self.assertFalse(fixture["filename_used_for_retrieval"])
        HARNESS.validate_gq006_regression(fixture)

    def test_baseline_schema_and_v3_only_authority(self) -> None:
        baseline = json.loads(
            (ROOT / "tests/fixtures/real-retrieval/code-c-v3-golden-baseline.json").read_text(
                encoding="utf-8"
            )
        )
        HARNESS.validate_baseline(baseline)
        self.assertEqual(baseline["validity"]["authoritative_benchmark"], "V3_ONLY")
        self.assertEqual(baseline["scope"]["500_corpus"], "NOT_RUN")


if __name__ == "__main__":
    unittest.main()
