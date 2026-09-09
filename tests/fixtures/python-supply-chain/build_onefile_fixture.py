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
    parser.add_argument("--symlink", action="append", default=[])
    parser.add_argument("--malformed-symlink", action="append", default=[])
    arguments = parser.parse_args()
    entries = []
    for value in arguments.entry:
        internal_path, source_path = value.split("=", 1)
        entries.append((internal_path, source_path, True, "b"))
    for value in arguments.symlink + arguments.malformed_symlink:
        internal_path, target = value.split("=", 1)
        entries.append((internal_path, target, False, "n"))
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / "fixture.pkg"
        CArchiveWriter(str(archive), entries, "python312.dll")
        archive_bytes = archive.read_bytes()
        for value in arguments.malformed_symlink:
            _, target = value.split("=", 1)
            valid_payload = target.encode("utf-8") + b"\0"
            malformed_payload = target.encode("utf-8") + b"!"
            if valid_payload not in archive_bytes:
                raise SystemExit("malformed symlink fixture could not locate payload")
            archive_bytes = archive_bytes.replace(valid_payload, malformed_payload, 1)
        arguments.output.write_bytes(arguments.bootloader.read_bytes() + archive_bytes)


if __name__ == "__main__":
    main()
