from __future__ import annotations

import argparse
import datetime as dt
import importlib.metadata
import json
import os
import platform
import site
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import PyInstaller
from packaging.utils import canonicalize_name

from canonical_evidence import canonical_sha256, write_canonical_json
from hermetic_pyinstaller import (
    HermeticBuildError,
    attest_python_search_path,
    build_child_environment,
    is_native_path,
    normalized_realpath,
    path_is_within,
    sha256_file,
)


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
EXPECTED_PYINSTALLER_VERSION = "6.22.2"
MANIFEST_SCHEMA = "code-c-pyinstaller-build-environment-v1"


def fresh_directory(path: Path, label: str) -> Path:
    resolved = path.resolve()
    if resolved.exists() and (not resolved.is_dir() or any(resolved.iterdir())):
        raise SystemExit(f"{label} must be a fresh empty directory: {resolved}")
    resolved.mkdir(parents=True, exist_ok=True)
    if any(resolved.iterdir()):
        raise SystemExit(f"{label} was not empty after creation: {resolved}")
    return resolved


def inventory_union(paths: list[Path]) -> tuple[dict[str, dict[str, object]], list[dict[str, object]]]:
    packages: dict[str, dict[str, object]] = {}
    identities = []
    for path in paths:
        document = json.loads(path.read_text(encoding="utf-8"))
        identities.append(
            {
                "path": path.resolve().relative_to(REPOSITORY_ROOT).as_posix(),
                "sha256": sha256_file(path),
                "inventory_id": document["inventory_id"],
            }
        )
        for package in document["packages"]:
            name = canonicalize_name(str(package["package_name"]))
            previous = packages.get(name)
            if previous and (
                previous["sha256"] != package["sha256"]
                or previous["version"] != package["version"]
            ):
                raise SystemExit(f"inventory union contains conflicting artifact: {name}")
            packages[name] = package
    return packages, identities


def installed_wheel_native_manifest(
    packages: dict[str, dict[str, object]], worker_root: Path
) -> list[dict[str, object]]:
    distributions = {
        canonicalize_name(str(dist.metadata["Name"])): dist
        for dist in importlib.metadata.distributions()
        if dist.metadata["Name"]
    }
    entries = []
    recovered: dict[tuple[str, str], int] = defaultdict(int)
    for name, package in sorted(packages.items()):
        distribution = distributions.get(name)
        if distribution is None:
            raise SystemExit(f"approved installed distribution is missing: {name}")
        if distribution.version != package["version"]:
            raise SystemExit(f"approved installed distribution version drift: {name}")
        native_by_hash: dict[str, list[dict[str, object]]] = defaultdict(list)
        for native in package.get("native_artifacts", []):
            native_by_hash[str(native["sha256"])].append(native)
        for installed_file in distribution.files or []:
            installed_path = Path(distribution.locate_file(installed_file))
            if not installed_path.is_file() or not is_native_path(installed_path):
                continue
            if not path_is_within(installed_path, worker_root):
                raise SystemExit(f"installed wheel native resolves outside Worker root: {installed_path}")
            digest = sha256_file(installed_path)
            candidates = native_by_hash.get(digest, [])
            basename_matches = [
                native
                for native in candidates
                if str(native["filename"]).lower() == installed_path.name.lower()
            ]
            matches = basename_matches or candidates
            if len(matches) != 1:
                raise SystemExit(
                    f"installed wheel native has no unique artifact member: {name}: {installed_path}"
                )
            native = matches[0]
            recovered[(name, str(native["relative_path"]))] += 1
            entries.append(
                {
                    "resolved_path": str(installed_path.resolve(strict=True)),
                    "resolved_path_key": normalized_realpath(installed_path),
                    "sha256": digest,
                    "size": installed_path.stat().st_size,
                    "source_kind": "HASH_LOCKED_WHEEL_NATIVE",
                    "source_artifact_identity": {
                        "purl": package["purl"],
                        "filename": package["filename"],
                        "artifact_sha256": package["sha256"],
                        "member_relative_path": native["relative_path"],
                        "member_sha256": native["sha256"],
                    },
                }
            )
    missing = [
        f"{name}:{native['relative_path']}"
        for name, package in sorted(packages.items())
        for native in package.get("native_artifacts", [])
        if recovered[(name, str(native["relative_path"]))] == 0
    ]
    if missing:
        raise SystemExit("approved native wheel member is absent after installation: " + ", ".join(missing))
    return entries


def cpython_native_manifest(
    base_root: Path,
    distribution: Path,
    installation_evidence: Path,
    runtime_identity: Path,
) -> list[dict[str, object]]:
    artifact = {
        "filename": distribution.name,
        "artifact_sha256": sha256_file(distribution),
        "installation_evidence_sha256": sha256_file(installation_evidence),
        "runtime_identity_sha256": sha256_file(runtime_identity),
    }
    entries = []
    for path in sorted(base_root.rglob("*")):
        if path.is_file() and is_native_path(path):
            entries.append(
                {
                    "resolved_path": str(path.resolve(strict=True)),
                    "resolved_path_key": normalized_realpath(path),
                    "sha256": sha256_file(path),
                    "size": path.stat().st_size,
                    "source_kind": "LOCKED_CPYTHON_INSTALLATION_NATIVE",
                    "source_artifact_identity": {
                        **artifact,
                        "installed_relative_path": path.relative_to(base_root).as_posix(),
                    },
                }
            )
    return entries


def unique_existing_paths(values: list[Path]) -> list[Path]:
    output = []
    seen = set()
    for value in values:
        resolved = value.resolve(strict=True)
        key = normalized_realpath(resolved)
        if key not in seen:
            seen.add(key)
            output.append(resolved)
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows"], required=True)
    parser.add_argument("--runtime-inventory", type=Path, required=True)
    parser.add_argument("--worker-build-inventory", type=Path, required=True)
    parser.add_argument("--cpython-distribution", type=Path, required=True)
    parser.add_argument("--pip-wheel", type=Path, required=True)
    parser.add_argument("--pyinstaller-wheel", type=Path, required=True)
    parser.add_argument("--cpython-installation", type=Path, required=True)
    parser.add_argument("--runtime-identity", type=Path, required=True)
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--workpath", type=Path, required=True)
    parser.add_argument("--distpath", type=Path, required=True)
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--selected-evidence", type=Path, required=True)
    parser.add_argument("--build-context", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    if sys.platform != "win32" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise SystemExit(f"Windows x64 build environment required, got {sys.platform}/{platform.machine()}")
    if PyInstaller.__version__ != EXPECTED_PYINSTALLER_VERSION:
        raise SystemExit(f"PyInstaller must be {EXPECTED_PYINSTALLER_VERSION}")

    worker_root = Path(sys.prefix).resolve(strict=True)
    base_root = Path(sys.base_prefix).resolve(strict=True)
    executable = Path(sys.executable).resolve(strict=True)
    if worker_root == base_root or not path_is_within(executable, worker_root):
        raise SystemExit("PyInstaller must run from a fresh Worker virtual environment")
    workpath = fresh_directory(arguments.workpath, "PyInstaller workpath")
    distpath = fresh_directory(arguments.distpath, "PyInstaller distpath")
    cache_root = fresh_directory(arguments.cache_root, "PyInstaller cache/config root")

    installation = json.loads(arguments.cpython_installation.read_text(encoding="utf-8"))
    runtime = json.loads(arguments.runtime_identity.read_text(encoding="utf-8"))
    if (
        installation.get("status") != "PASS"
        or runtime.get("status") != "PASS"
        or Path(str(installation["installed_interpreter"]["executable"])).resolve() != base_root / "python.exe"
        or runtime.get("interpreter", {}).get("version") != "3.13.15"
        or runtime.get("interpreter", {}).get("python_free_threaded") is not False
        or runtime.get("interpreter", {}).get("python_abi") != "cp313"
    ):
        raise SystemExit("Worker environment is not bound to approved standard-GIL CPython 3.13.15")

    packages, inventory_identities = inventory_union(
        [arguments.runtime_inventory, arguments.worker_build_inventory]
    )
    pyinstaller_package = packages.get("pyinstaller")
    if (
        not pyinstaller_package
        or arguments.pyinstaller_wheel.name != pyinstaller_package["filename"]
        or sha256_file(arguments.pyinstaller_wheel) != pyinstaller_package["sha256"]
    ):
        raise SystemExit("installed PyInstaller differs from the exact worker-build artifact")
    file_manifest = installed_wheel_native_manifest(packages, worker_root)
    file_manifest.extend(
        cpython_native_manifest(
            base_root,
            arguments.cpython_distribution,
            arguments.cpython_installation,
            arguments.runtime_identity,
        )
    )
    file_manifest.sort(key=lambda entry: (str(entry["resolved_path_key"]), str(entry["sha256"])))
    path_keys = [str(entry["resolved_path_key"]) for entry in file_manifest]
    if len(path_keys) != len(set(path_keys)):
        raise SystemExit("approved source file manifest contains duplicate resolved paths")

    system_root_value = os.environ.get("SystemRoot") or os.environ.get("WINDIR")
    comspec_value = os.environ.get("ComSpec") or os.environ.get("COMSPEC")
    if not system_root_value or not comspec_value:
        raise SystemExit("required Windows SystemRoot/ComSpec environment is missing")
    system_root = Path(system_root_value).resolve(strict=True)
    system32 = (system_root / "System32").resolve(strict=True)
    scripts_root = executable.parent.resolve(strict=True)
    execution_roots = unique_existing_paths([scripts_root, base_root, system32, system_root])
    path_entries = [str(path) for path in execution_roots]

    manifest_path = arguments.output.resolve()
    selected_evidence_path = arguments.selected_evidence.resolve()
    build_context_path = arguments.build_context.resolve()
    child_environment, environment_audit = build_child_environment(
        dict(os.environ),
        path_entries=path_entries,
        cache_root=cache_root,
        worker_root=worker_root,
        manifest_path=manifest_path,
        selected_evidence_path=selected_evidence_path,
    )
    required_environment = (
        "SYSTEMROOT",
        "COMSPEC",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA",
        "PATHEXT",
    )
    missing_required_environment = [
        name for name in required_environment if not child_environment.get(name)
    ]
    if missing_required_environment:
        raise SystemExit(
            "required Windows build environment is missing: "
            + ", ".join(missing_required_environment)
        )
    probe_code = (
        "import json,site,sys;"
        "print(json.dumps({'sys_path':sys.path,'site_packages':site.getsitepackages(),"
        "'user_site':site.getusersitepackages(),'enable_user_site':site.ENABLE_USER_SITE}))"
    )
    probe = subprocess.run(
        [str(executable), "-I", "-c", probe_code],
        cwd=REPOSITORY_ROOT,
        env=child_environment,
        shell=False,
        check=True,
        capture_output=True,
        text=True,
    )
    python_paths = json.loads(probe.stdout)
    if python_paths["enable_user_site"] is not False:
        raise SystemExit("isolated PyInstaller interpreter did not disable user site")
    python_search_evidence = []
    optional_standard_library_zip_name = (
        f"python{sys.version_info.major}{sys.version_info.minor}.zip"
    )
    try:
        for value in [*python_paths["sys_path"], *python_paths["site_packages"]]:
            if value:
                python_search_evidence.append(
                    attest_python_search_path(
                        value,
                        worker_root=worker_root,
                        base_root=base_root,
                        optional_standard_library_zip_name=optional_standard_library_zip_name,
                    )
                )
    except HermeticBuildError as error:
        raise SystemExit(str(error)) from error

    pyinstaller_root = Path(PyInstaller.__file__).resolve().parent
    hook_roots = [pyinstaller_root / "hooks"]
    try:
        hooks_distribution = importlib.metadata.distribution("pyinstaller-hooks-contrib")
        hooks_init = Path(hooks_distribution.locate_file("_pyinstaller_hooks_contrib/__init__.py"))
        hook_roots.append(hooks_init.resolve(strict=True).parent)
    except importlib.metadata.PackageNotFoundError as error:
        raise SystemExit("approved pyinstaller-hooks-contrib installation is missing") from error
    hook_roots = unique_existing_paths(hook_roots)
    if not all(path_is_within(path, worker_root) for path in hook_roots):
        raise SystemExit("PyInstaller hook search root escapes the Worker environment")

    pathex = [(REPOSITORY_ROOT / "sidecars" / "media-worker" / "src").resolve(strict=True)]
    application_root = (REPOSITORY_ROOT / "sidecars" / "media-worker").resolve(strict=True)
    if not all(path_is_within(path, application_root) for path in pathex):
        raise SystemExit("PyInstaller pathex escapes the approved application source root")

    packaging_roots = [
        {
            "kind": "LOCKED_CPYTHON_ROOT",
            "realpath": normalized_realpath(base_root),
        },
        {
            "kind": "HASH_LOCKED_WORKER_ENVIRONMENT_ROOT",
            "realpath": normalized_realpath(worker_root),
        },
        {
            "kind": "APPROVED_PYINSTALLER_TOOLCHAIN_ROOT",
            "realpath": normalized_realpath(pyinstaller_root),
        },
    ]
    path_execution_roots = [
        {"kind": "PROCESS_PATH_SEARCH_ROOT", "realpath": normalized_realpath(path)}
        for path in execution_roots
    ]
    non_path_execution_roots = []
    for environment_name in (
        "TEMP",
        "TMP",
        "USERPROFILE",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA",
    ):
        path = Path(child_environment[environment_name])
        if path.exists():
            non_path_execution_roots.append(
                {
                    "kind": f"{environment_name}_PROCESS_ACCESS_ROOT",
                    "realpath": normalized_realpath(path),
                }
            )
    execution_environment_roots = path_execution_roots + non_path_execution_roots
    identity = {
        "schema_version": MANIFEST_SCHEMA,
        "target": {"os": "windows", "architecture": "x86_64"},
        "locked_python": {
            "executable": str(executable),
            "executable_sha256": sha256_file(executable),
            "base_root": str(base_root),
            "cpython_distribution": {
                "filename": arguments.cpython_distribution.name,
                "sha256": sha256_file(arguments.cpython_distribution),
            },
        },
        "worker_environment_root": str(worker_root),
        "ordered_effective_path_entries": path_entries,
        "execution_environment_roots": execution_environment_roots,
        "packaging_approved_source_roots": packaging_roots,
        "approved_source_file_manifest": file_manifest,
        "inventory_identities": inventory_identities,
        "toolchain_artifact_identities": {
            "cpython_distribution": {
                "filename": arguments.cpython_distribution.name,
                "sha256": sha256_file(arguments.cpython_distribution),
            },
            "pip_wheel": {
                "filename": arguments.pip_wheel.name,
                "sha256": sha256_file(arguments.pip_wheel),
            },
            "pyinstaller_wheel": {
                "filename": arguments.pyinstaller_wheel.name,
                "sha256": sha256_file(arguments.pyinstaller_wheel),
                "purl": pyinstaller_package["purl"],
                "version": pyinstaller_package["version"],
            },
        },
        "environment": {
            "effective": child_environment,
            **environment_audit,
        },
        "python_search": {
            "sys_path": python_paths["sys_path"],
            "site_packages_roots": python_paths["site_packages"],
            "user_site_path": python_paths["user_site"],
            "user_site_enabled": python_paths["enable_user_site"],
            "path_attestations": python_search_evidence,
            "optional_standard_library_zip_name": optional_standard_library_zip_name,
        },
        "pyinstaller": {
            "version": PyInstaller.__version__,
            "pathex": [str(path) for path in pathex],
            "hook_search_roots": [str(path) for path in hook_roots],
            "hook_configuration": {},
            "workpath": str(workpath),
            "distpath": str(distpath),
            "cache_config_root": str(cache_root),
            "spec": str(arguments.spec.resolve(strict=True)),
            "spec_sha256": sha256_file(arguments.spec),
            "selected_evidence": str(selected_evidence_path),
            "build_context": str(build_context_path),
            "msvc_runtime_evidence": str(
                selected_evidence_path.parent / "msvc-runtime-dependency-request.v1.json"
            ),
            "msvc_runtime_approval_request": str(
                selected_evidence_path.parent / "DEPENDENCY_APPROVAL_REQUEST_MSVC_RUNTIME_V1.md"
            ),
        },
        "validations": {
            "required_os_env_validation": "PASS",
            "approved_toolchain_env_validation": "PASS",
            "forbidden_ambient_toolchain_env_rejected": "PASS",
            "user_site_disabled": "PASS",
            "python_sys_path_validation": "PASS",
            "pyinstaller_pathex_validation": "PASS",
            "pyinstaller_hook_search_root_validation": "PASS",
            "pyinstaller_cache_isolation": "PASS",
            "pyinstaller_workpath_isolation": "PASS",
            "approved_root_realpath_validation": "PASS",
            "unapproved_search_root_count": 0,
            "ambient_path_entry_count_in_pyinstaller_env": 0,
        },
    }
    manifest_id = f"code-c-build-environment-{canonical_sha256(identity)[:32]}"
    document = {
        **identity,
        "build_environment_manifest_id": manifest_id,
        "build_environment_identity_sha256": canonical_sha256(identity),
        "created_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "summary": {
            "execution_environment_root_count": len(execution_environment_roots),
            "packaging_approved_source_root_count": len(packaging_roots),
            "approved_source_root_file_manifest_count": len(file_manifest),
        },
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    result = write_canonical_json(arguments.output, document)
    print(
        f"pyinstaller-build-environment: PASS ({manifest_id}; "
        f"sha256={result.canonical_file_sha256}; {len(file_manifest)} approved native files; "
        "0 unapproved search roots)"
    )


if __name__ == "__main__":
    main()
