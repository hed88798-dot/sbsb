from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from policy import hermetic_environment


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument(
        "--scope",
        choices=["runtime", "worker-build", "model-export", "model-evaluation"],
        action="append",
        required=True,
    )
    arguments = parser.parse_args()
    try:
        environment = hermetic_environment()
    except ValueError as error:
        raise SystemExit(str(error)) from error
    command = [
        str(arguments.python),
        "-I",
        "-m",
        "pip",
        "install",
        "--isolated",
        "--disable-pip-version-check",
        "--no-index",
        "--no-cache-dir",
        "--no-deps",
        "--only-binary=:all:",
        "--require-hashes",
    ]
    for scope in arguments.scope:
        lock = (
            REPOSITORY_ROOT
            / "sidecars"
            / "media-worker"
            / "supply-chain"
            / "locks"
            / f"{arguments.target}-{scope}.requirements.txt"
        )
        if not lock.is_file():
            raise SystemExit(f"approved lock is missing: {lock}")
        command.extend(["--requirement", str(lock)])
    result = subprocess.run(
        command,
        cwd=REPOSITORY_ROOT,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise SystemExit(result.stderr.strip() or result.stdout.strip() or "approved install failed")
    print(
        f"approved-wheel-install: PASS ({arguments.target}; {len(arguments.scope)} scopes; "
        "pinned pip/binary-only/--require-hashes/no-index/no-cache/no-deps)"
    )


if __name__ == "__main__":
    main()
