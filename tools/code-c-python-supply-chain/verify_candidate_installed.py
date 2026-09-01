from __future__ import annotations

import argparse
import importlib.metadata
import json
import sys
from pathlib import Path

from packaging.utils import canonicalize_name


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, action="append")
    parser.add_argument(
        "--scope",
        choices=["runtime", "worker-build", "model-export", "model-evaluation"],
        action="append",
        required=True,
    )
    arguments = parser.parse_args()

    expected: dict[str, dict[str, object]] = {}
    candidate_paths = arguments.candidate
    if candidate_paths is None:
        candidate_paths = []
        for scope in arguments.scope:
            candidates = sorted(
                (arguments.bundle / "candidates").glob(
                    f"code-c-{arguments.target}-{scope}.v[23].json"
                )
            )
            if len(candidates) != 1:
                raise SystemExit(
                    f"expected one complete candidate for {arguments.target}/{scope}, got {len(candidates)}"
                )
            candidate_paths.append(candidates[0])
    if len(candidate_paths) != len(arguments.scope):
        raise SystemExit("--candidate count must equal --scope count")
    for candidate_path in candidate_paths:
        candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
        if candidate.get("schema_version") not in {"2", "3"} or candidate.get("graph_complete") is not True:
            raise SystemExit("candidate installation verifier requires a complete Inventory v2/v3 candidate")
        for package in candidate["packages"]:
            name = canonicalize_name(str(package["package_name"]))
            previous = expected.get(name)
            if previous and (
                previous["version"] != package["version"]
                or previous["sha256"] != package["sha256"]
            ):
                raise SystemExit(f"candidate scope union has conflicting artifact: {name}")
            expected[name] = package

    installed = {
        canonicalize_name(distribution.metadata["Name"]): distribution
        for distribution in importlib.metadata.distributions()
        if distribution.metadata["Name"]
    }
    actual_names = set(installed)
    allowed_names = set(expected) | {"pip"}
    if actual_names != allowed_names:
        raise SystemExit(
            "candidate installed distribution set drift: "
            f"missing={sorted(allowed_names - actual_names)} "
            f"unexpected={sorted(actual_names - allowed_names)}"
        )

    for name, package in expected.items():
        distribution = installed[name]
        if distribution.version != package["version"]:
            raise SystemExit(f"candidate installed version drift: {name}")
        direct_url_text = distribution.read_text("direct_url.json")
        if not direct_url_text:
            raise SystemExit(f"candidate installed wheel has no direct_url provenance: {name}")
        direct_url = json.loads(direct_url_text)
        if not str(direct_url.get("url", "")).startswith("file:"):
            raise SystemExit(f"candidate install did not consume a reviewed local wheel: {name}")
        archive_hash = direct_url.get("archive_info", {}).get("hash")
        if archive_hash != f"sha256={package['sha256']}":
            raise SystemExit(f"candidate installed artifact hash drift: {name}")

    print(
        f"candidate-installed-provenance: PASS ({arguments.target}; "
        f"{len(expected)} exact wheels; Python {sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro})"
    )


if __name__ == "__main__":
    main()
