from __future__ import annotations

import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

from locked_interpreter import (
    attest_locked_interpreter,
    normalize_py_gil_disabled,
    require_locked_python_environment,
    require_standard_gil,
)
from policy import sha256_file


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def expect_rejected(action: Callable[[], object], expected: str) -> str:
    try:
        action()
    except ValueError as error:
        message = str(error)
        if expected not in message:
            raise SystemExit(f"unexpected fail-closed error: {message}") from error
        return message
    raise SystemExit(f"negative control unexpectedly passed: {expected}")


def venv_python(directory: Path, target: str) -> Path:
    if target == "windows":
        return directory / "Scripts" / "python.exe"
    return directory / "bin" / "python"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--target-descriptor", type=Path, required=True)
    parser.add_argument("--locked-python", type=Path, required=True)
    parser.add_argument("--bootstrap-python", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    descriptor = json.loads(arguments.target_descriptor.read_text(encoding="utf-8"))
    inherited = dict(os.environ)
    correct_environment = {**inherited, "PYTHON_EXECUTABLE": str(arguments.locked_python.resolve())}
    correct_path = require_locked_python_environment(correct_environment)
    correct = attest_locked_interpreter(
        correct_path,
        target=arguments.target,
        target_descriptor=descriptor,
        environment=correct_environment,
    )
    if correct["python_free_threaded"] is not False:
        raise SystemExit("actual locked interpreter is not a standard-GIL build")
    if correct["architecture"] != "x86_64":
        raise SystemExit("shared target descriptor did not normalize architecture to x86_64")

    normalization = {
        "none_is_standard": normalize_py_gil_disabled(None) is False,
        "zero_is_standard": normalize_py_gil_disabled(0) is False,
    }
    if not all(normalization.values()):
        raise SystemExit("Py_GIL_DISABLED standard-build normalization failed")
    free_threaded_error = expect_rejected(
        lambda: require_standard_gil(1),
        "free-threaded CPython is rejected",
    )
    unexpected_value_errors = {
        repr(value): expect_rejected(
            lambda value=value: require_standard_gil(value),
            "Py_GIL_DISABLED must be integer 0, integer 1, or null",
        )
        for value in (True, "0", 2)
    }

    missing_environment = dict(inherited)
    missing_environment.pop("PYTHON_EXECUTABLE", None)
    missing_error = expect_rejected(
        lambda: require_locked_python_environment(missing_environment),
        "PYTHON_EXECUTABLE is required",
    )

    bootstrap_environment = {
        **inherited,
        "PYTHON_EXECUTABLE": str(arguments.bootstrap_python.resolve()),
    }
    bootstrap_path = require_locked_python_environment(bootstrap_environment)
    bootstrap_version_result = subprocess.run(
        [str(bootstrap_path), "-I", "-c", "import platform; print(platform.python_version())"],
        check=False,
        capture_output=True,
        text=True,
        env=bootstrap_environment,
        shell=False,
    )
    bootstrap_version = bootstrap_version_result.stdout.strip()
    if bootstrap_version_result.returncode != 0 or not bootstrap_version.startswith("3.12."):
        raise SystemExit(
            f"bootstrap isolation regression requires Python 3.12.x, got {bootstrap_version or 'ERROR'}"
        )
    bootstrap_error = expect_rejected(
        lambda: attest_locked_interpreter(
            bootstrap_path,
            target=arguments.target,
            target_descriptor=descriptor,
            environment=bootstrap_environment,
        ),
        "locked interpreter must be 3.13.15",
    )

    with tempfile.TemporaryDirectory(prefix="code-c-binding-regression-") as temporary:
        spaced_venv = Path(temporary) / "locked interpreter with spaces"
        created = subprocess.run(
            [str(arguments.locked_python), "-I", "-m", "venv", "--without-pip", str(spaced_venv)],
            check=False,
            capture_output=True,
            text=True,
            env=inherited,
            shell=False,
        )
        if created.returncode != 0:
            raise SystemExit(
                "path-with-spaces venv creation failed: "
                + (created.stderr.strip() or created.stdout.strip())
            )
        spaced_python = venv_python(spaced_venv, arguments.target)
        if " " not in str(spaced_python):
            raise SystemExit("path-with-spaces regression did not construct a spaced executable path")
        spaced_environment = {**inherited, "PYTHON_EXECUTABLE": str(spaced_python)}
        spaced = attest_locked_interpreter(
            require_locked_python_environment(spaced_environment),
            target=arguments.target,
            target_descriptor=descriptor,
            environment=spaced_environment,
        )

    evidence = {
        "schema_version": "1",
        "status": "PASS",
        "target": arguments.target,
        "python_executable_binding": "PASS",
        "locked_interpreter_attestation": "PASS",
        "bootstrap_python_isolation": "PASS",
        "missing_python_executable_fail_closed": "PASS",
        "path_with_spaces_regression": "PASS",
        "py_gil_disabled_normalization": "PASS",
        "free_threaded_detection_method": "sysconfig.get_config_var('Py_GIL_DISABLED')",
        "free_threaded_rejection": "PASS",
        "unexpected_py_gil_disabled_rejection": "PASS",
        "sys_abiflags_portability": "PASS",
        "architecture_normalization": "PASS",
        "subprocess_shell": False,
        "locked_python": {
            "executable": correct["executable"],
            "executable_sha256": correct["executable_sha256"],
            "runtime_library": correct["runtime_library"],
            "runtime_library_sha256": correct["runtime_library_sha256"],
            "py_gil_disabled": correct["py_gil_disabled"],
            "python_free_threaded": correct["python_free_threaded"],
            "abiflags": correct["abiflags"],
            "soabi": correct["soabi"],
            "ext_suffix": correct["ext_suffix"],
            "platform_system": correct["platform_system"],
            "platform_machine": correct["platform_machine"],
            "architecture": correct["architecture"],
            "architecture_source": correct["architecture_source"],
        },
        "py_gil_disabled_controls": {
            **normalization,
            "one_rejection": free_threaded_error,
            "unexpected_value_rejections": unexpected_value_errors,
        },
        "bootstrap_python": {
            "executable": str(arguments.bootstrap_python.resolve()),
            "executable_sha256": sha256_file(arguments.bootstrap_python.resolve()),
            "version": bootstrap_version,
            "rejection": bootstrap_error,
        },
        "missing_binding_rejection": missing_error,
        "path_with_spaces": {
            "requested_path_contains_spaces": True,
            "executable": spaced["executable"],
            "executable_sha256": spaced["executable_sha256"],
        },
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(canonical_json(evidence), encoding="utf-8")
    print(
        f"locked-interpreter-binding-regressions: PASS ({arguments.target}; "
        "explicit/missing/bootstrap/path-with-spaces; shell=false)"
    )


if __name__ == "__main__":
    main()
