from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

from policy import sha256_file


IDENTITY_PROGRAM = r"""
import json
import platform
import sys
import sysconfig
from pathlib import Path

machine = platform.machine().lower()
architecture = "x86_64" if machine in {"amd64", "x86_64"} else machine
gil_enabled = sys._is_gil_enabled() if hasattr(sys, "_is_gil_enabled") else None
py_gil_disabled = sysconfig.get_config_var("Py_GIL_DISABLED")
soabi = str(sysconfig.get_config_var("SOABI") or "")
abiflags = str(sys.abiflags)
cache_tag = str(sys.implementation.cache_tag or "")
free_threaded = bool(
    py_gil_disabled
    or "t" in abiflags
    or "cp313t" in soabi.lower()
    or "cpython-313t" in cache_tag.lower()
    or gil_enabled is False
)
python_abi = f"cp{sys.version_info.major}{sys.version_info.minor}{'t' if free_threaded else ''}"
runtime_candidates = []
library_name = str(sysconfig.get_config_var("LDLIBRARY") or "")
library_dir = str(sysconfig.get_config_var("LIBDIR") or "")
if sys.platform == "win32":
    runtime_candidates.extend(
        [
            Path(sys.base_prefix) / "python313.dll",
            Path(sys.executable).parent / "python313.dll",
        ]
    )
elif library_name:
    if library_dir:
        runtime_candidates.append(Path(library_dir) / library_name)
    runtime_candidates.extend(
        [
            Path(sys.base_prefix) / "lib" / library_name,
            Path(sys.executable).parent.parent / "lib" / library_name,
        ]
    )
runtime_library = next((str(path.resolve()) for path in runtime_candidates if path.is_file()), None)
print(
    json.dumps(
        {
            "sys_executable": str(Path(sys.executable).resolve()),
            "sys_version": sys.version,
            "implementation": platform.python_implementation(),
            "implementation_name": sys.implementation.name,
            "version": platform.python_version(),
            "platform_machine": platform.machine(),
            "architecture": architecture,
            "os": "windows" if sys.platform == "win32" else "linux" if sys.platform.startswith("linux") else sys.platform,
            "soabi": soabi,
            "abiflags": abiflags,
            "cache_tag": cache_tag,
            "py_gil_disabled": py_gil_disabled,
            "runtime_gil_enabled": gil_enabled,
            "python_free_threaded": free_threaded,
            "python_abi": python_abi,
            "runtime_library": runtime_library,
        }
    )
)
"""


def require_locked_python_environment(environment: dict[str, str] | None = None) -> Path:
    values = os.environ if environment is None else environment
    configured = values.get("PYTHON_EXECUTABLE", "").strip()
    if not configured:
        raise ValueError(
            "PYTHON_EXECUTABLE is required; candidate generation refuses sys.executable/PATH fallback"
        )
    executable = Path(configured)
    if not executable.is_absolute():
        raise ValueError("PYTHON_EXECUTABLE must be an absolute path to the locked interpreter")
    if not executable.is_file():
        raise ValueError(f"PYTHON_EXECUTABLE is not a file: {executable}")
    if not os.access(executable, os.X_OK):
        raise ValueError(f"PYTHON_EXECUTABLE is not executable: {executable}")
    return executable


def attest_locked_interpreter(
    executable: Path,
    *,
    target: str,
    target_descriptor: dict[str, object],
    environment: dict[str, str] | None = None,
) -> dict[str, object]:
    child_environment = dict(os.environ if environment is None else environment)
    result = subprocess.run(
        [str(executable), "-I", "-c", IDENTITY_PROGRAM],
        check=False,
        capture_output=True,
        text=True,
        env=child_environment,
        shell=False,
    )
    if result.returncode != 0:
        raise ValueError(
            "locked PYTHON_EXECUTABLE identity probe failed: "
            + (result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}")
        )
    try:
        identity = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise ValueError("locked PYTHON_EXECUTABLE returned invalid identity JSON") from error

    failures: list[str] = []
    if Path(str(identity.get("sys_executable", ""))).resolve() != executable.resolve():
        failures.append("sys.executable does not resolve to the configured PYTHON_EXECUTABLE")
    if identity.get("implementation") != "CPython" or identity.get("implementation_name") != "cpython":
        failures.append("locked interpreter implementation is not CPython")
    if identity.get("version") != "3.13.15":
        failures.append(f"locked interpreter must be 3.13.15, got {identity.get('version')}")
    if identity.get("os") != target or identity.get("architecture") != "x86_64":
        failures.append("locked interpreter OS/architecture differs from requested target")
    if identity.get("python_abi") != "cp313" or identity.get("python_free_threaded") is not False:
        failures.append("locked interpreter must use standard-GIL cp313")
    if "313" not in str(identity.get("soabi", "")):
        failures.append("locked interpreter SOABI is not CPython 3.13")
    if target_descriptor.get("implementation") != "cpython":
        failures.append("target descriptor implementation is not cpython")
    if target_descriptor.get("python_version") != identity.get("version"):
        failures.append("target descriptor Python version differs from locked interpreter")
    if target_descriptor.get("os") != identity.get("os"):
        failures.append("target descriptor OS differs from locked interpreter")
    if target_descriptor.get("architecture") != identity.get("architecture"):
        failures.append("target descriptor architecture differs from locked interpreter")
    runtime_library_value = identity.get("runtime_library")
    runtime_library = Path(str(runtime_library_value)).resolve() if runtime_library_value else None
    if target == "windows" and (runtime_library is None or not runtime_library.is_file()):
        failures.append("locked Windows interpreter runtime DLL was not found")
    if failures:
        raise ValueError("locked interpreter attestation failed closed:\n" + "\n".join(failures))

    return {
        "status": "PASS",
        "binding_source": "PYTHON_EXECUTABLE",
        "subprocess_shell": False,
        "executable": str(executable),
        "executable_sha256": sha256_file(executable),
        "runtime_library": str(runtime_library) if runtime_library else None,
        "runtime_library_sha256": sha256_file(runtime_library) if runtime_library else None,
        **identity,
    }
