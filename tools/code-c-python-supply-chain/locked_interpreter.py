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

gil_enabled = sys._is_gil_enabled() if hasattr(sys, "_is_gil_enabled") else None
py_gil_disabled = sysconfig.get_config_var("Py_GIL_DISABLED")
soabi = str(sysconfig.get_config_var("SOABI") or "")
ext_suffix = str(sysconfig.get_config_var("EXT_SUFFIX") or "")
abiflags = getattr(sys, "abiflags", None)
cache_tag = str(sys.implementation.cache_tag or "")
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
            "platform_system": platform.system(),
            "platform_machine": platform.machine(),
            "os": "windows" if sys.platform == "win32" else "linux" if sys.platform.startswith("linux") else sys.platform,
            "soabi": soabi,
            "ext_suffix": ext_suffix,
            "abiflags": abiflags,
            "cache_tag": cache_tag,
            "py_gil_disabled": py_gil_disabled,
            "runtime_gil_enabled": gil_enabled,
            "runtime_library": runtime_library,
        }
    )
)
"""


def normalize_py_gil_disabled(value: object) -> bool:
    if value is None:
        return False
    if type(value) is int and value == 0:
        return False
    if type(value) is int and value == 1:
        return True
    raise ValueError(
        "Py_GIL_DISABLED must be integer 0, integer 1, or null; "
        f"got {type(value).__name__} {value!r}"
    )


def require_standard_gil(value: object) -> None:
    if normalize_py_gil_disabled(value):
        raise ValueError("Py_GIL_DISABLED is 1; free-threaded CPython is rejected")


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
    if "py_gil_disabled" not in identity:
        failures.append("locked interpreter probe did not report Py_GIL_DISABLED")
        free_threaded = None
    else:
        try:
            require_standard_gil(identity["py_gil_disabled"])
            free_threaded = False
        except ValueError as error:
            failures.append(str(error))
            free_threaded = None
    if Path(str(identity.get("sys_executable", ""))).resolve() != executable.resolve():
        failures.append("sys.executable does not resolve to the configured PYTHON_EXECUTABLE")
    if identity.get("implementation") != "CPython" or identity.get("implementation_name") != "cpython":
        failures.append("locked interpreter implementation is not CPython")
    if identity.get("version") != "3.13.15":
        failures.append(f"locked interpreter must be 3.13.15, got {identity.get('version')}")
    if identity.get("os") != target:
        failures.append("locked interpreter OS differs from requested target")
    if target_descriptor.get("implementation") != "cpython":
        failures.append("target descriptor implementation is not cpython")
    if target_descriptor.get("python_version") != identity.get("version"):
        failures.append("target descriptor Python version differs from locked interpreter")
    if target_descriptor.get("os") != identity.get("os"):
        failures.append("target descriptor OS differs from locked interpreter")
    if target_descriptor.get("architecture") != "x86_64":
        failures.append("shared target descriptor does not normalize interpreter as x86_64")
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
        "python_free_threaded": free_threaded,
        "free_threaded_detection_method": "sysconfig.get_config_var('Py_GIL_DISABLED')",
        "architecture": target_descriptor.get("architecture"),
        "architecture_source": "shared PyPA target descriptor",
        **identity,
    }
