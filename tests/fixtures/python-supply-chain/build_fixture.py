from __future__ import annotations

import argparse
import hashlib
import itertools
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
    parser.add_argument("--wheel-tag", default="cp312-cp312-win_amd64")
    parser.add_argument("--native-name", default="native.pyd")
    parser.add_argument("--no-native", action="store_true")
    arguments = parser.parse_args()
    arguments.root.mkdir(parents=True, exist_ok=True)
    normalized = arguments.name.replace("-", "_")
    filename = f"{normalized}-1.0.0-{arguments.wheel_tag}.whl"
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
        native_path = None
        if not arguments.no_native:
            native_path = f"{normalized}/{arguments.native_name}"
            write_entry(wheel, native_path, NATIVE_BYTES)
        write_entry(wheel, f"{normalized}-1.0.0.dist-info/METADATA", metadata)
        write_entry(wheel, f"{normalized}-1.0.0.dist-info/licenses/LICENSE.txt", LICENSE_BYTES)
        python_tag, abi_tag, platform_tag = arguments.wheel_tag.split("-")
        expanded_tags = itertools.product(
            python_tag.split("."), abi_tag.split("."), platform_tag.split(".")
        )
        wheel_metadata = (
            "Wheel-Version: 1.0\n"
            f"Root-Is-Purelib: {'true' if arguments.no_native else 'false'}\n"
            + "".join(f"Tag: {'-'.join(tag)}\n" for tag in expanded_tags)
        ).encode()
        write_entry(
            wheel,
            f"{normalized}-1.0.0.dist-info/WHEEL",
            wheel_metadata,
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
                "native_path": native_path,
                "native_sha256": None if arguments.no_native else digest(NATIVE_BYTES),
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
