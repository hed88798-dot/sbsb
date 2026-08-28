from __future__ import annotations

import argparse
import shutil
import zipfile
from pathlib import Path, PurePosixPath


def safe_relative_path(name: str) -> Path:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise SystemExit(f"wheel contains unsafe path: {name}")
    return Path(*path.parts)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wheel", type=Path)
    parser.add_argument("site_packages", type=Path)
    arguments = parser.parse_args()
    arguments.site_packages.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(arguments.wheel) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise SystemExit(f"wheel contains duplicate archive paths: {arguments.wheel.name}")
        for entry in archive.infolist():
            relative = safe_relative_path(entry.filename)
            if entry.is_dir():
                continue
            target = arguments.site_packages / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(entry) as source, target.open("wb") as destination:
                shutil.copyfileobj(source, destination)


if __name__ == "__main__":
    main()
