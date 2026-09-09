from __future__ import annotations

import argparse
import importlib.metadata
import json
import sys
from pathlib import Path

from packaging.utils import canonicalize_name


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "toolchain-source-lock.json"
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument(
        "--scope",
        choices=["runtime", "worker-build", "model-export", "model-evaluation"],
        action="append",
        required=True,
    )
    arguments = parser.parse_args()
    expected: dict[str, dict[str, object]] = {}
    for scope in arguments.scope:
        inventory = json.loads(
            (
                REPOSITORY_ROOT
                / "compliance"
                / "python-artifacts"
                / arguments.target
                / f"{scope}.v2.json"
            ).read_text(encoding="utf-8")
        )
        for package in inventory["packages"]:
            name = canonicalize_name(package["package_name"])
            previous = expected.get(name)
            if previous and (
                previous["version"] != package["version"] or previous["sha256"] != package["sha256"]
            ):
                raise SystemExit(f"scope union has conflicting wheel identities: {name}")
            expected[name] = package
    source_lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
    pip_lock = source_lock["pip"]
    installed = {
        canonicalize_name(distribution.metadata["Name"]): distribution
        for distribution in importlib.metadata.distributions()
        if distribution.metadata["Name"]
    }
    actual_names = set(installed)
    allowed_names = set(expected) | {"pip"}
    if actual_names != allowed_names:
        raise SystemExit(
            f"installed distribution set drift: missing={sorted(allowed_names - actual_names)} "
            f"unexpected={sorted(actual_names - allowed_names)}"
        )
    for name, package in expected.items():
        distribution = installed[name]
        if distribution.version != package["version"]:
            raise SystemExit(f"installed version drift: {name}")
        direct_url_text = distribution.read_text("direct_url.json")
        if not direct_url_text:
            raise SystemExit(f"installed wheel has no direct_url provenance: {name}")
        direct_url = json.loads(direct_url_text)
        if direct_url.get("url") != package["provenance"]["download_url"]:
            raise SystemExit(f"installed artifact URL drift: {name}")
        archive_hash = direct_url.get("archive_info", {}).get("hash")
        if archive_hash != f"sha256={package['sha256']}":
            raise SystemExit(f"installed artifact hash provenance drift: {name}")
    if installed["pip"].version != pip_lock["version"]:
        raise SystemExit("installed pip differs from toolchain source lock")
    pip_root = Path(installed["pip"].locate_file("pip")).resolve()
    if not pip_root.is_relative_to(Path(sys.prefix).resolve()):
        raise SystemExit("pip import escaped the hermetic venv")
    print(
        f"installed-wheel-provenance: PASS ({arguments.target}; {len(expected)} approved wheels; "
        f"pip {pip_lock['version']})"
    )


if __name__ == "__main__":
    main()
