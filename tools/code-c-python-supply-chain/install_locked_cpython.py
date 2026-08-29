from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from policy import sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "toolchain-source-lock.json"
)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def safe_member(name: str) -> PurePosixPath:
    path = PurePosixPath(name.replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts:
        raise SystemExit(f"unsafe CPython distribution member: {name}")
    return path


def extract_distribution(distribution: Path, destination: Path, target: str) -> dict[str, str]:
    observed: dict[str, str] = {}
    names: set[str] = set()
    if target == "linux":
        with tarfile.open(distribution, "r:gz") as archive:
            for member in archive.getmembers():
                normalized = safe_member(member.name).as_posix().removeprefix("./")
                if normalized in names:
                    raise SystemExit(f"duplicate CPython distribution member: {member.name}")
                names.add(normalized)
                if normalized in {"setup.sh", "bin/python3.13"}:
                    source = archive.extractfile(member)
                    if source is None:
                        raise SystemExit(f"CPython payload is not a file: {member.name}")
                    observed[normalized] = sha256_bytes(source.read())
            archive.extractall(destination, filter="data")
    else:
        with zipfile.ZipFile(distribution) as archive:
            for member in archive.infolist():
                normalized = safe_member(member.filename).as_posix()
                if normalized in names:
                    raise SystemExit(f"duplicate CPython distribution member: {member.filename}")
                names.add(normalized)
                if normalized in {"setup.ps1", "python-3.13.15-amd64.exe"}:
                    observed[normalized] = sha256_bytes(archive.read(member))
            archive.extractall(destination)
    return observed


def installed_python(lock: dict[str, object], target: str) -> Path:
    root_value = os.environ.get("AGENT_TOOLSDIRECTORY") or os.environ.get("RUNNER_TOOL_CACHE")
    if not root_value:
        raise SystemExit("locked CPython installation requires RUNNER_TOOL_CACHE")
    root = Path(root_value) / "Python" / str(lock["python_version"]) / "x64"
    return root / ("python.exe" if target == "windows" else "bin/python3.13")


def verify_identity(python: Path, expected_version: str) -> dict[str, object]:
    result = subprocess.run(
        [
            str(python),
            "-I",
            "-c",
            (
                "import json, platform, sys; "
                "print(json.dumps({'executable': sys.executable, "
                "'implementation': platform.python_implementation(), "
                "'version': platform.python_version()}))"
            ),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    identity = json.loads(result.stdout)
    if identity["implementation"] != "CPython" or identity["version"] != expected_version:
        raise SystemExit(f"installed interpreter identity mismatch: {identity}")
    return identity


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--distribution", type=Path, required=True)
    parser.add_argument("--pip-wheel", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    actual_target = "windows" if sys.platform == "win32" else "linux" if sys.platform.startswith("linux") else ""
    if arguments.target != actual_target:
        raise SystemExit(f"installer target {arguments.target} differs from host {sys.platform}")

    lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
    distribution_lock = lock["targets"][arguments.target]["cpython_distribution"]
    pip_lock = lock["pip"]
    for path, expected, label in (
        (arguments.distribution, distribution_lock, "CPython distribution"),
        (arguments.pip_wheel, pip_lock, "pip wheel"),
    ):
        if (
            path.name != expected["filename"]
            or path.stat().st_size != expected["size"]
            or sha256_file(path) != expected["sha256"]
        ):
            raise SystemExit(f"{label} differs from source lock")

    with tempfile.TemporaryDirectory(prefix="code-c-locked-cpython-") as directory:
        extracted = Path(directory)
        observed = extract_distribution(arguments.distribution, extracted, arguments.target)
        entry = str(distribution_lock["installer_entry"])
        payload = str(distribution_lock["interpreter_payload"])
        if observed.get(entry) != distribution_lock["installer_entry_sha256"]:
            raise SystemExit("CPython installer entry differs from source lock")
        if observed.get(payload) != distribution_lock["interpreter_payload_sha256"]:
            raise SystemExit("CPython interpreter payload differs from source lock")

        environment = dict(os.environ)
        environment.update(
            {
                "PIP_CONFIG_FILE": os.devnull,
                "PIP_NO_INDEX": "1",
                "PIP_FIND_LINKS": str(arguments.pip_wheel.resolve().parent),
                "PIP_DISABLE_PIP_VERSION_CHECK": "1",
                "PYTHONNOUSERSITE": "1",
            }
        )
        if arguments.target == "windows":
            command = [
                "powershell.exe",
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(extracted / entry),
            ]
        else:
            command = ["bash", str(extracted / entry)]
        subprocess.run(command, cwd=extracted, env=environment, check=True)

    python = installed_python(lock, arguments.target)
    identity = verify_identity(python, str(lock["python_version"]))
    evidence = {
        "schema_version": "1",
        "status": "PASS",
        "target": arguments.target,
        "architecture": "x86_64",
        "distribution": {
            "filename": arguments.distribution.name,
            "sha256": sha256_file(arguments.distribution),
            "size": arguments.distribution.stat().st_size,
            "download_url": distribution_lock["download_url"],
            "canonical_source": distribution_lock["canonical_source"],
        },
        "installer_entry": {"path": entry, "sha256": observed[entry]},
        "interpreter_payload": {"path": payload, "sha256": observed[payload]},
        "bootstrap_pip_cache": {
            "filename": arguments.pip_wheel.name,
            "sha256": sha256_file(arguments.pip_wheel),
            "source": pip_lock["download_url"],
            "scope": "LOCKED_CPYTHON_INSTALLER_BOOTSTRAP_ONLY",
        },
        "installed_interpreter": identity,
        "runner": {
            "image_os": os.environ.get("ImageOS"),
            "image_version": os.environ.get("ImageVersion"),
            "runner_os": os.environ.get("RUNNER_OS"),
            "runner_arch": os.environ.get("RUNNER_ARCH"),
            "host_platform": platform.platform(),
        },
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(canonical_json(evidence), encoding="utf-8")
    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with Path(github_output).open("a", encoding="utf-8") as output:
            output.write(f"python={python}\n")
    print(f"locked-cpython-install: PASS ({arguments.target}; {python})")


if __name__ == "__main__":
    main()
