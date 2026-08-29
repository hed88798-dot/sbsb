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

from locked_interpreter import (
    attest_locked_interpreter,
    normalize_py_gil_disabled,
    require_locked_python_environment,
)
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
    try:
        locked_python = require_locked_python_environment()
        locked_interpreter = attest_locked_interpreter(
            locked_python,
            target=arguments.target,
            target_descriptor=descriptor,
        )
    except ValueError as error:
        raise SystemExit(str(error)) from error
    tags = sorted({str(tag) for tag in sys_tags()})
    actual_target = "windows" if sys.platform == "win32" else "linux" if sys.platform.startswith("linux") else ""
    gil_api_value = sys._is_gil_enabled() if hasattr(sys, "_is_gil_enabled") else None
    py_gil_disabled = sysconfig.get_config_var("Py_GIL_DISABLED")
    soabi = str(sysconfig.get_config_var("SOABI") or "")
    ext_suffix = str(sysconfig.get_config_var("EXT_SUFFIX") or "")
    abiflags = getattr(sys, "abiflags", None)
    cache_tag = str(sys.implementation.cache_tag or "")
    failures: list[str] = []
    try:
        free_threaded: bool | None = normalize_py_gil_disabled(py_gil_disabled)
    except ValueError as error:
        free_threaded = None
        failures.append(str(error))
    if packaging.__version__ != "25.0":
        failures.append(f"packaging must be 25.0, got {packaging.__version__}")
    if platform.python_implementation() != lock["python_implementation"]:
        failures.append("interpreter implementation differs from source lock")
    if platform.python_version() != lock["python_version"]:
        failures.append("interpreter patch version differs from source lock")
    if actual_target != arguments.target or descriptor.get("architecture") != "x86_64":
        failures.append("interpreter OS/shared target architecture differs from approved target")
    if free_threaded is True:
        failures.append("Py_GIL_DISABLED is 1; free-threaded CPython is rejected")
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
        or locked_python.resolve() != installation_executable
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
            "platform_system": platform.system(),
            "platform_machine": platform.machine(),
            "architecture": descriptor.get("architecture"),
            "architecture_source": "shared PyPA target descriptor",
            "os": actual_target,
            "python_free_threaded": free_threaded,
            "free_threaded_detection_method": "sysconfig.get_config_var('Py_GIL_DISABLED')",
            "python_abi": lock["python_abi"],
            "python_abi_source": "approved source lock plus shared PyPA compatible tags",
            "py_gil_disabled": py_gil_disabled,
            "runtime_gil_enabled": gil_api_value,
            "abiflags": abiflags,
            "soabi": soabi,
            "ext_suffix": ext_suffix,
            "cache_tag": cache_tag,
        },
        "locked_interpreter": locked_interpreter,
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
