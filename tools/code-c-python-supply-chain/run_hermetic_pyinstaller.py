from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from hermetic_pyinstaller import (
    normalized_realpath,
    sha256_file,
    verify_environment_manifest_identity,
)
from evidence_paths import EvidencePathError, runtime_repository_root
from msvc_runtime_dependency import MsvcRuntimeEvidenceError, validate_msvc_evidence_pointers


def require_empty(path: Path, label: str) -> None:
    if not path.is_dir() or any(path.iterdir()):
        raise SystemExit(f"{label} is not fresh and empty before build: {path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--build-context", type=Path)
    parser.add_argument("--build-log", type=Path, required=True)
    arguments = parser.parse_args()
    manifest_path = arguments.manifest.resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    verify_environment_manifest_identity(manifest)
    try:
        repository_root_value = (
            manifest.get("environment", {})
            .get("effective", {})
            .get("CODE_C_REPOSITORY_ROOT")
        )
        if not isinstance(repository_root_value, str) or not repository_root_value:
            raise EvidencePathError("child environment lacks an explicit repository root")
        repository_root = runtime_repository_root(
            manifest,
            explicit_repository_root=repository_root_value,
        )
    except EvidencePathError as error:
        raise SystemExit(str(error)) from error
    if arguments.build_context:
        build_context_path = arguments.build_context.resolve(strict=True)
        build_context = json.loads(build_context_path.read_text(encoding="utf-8"))
        binding = build_context.get("inputs", {}).get("build_environment_manifest")
        if (
            not binding
            or binding.get("sha256") != sha256_file(manifest_path)
            or binding.get("build_environment_manifest_id")
            != manifest["build_environment_manifest_id"]
        ):
            raise SystemExit("Build Context does not bind the exact Build Environment Manifest")
        if normalized_realpath(manifest["pyinstaller"]["build_context"]) != normalized_realpath(
            build_context_path
        ):
            raise SystemExit("Build Environment Manifest build-context pointer drift")
        try:
            validate_msvc_evidence_pointers(
                manifest, manifest_path, repository_root=repository_root
            )
        except MsvcRuntimeEvidenceError as error:
            raise SystemExit(str(error)) from error
    python = Path(manifest["locked_python"]["executable"]).resolve(strict=True)
    if sha256_file(python) != manifest["locked_python"]["executable_sha256"]:
        raise SystemExit("locked PyInstaller executable hash drift")
    pyinstaller = manifest["pyinstaller"]
    workpath = Path(pyinstaller["workpath"])
    distpath = Path(pyinstaller["distpath"])
    cache_root = Path(pyinstaller["cache_config_root"])
    for path, label in (
        (workpath, "PyInstaller workpath"),
        (distpath, "PyInstaller distpath"),
        (cache_root, "PyInstaller cache/config root"),
    ):
        require_empty(path, label)
    environment = {str(key): str(value) for key, value in manifest["environment"]["effective"].items()}
    if normalized_realpath(environment["CODE_C_BUILD_ENVIRONMENT_MANIFEST"]) != normalized_realpath(
        manifest_path
    ):
        raise SystemExit("child environment manifest pointer drift")
    command = [
        str(python),
        "-I",
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        "--workpath",
        str(workpath),
        "--distpath",
        str(distpath),
        str(Path(pyinstaller["spec"]).resolve(strict=True)),
    ]
    arguments.build_log.parent.mkdir(parents=True, exist_ok=True)
    with arguments.build_log.open("wb") as log:
        result = subprocess.run(
            command,
            cwd=Path(pyinstaller["spec"]).resolve().parent,
            env=environment,
            shell=False,
            stdout=log,
            stderr=subprocess.STDOUT,
            check=False,
        )
    if result.returncode:
        try:
            log_tail = arguments.build_log.read_bytes()[-16000:].decode(
                "utf-8", errors="replace"
            )
        except OSError:
            log_tail = "<build log unavailable>"
        print("hermetic PyInstaller build log tail (diagnostic):")
        print(log_tail)
        raise SystemExit(
            f"hermetic PyInstaller build failed with exit code {result.returncode}; "
            f"see {arguments.build_log}"
        )
    selected_evidence = Path(pyinstaller["selected_evidence"])
    if not selected_evidence.is_file():
        raise SystemExit("PyInstaller completed without pre-package selected-source evidence")
    selected = json.loads(selected_evidence.read_text(encoding="utf-8"))
    if selected.get("status") != "PASS":
        raise SystemExit("pre-package selected-source provenance gate did not pass")
    print(
        f"hermetic-pyinstaller-build: PASS ({manifest['build_environment_manifest_id']}; "
        f"{selected['selected_native_count']} approved selected native sources)"
    )


if __name__ == "__main__":
    main()
