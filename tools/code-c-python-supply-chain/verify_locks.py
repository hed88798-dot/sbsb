from __future__ import annotations

import argparse
import json
from pathlib import Path

from policy import assert_exact_wheel_url, sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def expected_lock(inventory: dict[str, object]) -> str:
    packages = sorted(inventory["packages"], key=lambda item: item["purl"])
    lines = [
        "# Generated from an APPROVED Python Artifact Inventory. Do not edit hashes in CI.",
        "# Install with: python -m pip install --require-hashes --no-deps -r <this-file>",
        "--only-binary=:all:",
    ]
    for package in packages:
        url = package["provenance"]["download_url"]
        assert_exact_wheel_url(url)
        lines.append(f"{package['package_name']} @ {url} --hash=sha256:{package['sha256']}")
    return "\n".join(lines) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    arguments = parser.parse_args()
    inventories = sorted(
        (REPOSITORY_ROOT / "compliance" / "python-artifacts" / arguments.target).glob("*.json")
    )
    verified = 0
    for path in inventories:
        inventory = json.loads(path.read_text(encoding="utf-8"))
        scope_name = path.name.removesuffix(".v2.json")
        lock_path = (
            REPOSITORY_ROOT
            / "sidecars"
            / "media-worker"
            / "supply-chain"
            / "locks"
            / f"{arguments.target}-{scope_name}.requirements.txt"
        )
        if lock_path.read_text(encoding="utf-8") != expected_lock(inventory):
            raise SystemExit(f"committed --require-hashes lock drift: {lock_path}")
        for package in inventory["packages"]:
            wheel = arguments.artifact_root / package["artifact_path"]
            if wheel.name != package["filename"] or sha256_file(wheel) != package["sha256"]:
                raise SystemExit(f"lock artifact bytes drift: {package['purl']}")
        verified += 1
    if verified == 0:
        raise SystemExit(f"no committed inventory locks for {arguments.target}")
    print(f"require-hashes-lock-verify: PASS ({arguments.target}; {verified} complete scope locks)")


if __name__ == "__main__":
    main()
