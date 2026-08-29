from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
import sysconfig
from pathlib import Path

import packaging
from packaging.markers import default_environment
from packaging.tags import sys_tags

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


def canonical_sha256(value: object) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def normalized_architecture() -> str:
    value = platform.machine().lower()
    return "x86_64" if value in {"amd64", "x86_64"} else value


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--target-descriptor", type=Path, required=True)
    parser.add_argument("--distribution", type=Path, required=True)
    parser.add_argument("--installation-evidence", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
    target_lock = lock["targets"][arguments.target]
    descriptor = json.loads(arguments.target_descriptor.read_text(encoding="utf-8"))
    installation = json.loads(arguments.installation_evidence.read_text(encoding="utf-8"))
    installation_executable = Path(
        str(installation.get("installed_interpreter", {}).get("executable", ""))
    ).resolve()
    interpreter_chain = {
        Path(sys.executable).resolve(),
        Path(getattr(sys, "_base_executable", sys.executable)).resolve(),
    }
    tags = sorted({str(tag) for tag in sys_tags()})
    actual_target = "windows" if sys.platform == "win32" else "linux" if sys.platform.startswith("linux") else ""
    gil_api_value = sys._is_gil_enabled() if hasattr(sys, "_is_gil_enabled") else None
    py_gil_disabled = sysconfig.get_config_var("Py_GIL_DISABLED")
    soabi = str(sysconfig.get_config_var("SOABI") or "")
    abiflags = str(sys.abiflags)
    cache_tag = str(sys.implementation.cache_tag or "")
    free_threaded = bool(
        py_gil_disabled
        or "t" in abiflags
        or "cp313t" in soabi.lower()
        or "cpython-313t" in cache_tag.lower()
        or any(tag.startswith("cp313t-") or "-cp313t-" in tag for tag in tags)
    )
    failures: list[str] = []
    if packaging.__version__ != "25.0":
        failures.append(f"packaging must be 25.0, got {packaging.__version__}")
    if platform.python_implementation() != lock["python_implementation"]:
        failures.append("interpreter implementation differs from source lock")
    if platform.python_version() != lock["python_version"]:
        failures.append("interpreter patch version differs from source lock")
    if actual_target != arguments.target or normalized_architecture() != "x86_64":
        failures.append("interpreter OS/architecture differs from approved target")
    if free_threaded or gil_api_value is False:
        failures.append("free-threaded or disabled-GIL interpreter is rejected")
    if not any(tag.startswith("cp313-cp313-") for tag in tags):
        failures.append("interpreter has no standard cp313-cp313 target tag")
    if any("cp313t" in tag for tag in tags):
        failures.append("cp313t appears in current compatible tags")
    if (
        descriptor.get("implementation") != "cpython"
        or descriptor.get("python_version") != lock["python_version"]
        or descriptor.get("os") != arguments.target
        or descriptor.get("architecture") != "x86_64"
        or descriptor.get("compatibility", {}).get("tag_source") != "packaging.tags.sys_tags"
        or descriptor.get("compatibility", {}).get("compatible_tags") != tags
    ):
        failures.append("target descriptor differs from actual interpreter sys_tags")
    distribution = target_lock["cpython_distribution"]
    if (
        arguments.distribution.name != distribution["filename"]
        or arguments.distribution.stat().st_size != distribution["size"]
        or sha256_file(arguments.distribution) != distribution["sha256"]
    ):
        failures.append("CPython distribution differs from source lock")
    if (
        installation.get("status") != "PASS"
        or installation.get("distribution", {}).get("sha256") != distribution["sha256"]
        or installation_executable not in interpreter_chain
    ):
        failures.append("running interpreter is not bound to locked installation evidence")

    libc_name, libc_version = platform.libc_ver()
    manylinux_tags = [tag for tag in tags if "manylinux" in tag]
    if arguments.target == "linux":
        if libc_name.lower() != "glibc" or not libc_version:
            failures.append("Linux target must report an actual glibc baseline")
        if not manylinux_tags:
            failures.append("Linux target exposes no manylinux-compatible tags")
    if os.environ.get("GITHUB_ACTIONS") == "true" and (
        not os.environ.get("ImageOS") or not os.environ.get("ImageVersion")
    ):
        failures.append("GitHub-hosted target is missing runner image identity")

    evidence = {
        "schema_version": "1",
        "status": "PASS" if not failures else "FAIL",
        "interpreter": {
            "implementation": platform.python_implementation(),
            "version": platform.python_version(),
            "executable": str(Path(sys.executable).resolve()),
            "architecture": normalized_architecture(),
            "os": actual_target,
            "python_free_threaded": free_threaded,
            "python_abi": "cp313" if not free_threaded else "cp313t",
            "py_gil_disabled": py_gil_disabled,
            "runtime_gil_enabled": gil_api_value,
            "abiflags": abiflags,
            "soabi": soabi,
            "cache_tag": cache_tag,
        },
        "distribution": {
            "filename": arguments.distribution.name,
            "sha256": sha256_file(arguments.distribution),
            "size": arguments.distribution.stat().st_size,
            "download_url": distribution["download_url"],
            "canonical_source": distribution["canonical_source"],
            "installation_evidence_path": str(arguments.installation_evidence),
            "installation_evidence_sha256": sha256_file(arguments.installation_evidence),
        },
        "target_descriptor": {
            "path": str(arguments.target_descriptor),
            "sha256": sha256_file(arguments.target_descriptor),
            "identity_sha256": canonical_sha256(descriptor),
            "compatible_tags_count": len(tags),
            "standard_cp313_tags": [tag for tag in tags if tag.startswith("cp313-cp313-")],
            "cp313t_tags": [tag for tag in tags if "cp313t" in tag],
        },
        "marker_environment": default_environment(),
        "linux": {
            "libc": libc_name or None,
            "glibc_version": libc_version or None,
            "manylinux_compatible_tags": manylinux_tags,
        }
        if arguments.target == "linux"
        else None,
        "runner": {
            "image_os": os.environ.get("ImageOS"),
            "image_version": os.environ.get("ImageVersion"),
            "runner_os": os.environ.get("RUNNER_OS"),
            "runner_arch": os.environ.get("RUNNER_ARCH"),
        },
        "failures": failures,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(canonical_json(evidence), encoding="utf-8")
    if failures:
        raise SystemExit("runtime identity failed closed:\n" + "\n".join(failures))
    print(
        f"runtime-identity: PASS ({arguments.target}; CPython {platform.python_version()}; "
        f"standard GIL; cp313; {len(tags)} tags)"
    )


if __name__ == "__main__":
    main()
