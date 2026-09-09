from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

from policy import assert_exact_wheel_url, sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "toolchain-source-lock.json"
)


def fetch(entry: dict[str, object], destination: Path, *, wheel: bool) -> None:
    url = str(entry["download_url"])
    if wheel:
        assert_exact_wheel_url(url)
    elif not url.startswith(
        "https://github.com/actions/python-versions/releases/download/3.13.15-31064747964/"
    ):
        raise SystemExit(f"unapproved CPython distribution source: {url}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not destination.is_file() or sha256_file(destination) != entry["sha256"]:
        request = urllib.request.Request(url, headers={"Accept": "application/octet-stream"})
        with urllib.request.urlopen(request, timeout=120) as response:
            destination.write_bytes(response.read())
    if (
        destination.name != entry["filename"]
        or destination.stat().st_size != entry["size"]
        or sha256_file(destination) != entry["sha256"]
    ):
        raise SystemExit(f"toolchain artifact failed exact identity verification: {destination.name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    arguments = parser.parse_args()
    lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
    target = lock["targets"][arguments.target]
    entries = [
        (target["cpython_distribution"], False),
        (lock["pip"], True),
        (target["pyinstaller"], True),
    ]
    for entry, wheel in entries:
        fetch(entry, arguments.output_root / arguments.target / entry["filename"], wheel=wheel)
    print(f"toolchain-source-download: PASS ({arguments.target}; 3 exact artifacts)")


if __name__ == "__main__":
    main()
