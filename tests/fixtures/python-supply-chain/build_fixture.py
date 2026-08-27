from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path


FIXED_TIME = (2020, 1, 1, 0, 0, 0)
NATIVE_BYTES = b"synthetic-native-fixture-v1"
LICENSE_BYTES = b"Synthetic MIT fixture. Not a third-party artifact.\n"


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def write_entry(wheel: zipfile.ZipFile, path: str, value: bytes) -> None:
    info = zipfile.ZipInfo(path, FIXED_TIME)
    info.compress_type = zipfile.ZIP_STORED
    info.external_attr = 0o644 << 16
    wheel.writestr(info, value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--license", default="MIT")
    parser.add_argument("--name", default="quality-fixture")
    parser.add_argument("--requires", action="append", default=[])
    arguments = parser.parse_args()
    arguments.root.mkdir(parents=True, exist_ok=True)
    normalized = arguments.name.replace("-", "_")
    filename = f"{normalized}-1.0.0-cp312-cp312-win_amd64.whl"
    path = arguments.root / filename
    metadata = (
        "Metadata-Version: 2.4\n"
        f"Name: {arguments.name}\n"
        "Version: 1.0.0\n"
        f"License-Expression: {arguments.license}\n"
        "License-File: LICENSE.txt\n"
        + "".join(f"Requires-Dist: {requirement}\n" for requirement in arguments.requires)
        + "\n"
    ).encode()
    with zipfile.ZipFile(path, "w") as wheel:
        write_entry(wheel, f"{normalized}/__init__.py", b"VERSION = '1.0.0'\n")
        write_entry(wheel, f"{normalized}/native.pyd", NATIVE_BYTES)
        write_entry(wheel, f"{normalized}-1.0.0.dist-info/METADATA", metadata)
        write_entry(wheel, f"{normalized}-1.0.0.dist-info/licenses/LICENSE.txt", LICENSE_BYTES)
        write_entry(
            wheel,
            f"{normalized}-1.0.0.dist-info/WHEEL",
            b"Wheel-Version: 1.0\nRoot-Is-Purelib: false\nTag: cp312-cp312-win_amd64\n",
        )
        write_entry(wheel, f"{normalized}-1.0.0.dist-info/RECORD", b"")
    print(
        json.dumps(
            {
                "filename": filename,
                "package_name": arguments.name,
                "wheel_sha256": digest(path.read_bytes()),
                "license_path": f"{normalized}-1.0.0.dist-info/licenses/LICENSE.txt",
                "license_sha256": digest(LICENSE_BYTES),
                "native_path": f"{normalized}/native.pyd",
                "native_sha256": digest(NATIVE_BYTES),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
