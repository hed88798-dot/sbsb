from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

from policy import hermetic_environment, sha256_file


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, action="append", required=True)
    parser.add_argument("--wheel-root", type=Path, action="append", required=True)
    arguments = parser.parse_args()
    if len(arguments.candidate) != len(arguments.wheel_root):
        raise SystemExit("each candidate must have one matching wheel root")
    try:
        environment = hermetic_environment()
    except ValueError as error:
        raise SystemExit(str(error)) from error
    requirements = []
    identities: set[tuple[str, str]] = set()
    for candidate_path, wheel_root in zip(arguments.candidate, arguments.wheel_root, strict=True):
        candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
        if candidate.get("schema_version") not in {"2", "3"} or candidate.get("graph_complete") is not True:
            raise SystemExit("candidate installer requires a complete Inventory v2/v3 candidate")
        for package in candidate["packages"]:
            wheel = (wheel_root / package["artifact_path"]).resolve()
            if not wheel.is_relative_to(wheel_root.resolve()):
                raise SystemExit(f"candidate wheel path escapes its explicit wheel root: {wheel}")
            if wheel.name != package["filename"] or sha256_file(wheel) != package["sha256"]:
                raise SystemExit(f"candidate wheel identity mismatch: {package['filename']}")
            identity = (package["purl"], package["sha256"])
            if identity in identities:
                continue
            identities.add(identity)
            requirements.append(f"{wheel.as_uri()} --hash=sha256:{package['sha256']}")
    with tempfile.TemporaryDirectory(prefix="code-c-candidate-install-") as directory:
        requirements_path = Path(directory) / "requirements.txt"
        requirements_path.write_text(
            "--only-binary=:all:\n" + "\n".join(sorted(requirements)) + "\n",
            encoding="utf-8",
        )
        result = subprocess.run(
            [
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
                "--requirement",
                str(requirements_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            env=environment,
        )
    if result.returncode:
        raise SystemExit(result.stderr.strip() or result.stdout.strip() or "candidate install failed")
    print(f"candidate-install: PASS ({len(identities)} exact wheels; --require-hashes)")


if __name__ == "__main__":
    main()
