from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from PyInstaller.archive.writers import CArchiveWriter


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--bootloader", required=True, type=Path)
    parser.add_argument("--entry", action="append", default=[])
    arguments = parser.parse_args()
    entries = []
    for value in arguments.entry:
        internal_path, source_path = value.split("=", 1)
        entries.append((internal_path, source_path, True, "b"))
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / "fixture.pkg"
        CArchiveWriter(str(archive), entries, "python312.dll")
        arguments.output.write_bytes(arguments.bootloader.read_bytes() + archive.read_bytes())


if __name__ == "__main__":
    main()
