from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import venv
import zipfile
from pathlib import Path, PurePosixPath

from policy import hermetic_environment, sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "toolchain-source-lock.json"
)


def safe_extract(wheel: Path, destination: Path) -> None:
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise SystemExit("pinned pip wheel contains duplicate archive paths")
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or ".." in path.parts or "\\" in entry.filename:
                raise SystemExit(f"pinned pip wheel contains unsafe path: {entry.filename}")
            if entry.is_dir():
                continue
            target = destination.joinpath(*path.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(entry))


def venv_python(root: Path) -> Path:
    return root / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wheel", type=Path, required=True)
    parser.add_argument("--venv", type=Path, required=True)
    arguments = parser.parse_args()
    environment = hermetic_environment()
    lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))["pip"]
    if arguments.wheel.name != lock["filename"]:
        raise SystemExit("pinned pip wheel filename differs from the approved source lock")
    if sha256_file(arguments.wheel) != lock["sha256"]:
        raise SystemExit("pinned pip wheel hash differs from the approved source lock")

    venv.EnvBuilder(with_pip=False, clear=True).create(arguments.venv)
    python = venv_python(arguments.venv)
    purelib = subprocess.run(
        [str(python), "-I", "-c", "import sysconfig; print(sysconfig.get_path('purelib'))"],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    ).stdout.strip()
    safe_extract(arguments.wheel, Path(purelib))
    result = subprocess.run(
        [str(python), "-I", "-m", "pip", "--version"],
        check=True,
        capture_output=True,
        text=True,
        env=environment,
    )
    match = re.fullmatch(r"pip ([^ ]+) from (.+) \(python [^)]+\)\s*", result.stdout)
    imported_path = Path(match.group(2)).resolve() if match else None
    if (
        not match
        or match.group(1) != lock["version"]
        or imported_path is None
        or not imported_path.is_relative_to(Path(purelib).resolve())
    ):
        raise SystemExit(f"pinned pip import escaped the hermetic venv: {result.stdout.strip()}")
    print(f"pinned-pip-bootstrap: PASS ({lock['version']}; {python})")


if __name__ == "__main__":
    main()
