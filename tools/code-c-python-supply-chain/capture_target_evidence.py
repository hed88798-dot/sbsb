from __future__ import annotations

import argparse
import importlib.metadata
import json
import platform
import shutil
import subprocess
import sys
from pathlib import Path

import PyInstaller

from policy import sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "toolchain-source-lock.json"
)
INSPECT_ONEFILE = (
    REPOSITORY_ROOT / "tools" / "python-supply-chain" / "inspect-pyinstaller-onefile.py"
)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def native_type(path: Path) -> str | None:
    lower = path.name.lower()
    if lower.endswith(".pyd"):
        return "pyd"
    if lower.endswith(".dll"):
        return "dll"
    if lower.endswith(".dylib"):
        return "dylib"
    if lower.endswith(".so") or ".so." in lower:
        return "so"
    return None


def actual_target() -> tuple[str, str]:
    target = "windows" if sys.platform == "win32" else "linux" if sys.platform.startswith("linux") else ""
    architecture = platform.machine().lower()
    if architecture in {"amd64", "x86_64"}:
        architecture = "x86_64"
    if target not in {"windows", "linux"} or architecture != "x86_64":
        raise SystemExit(f"unsupported evidence target: {sys.platform}/{platform.machine()}")
    return target, architecture


def assert_locked_artifact(path: Path, lock: dict[str, object], label: str) -> None:
    if path.name != lock["filename"]:
        raise SystemExit(f"{label} filename differs from source lock")
    if path.stat().st_size != lock["size"] or sha256_file(path) != lock["sha256"]:
        raise SystemExit(f"{label} bytes differ from source lock")


def installed_native_files() -> list[dict[str, object]]:
    base = Path(sys.base_prefix).resolve()
    output = []
    for path in sorted(base.rglob("*")):
        kind = native_type(path)
        if kind and path.is_file():
            output.append(
                {
                    "filename": path.name,
                    "installed_path": path.relative_to(base).as_posix(),
                    "sha256": sha256_file(path),
                    "size": path.stat().st_size,
                    "type": kind,
                }
            )
    return output


def pyinstaller_bootloader(target: str) -> Path:
    root = Path(PyInstaller.__file__).resolve().parent / "bootloader"
    expected = "run.exe" if target == "windows" else "run"
    matches = sorted(root.rglob(expected))
    matches = [path for path in matches if "64bit" in path.parent.name and path.is_file()]
    if len(matches) != 1:
        raise SystemExit(f"expected one installed PyInstaller bootloader, got {len(matches)}")
    return matches[0]


def cpython_license() -> Path:
    base = Path(sys.base_prefix).resolve()
    candidates = [base / "LICENSE.txt", base / "lib" / "python3.13" / "LICENSE.txt"]
    matches = [path for path in candidates if path.is_file()]
    if len(matches) != 1:
        raise SystemExit(f"expected one installed CPython license file, got {len(matches)}")
    return matches[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--distribution", type=Path, required=True)
    parser.add_argument("--pip-wheel", type=Path, required=True)
    parser.add_argument("--pyinstaller-wheel", type=Path, required=True)
    parser.add_argument("--final-artifact", type=Path, required=True)
    arguments = parser.parse_args()
    target, architecture = actual_target()
    lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
    if arguments.target != target:
        raise SystemExit("requested evidence target differs from current target")
    if platform.python_version() != lock["python_version"]:
        raise SystemExit("running CPython patch differs from source lock")
    target_lock = lock["targets"][target]
    assert_locked_artifact(arguments.distribution, target_lock["cpython_distribution"], "CPython")
    assert_locked_artifact(arguments.pip_wheel, lock["pip"], "pip")
    assert_locked_artifact(arguments.pyinstaller_wheel, target_lock["pyinstaller"], "PyInstaller")
    if PyInstaller.__version__ != target_lock["pyinstaller"]["version"]:
        raise SystemExit("imported PyInstaller differs from the approved wheel")

    inspection = json.loads(
        subprocess.run(
            [sys.executable, str(INSPECT_ONEFILE), str(arguments.final_artifact)],
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    )
    inspection_path = arguments.bundle / "inspection" / f"{target}-worker-onefile.json"
    inspection_path.parent.mkdir(parents=True, exist_ok=True)
    inspection_path.write_text(canonical_json(inspection), encoding="utf-8")

    runtime = json.loads(
        (arguments.bundle / "candidates" / f"code-c-{target}-runtime.v2.json").read_text(
            encoding="utf-8"
        )
    )
    worker_build = json.loads(
        (arguments.bundle / "candidates" / f"code-c-{target}-worker-build.v2.json").read_text(
            encoding="utf-8"
        )
    )
    worker_build_resolution = json.loads(
        (arguments.bundle / "resolution" / f"{target}-worker-build.json").read_text(
            encoding="utf-8"
        )
    )
    hooks_candidates = [
        package
        for package in worker_build["packages"]
        if package["package_name"].lower().replace("_", "-") == "pyinstaller-hooks-contrib"
    ]
    if len(hooks_candidates) != 1:
        raise SystemExit("worker-build graph must contain one pyinstaller-hooks-contrib wheel")
    hooks = hooks_candidates[0]
    hooks_resolution = next(
        (
            package
            for package in worker_build_resolution["packages"]
            if package["name"].lower().replace("_", "-") == "pyinstaller-hooks-contrib"
        ),
        None,
    )
    if hooks_resolution is None or hooks_resolution["provenance"]["sha256"] != hooks["sha256"]:
        raise SystemExit("pyinstaller-hooks-contrib candidate differs from metadata resolution")
    installed_hooks = importlib.metadata.distribution("pyinstaller-hooks-contrib")
    if installed_hooks.version != hooks["version"]:
        raise SystemExit("installed pyinstaller-hooks-contrib differs from worker-build graph")
    direct_url_text = installed_hooks.read_text("direct_url.json")
    direct_url = json.loads(direct_url_text) if direct_url_text else {}
    if direct_url.get("archive_info", {}).get("hash") != f"sha256={hooks['sha256']}":
        raise SystemExit("installed pyinstaller-hooks-contrib hash provenance differs from graph")
    wheel_natives = []
    for package in runtime["packages"]:
        for native in package["native_artifacts"]:
            wheel_natives.append(
                {
                    **native,
                    "package_name": package["package_name"],
                    "purl": package["purl"],
                    "wheel_sha256": package["sha256"],
                }
            )
    installed = installed_native_files()
    used_wheel: set[tuple[str, str, str]] = set()
    wheel_mapping = []
    cpython_mapping = []
    unknown = []
    for embedded in inspection["native_artifacts"]:
        wheel_matches = [
            native
            for native in wheel_natives
            if native["filename"] == embedded["filename"] and native["sha256"] == embedded["sha256"]
        ]
        if len(wheel_matches) == 1:
            native = wheel_matches[0]
            key = (str(native["purl"]), str(native["relative_path"]), str(native["sha256"]))
            used_wheel.add(key)
            wheel_mapping.append(
                {
                    "internal_path": embedded["internal_path"],
                    "embedded_sha256": embedded["sha256"],
                    "embedded_size": embedded["size"],
                    "source_package": native["package_name"],
                    "source_purl": native["purl"],
                    "source_wheel_sha256": native["wheel_sha256"],
                    "source_relative_path": native["relative_path"],
                }
            )
            continue
        python_matches = [
            native
            for native in installed
            if native["filename"] == embedded["filename"] and native["sha256"] == embedded["sha256"]
        ]
        if len(python_matches) == 1:
            source = python_matches[0]
            cpython_mapping.append(
                {
                    **embedded,
                    "source_installed_path": source["installed_path"],
                }
            )
        else:
            unknown.append(
                {
                    **embedded,
                    "wheel_match_count": len(wheel_matches),
                    "cpython_match_count": len(python_matches),
                }
            )
    missing = [
        native
        for native in wheel_natives
        if (str(native["purl"]), str(native["relative_path"]), str(native["sha256"])) not in used_wheel
    ]
    bootloader = pyinstaller_bootloader(target)
    bootloader_copy = arguments.bundle / "toolchain" / target / "bootloader" / bootloader.name
    bootloader_copy.parent.mkdir(parents=True, exist_ok=True)
    bootloader_copy.write_bytes(bootloader.read_bytes())
    license_path = cpython_license()
    cpython_license_evidence = (
        arguments.bundle
        / "license-evidence"
        / "cpython-3.13.15"
        / f"{target}.LICENSE.txt"
    )
    cpython_license_evidence.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(license_path, cpython_license_evidence)
    if sha256_file(cpython_license_evidence) != sha256_file(license_path):
        raise SystemExit("captured CPython license evidence hash drift")
    evidence = {
        "schema_version": "1",
        "status": "PASS" if not unknown and not missing else "FAIL",
        "target": {
            "os": target,
            "architecture": architecture,
            "python_version": platform.python_version(),
        },
        "actual_sources": {
            "cpython_distribution": {
                **target_lock["cpython_distribution"],
                "actual_sha256": sha256_file(arguments.distribution),
                "installed_license": {
                    "relative_path": license_path.relative_to(Path(sys.base_prefix).resolve()).as_posix(),
                    "sha256": sha256_file(license_path),
                    "size": license_path.stat().st_size,
                    "evidence_path": cpython_license_evidence.relative_to(
                        arguments.bundle
                    ).as_posix(),
                },
            },
            "pip": {**lock["pip"], "actual_sha256": sha256_file(arguments.pip_wheel)},
            "pyinstaller": {
                **target_lock["pyinstaller"],
                "actual_sha256": sha256_file(arguments.pyinstaller_wheel),
            },
            "pyinstaller_bootloader": {
                "filename": bootloader.name,
                "installed_path": bootloader.relative_to(Path(PyInstaller.__file__).resolve().parent).as_posix(),
                "sha256": sha256_file(bootloader),
                "size": bootloader.stat().st_size,
                "source_pyinstaller_wheel_sha256": target_lock["pyinstaller"]["sha256"],
            },
            "pyinstaller_hooks_contrib": {
                "version": hooks["version"],
                "filename": hooks["filename"],
                "sha256": hooks["sha256"],
                "download_url": hooks_resolution["provenance"]["download_url"],
                "installed_direct_url": direct_url,
                "source_worker_build_inventory_id": worker_build["inventory_id"],
            },
            "media_worker_spec": {
                "relative_path": "sidecars/media-worker/media-worker.spec",
                "sha256": sha256_file(
                    REPOSITORY_ROOT / "sidecars" / "media-worker" / "media-worker.spec"
                ),
            },
        },
        "final_artifact": inspection["final_artifact"],
        "output_layers": {
            "bootloader": inspection["bootloader_layer"],
            "archive_payload": inspection["archive_payload"],
        },
        "wheel_native_mapping": wheel_mapping,
        "cpython_native_mapping": cpython_mapping,
        "unknown_native_artifacts": unknown,
        "missing_wheel_native_artifacts": missing,
    }
    evidence_path = arguments.bundle / "evidence" / f"{target}-target-evidence.json"
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_text(canonical_json(evidence), encoding="utf-8")
    if unknown or missing:
        raise SystemExit(
            f"target evidence failed closed: {len(unknown)} unknown embedded; "
            f"{len(missing)} approved wheel natives missing"
        )
    print(
        f"target-evidence: PASS ({target}; {len(wheel_mapping)} wheel natives; "
        f"{len(cpython_mapping)} CPython natives)"
    )


if __name__ == "__main__":
    main()
