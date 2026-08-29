from __future__ import annotations

import argparse
import subprocess
import tempfile
from pathlib import Path

from policy import (
    PIP_CONFIG_PATH,
    assert_approved_pip_environment,
    assert_intake_reference,
    assert_standard_cp313_artifact,
    hermetic_environment,
)


def expect_rejected(action, label: str) -> None:
    try:
        action()
    except ValueError:
        return
    raise SystemExit(f"negative control was not rejected: {label}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--wheel", type=Path, required=True)
    arguments = parser.parse_args()

    assert_approved_pip_environment({"PIP_CONFIG_FILE": str(PIP_CONFIG_PATH)})
    expect_rejected(
        lambda: assert_approved_pip_environment({"PIP_CONFIG_FILE": "/unapproved/pip.conf"}),
        "user pip.conf",
    )
    expect_rejected(
        lambda: assert_approved_pip_environment({"PIP_EXTRA_INDEX_URL": "https://mirror.invalid"}),
        "extra index environment",
    )
    for reference, label in (
        ("https://files.pythonhosted.org/packages/source.tar.gz", "sdist"),
        ("git+https://example.invalid/repository.git", "VCS"),
        ("https://files.pythonhosted.org/packages/latest.whl", "floating URL"),
        ("../local-package.whl", "local path"),
    ):
        expect_rejected(lambda value=reference: assert_intake_reference(value), label)
    assert_standard_cp313_artifact("synthetic-1.0.0-cp313-cp313-win_amd64.whl")
    assert_standard_cp313_artifact("synthetic-1.0.0-py3-none-any.whl")
    expect_rejected(
        lambda: assert_standard_cp313_artifact(
            "synthetic-1.0.0-cp313-cp313t-win_amd64.whl"
        ),
        "cp313t ABI",
    )
    expect_rejected(
        lambda: assert_standard_cp313_artifact(
            "synthetic-1.0.0-cp313t-cp313t-manylinux_2_28_x86_64.whl"
        ),
        "cp313t interpreter",
    )

    environment = hermetic_environment({"PIP_CONFIG_FILE": str(PIP_CONFIG_PATH)})
    with tempfile.TemporaryDirectory(prefix="code-c-wrong-hash-") as directory:
        requirement = Path(directory) / "wrong-hash.txt"
        requirement.write_text(
            f"{arguments.wheel.resolve().as_uri()} "
            f"--hash=sha256:{'0' * 64}\n",
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
                str(requirement),
            ],
            check=False,
            capture_output=True,
            text=True,
            env=environment,
        )
    combined = f"{result.stdout}\n{result.stderr}".lower()
    if result.returncode == 0 or "hash" not in combined:
        raise SystemExit("wrong-hash installation did not fail closed")
    print(
        "python-supply-chain-negative-controls: PASS "
        "(pip config/index, sdist, VCS, floating, local, cp313t, wrong hash rejected)"
    )


if __name__ == "__main__":
    main()
