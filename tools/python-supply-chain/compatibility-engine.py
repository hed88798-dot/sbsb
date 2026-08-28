from __future__ import annotations

import hashlib
import json
import platform
import sys
from typing import Iterable

import packaging
from packaging.tags import compatible_tags, cpython_tags, sys_tags
from packaging.utils import parse_wheel_filename


ENGINE = {
    "compatibility_engine": "pypa-packaging",
    "compatibility_engine_version": "1",
    "packaging_version": "25.0",
    "wheel_tag_parser": "packaging.utils.parse_wheel_filename",
    "wheel_tag_parser_version": "25.0",
    "target_descriptor_version": "1",
}


def sorted_tags(values: Iterable[object]) -> list[str]:
    return sorted({str(value) for value in values})


def tags_hash(values: list[str]) -> str:
    return hashlib.sha256(("\n".join(sorted(values)) + "\n").encode()).hexdigest()


def engine_metadata() -> dict[str, str]:
    if packaging.__version__ != ENGINE["packaging_version"]:
        raise SystemExit(
            f"packaging version mismatch: expected {ENGINE['packaging_version']}, "
            f"got {packaging.__version__}"
        )
    return dict(ENGINE)


def parse_wheel(filename: str) -> dict[str, object]:
    name, version, build, tags = parse_wheel_filename(filename)
    return {
        "package_name": str(name),
        "version": str(version),
        "build": list(build),
        "wheel_tags": sorted_tags(tags),
    }


def architecture_name() -> str:
    value = platform.machine().lower()
    if value in {"amd64", "x86_64"}:
        return "x86_64"
    if value in {"arm64", "aarch64"}:
        return "arm64"
    raise SystemExit(f"unsupported target architecture: {value}")


def os_name() -> str:
    if sys.platform == "win32":
        return "windows"
    if sys.platform.startswith("linux"):
        return "linux"
    raise SystemExit(f"unsupported target OS for formal inventory: {sys.platform}")


def target_descriptor(
    tags: list[str],
    source: str,
    python_version: str,
    target_os: str | None = None,
    architecture: str | None = None,
) -> dict[str, object]:
    metadata = engine_metadata()
    return {
        "target_descriptor_version": metadata["target_descriptor_version"],
        "implementation": "cpython",
        "python_version": python_version,
        "os": target_os or os_name(),
        "architecture": architecture or architecture_name(),
        "compatibility": {
            "compatibility_engine": metadata["compatibility_engine"],
            "compatibility_engine_version": metadata["compatibility_engine_version"],
            "packaging_version": metadata["packaging_version"],
            "wheel_tag_parser": metadata["wheel_tag_parser"],
            "wheel_tag_parser_version": metadata["wheel_tag_parser_version"],
            "tag_source": source,
            "compatible_tags": tags,
            "compatible_tags_sha256": tags_hash(tags),
        },
    }


def synthetic_target(request: dict[str, object]) -> dict[str, object]:
    version_parts = tuple(int(part) for part in str(request["python_version"]).split("."))
    if len(version_parts) != 2:
        raise SystemExit("synthetic target python_version must be major.minor")
    interpreter = f"cp{version_parts[0]}{version_parts[1]}"
    platforms = [str(value) for value in request["platforms"]]
    abis = [str(value) for value in request["abis"]]
    tags = sorted_tags(
        list(cpython_tags(python_version=version_parts, abis=abis, platforms=platforms))
        + list(
            compatible_tags(
                python_version=version_parts,
                interpreter=interpreter,
                platforms=platforms,
            )
        )
    )
    descriptor = target_descriptor(
        tags,
        "packaging.tags.cpython_tags+compatible_tags",
        str(request["python_full_version"]),
        str(request["os"]),
        str(request["architecture"]),
    )
    return descriptor


def main() -> None:
    request = json.load(sys.stdin)
    action = request.get("action")
    metadata = engine_metadata()
    if action == "metadata":
        result: object = metadata
    elif action == "parse_wheel":
        result = {**parse_wheel(str(request["filename"])), "engine": metadata}
    elif action == "describe_current_target":
        result = target_descriptor(
            sorted_tags(sys_tags()),
            "packaging.tags.sys_tags",
            platform.python_version(),
        )
    elif action == "synthetic_target":
        result = synthetic_target(request)
    elif action == "evaluate":
        parsed = parse_wheel(str(request["filename"]))
        target_tags = {str(value) for value in request["compatible_tags"]}
        matched = sorted(target_tags.intersection(parsed["wheel_tags"]))
        result = {
            **parsed,
            "status": "COMPATIBLE" if matched else "INCOMPATIBLE",
            "matched_tags": matched,
            "engine": metadata,
        }
    elif action == "hash_tags":
        result = {"compatible_tags_sha256": tags_hash([str(v) for v in request["tags"]])}
    else:
        raise SystemExit(f"unknown compatibility engine action: {action}")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
