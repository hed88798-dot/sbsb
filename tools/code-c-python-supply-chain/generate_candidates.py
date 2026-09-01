from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
from collections import deque
from pathlib import Path

import packaging
from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from packaging.version import Version

from canonical_evidence import write_canonical_json
from inventory_candidate_serialization import serialize_candidate_from_resolution
from locked_interpreter import attest_locked_interpreter, require_locked_python_environment
from policy import assert_standard_cp313_artifact, hermetic_environment, sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFINITIONS_PATH = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "dependency-definitions.json"
)
INSPECT_WHEEL = REPOSITORY_ROOT / "tools" / "python-supply-chain" / "inspect-wheel.py"
CANDIDATE_TOOL = REPOSITORY_ROOT / "tools" / "python-supply-chain" / "create-candidate.mjs"
TARGET_TOOL = REPOSITORY_ROOT / "tools" / "python-supply-chain" / "target-descriptor.mjs"


def run(arguments: list[str], *, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        arguments,
        cwd=REPOSITORY_ROOT,
        env=env,
        check=False,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or result.stdout.strip() or "command failed")
    return result


def inspect_wheel(path: Path, environment: dict[str, str]) -> dict[str, object]:
    return json.loads(run([sys.executable, str(INSPECT_WHEEL), str(path)], env=environment).stdout)


def pypi_release(name: str, version: str) -> dict[str, object]:
    normalized = canonicalize_name(name)
    url = f"https://pypi.org/pypi/{normalized}/{version}/json"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def select_downloaded_wheel(directory: Path) -> Path:
    wheels = sorted(directory.glob("*.whl"))
    if len(wheels) != 1:
        raise SystemExit(f"expected one downloaded wheel in {directory}, got {len(wheels)}")
    return wheels[0]


def exact_pypi_artifact(name: str, version: str, filename: str, actual_hash: str) -> dict[str, object]:
    release = pypi_release(name, version)
    matches = [entry for entry in release["urls"] if entry["filename"] == filename]
    if len(matches) != 1:
        raise SystemExit(f"PyPI release has no unique artifact for {filename}")
    artifact = matches[0]
    if artifact["packagetype"] != "bdist_wheel":
        raise SystemExit(f"selected artifact is not a wheel: {filename}")
    if artifact["digests"]["sha256"] != actual_hash:
        raise SystemExit(f"downloaded wheel differs from PyPI SHA-256: {filename}")
    if not artifact["url"].startswith("https://files.pythonhosted.org/"):
        raise SystemExit(f"wheel does not use the approved files.pythonhosted.org source: {filename}")
    return {
        "filename": filename,
        "sha256": actual_hash,
        "download_url": artifact["url"],
        "source": f"https://pypi.org/project/{canonicalize_name(name)}/{version}/",
        "source_index": "https://pypi.org/simple",
        "size": artifact["size"],
    }


def marker_applies(requirement: Requirement, environment: dict[str, str], extras: list[str]) -> bool:
    if requirement.marker is None:
        return True
    selections = extras or [""]
    return any(requirement.marker.evaluate({**environment, "extra": extra}) for extra in selections)


def resolve_scope(
    scope_name: str,
    scope: dict[str, object],
    definitions: dict[str, object],
    target_name: str,
    target_descriptor: Path,
    runtime_identity_path: Path,
    runtime_identity: dict[str, object],
    output_root: Path,
    environment: dict[str, str],
) -> None:
    wheel_root = output_root / "wheels" / scope_name
    download_root = output_root / "downloads" / scope_name
    wheel_root.mkdir(parents=True, exist_ok=True)
    download_root.mkdir(parents=True, exist_ok=True)
    versions = {canonicalize_name(name): value for name, value in definitions["versions"].items()}
    extras = {
        canonicalize_name(name): [str(value) for value in values]
        for name, values in scope.get("extras", {}).items()
    }
    direct = [canonicalize_name(name) for name in scope["direct"]]
    pending = deque(direct)
    resolved: dict[str, dict[str, object]] = {}
    marker_environment = default_environment()
    expected_target = "windows" if sys.platform == "win32" else "linux"
    if target_name != expected_target:
        raise SystemExit(f"generator target {target_name} does not match current platform {sys.platform}")

    while pending:
        normalized = pending.popleft()
        if normalized in resolved:
            continue
        version = versions.get(normalized)
        if not version:
            raise SystemExit(f"no approved exact version for {normalized}")
        package_download = download_root / normalized
        if package_download.exists():
            shutil.rmtree(package_download)
        package_download.mkdir(parents=True)
        run(
            [
                sys.executable,
                "-m",
                "pip",
                "download",
                "--isolated",
                "--disable-pip-version-check",
                "--no-cache-dir",
                "--no-deps",
                "--only-binary=:all:",
                "--index-url",
                definitions["approved_index"],
                "--dest",
                str(package_download),
                f"{normalized}=={version}",
            ],
            env=environment,
        )
        downloaded = select_downloaded_wheel(package_download)
        try:
            assert_standard_cp313_artifact(downloaded.name)
        except ValueError as error:
            raise SystemExit(str(error)) from error
        destination = wheel_root / downloaded.name
        shutil.copyfile(downloaded, destination)
        metadata = inspect_wheel(destination, environment)
        if canonicalize_name(str(metadata["package_name"])) != normalized:
            raise SystemExit(f"wheel METADATA name mismatch for {normalized}")
        if Version(str(metadata["version"])) != Version(str(version)):
            raise SystemExit(f"wheel METADATA version mismatch for {normalized}")
        provenance = exact_pypi_artifact(normalized, str(version), destination.name, sha256_file(destination))
        dependencies: list[str] = []
        declarations: list[dict[str, object]] = []
        for raw in metadata["requires_dist_raw"]:
            requirement = Requirement(str(raw))
            dependency = canonicalize_name(requirement.name)
            applicable = marker_applies(requirement, marker_environment, extras.get(normalized, []))
            if applicable:
                dependency_version = versions.get(dependency)
                if not dependency_version:
                    raise SystemExit(
                        f"{normalized} requires {raw}, but {dependency} has no approved exact version"
                    )
                if requirement.specifier and Version(str(dependency_version)) not in requirement.specifier:
                    raise SystemExit(
                        f"{normalized} requires {raw}, but approved {dependency}=={dependency_version} is incompatible"
                    )
                if dependency not in dependencies:
                    dependencies.append(dependency)
                    pending.append(dependency)
                declarations.append(
                    {
                        "requirement": raw,
                        "package_name": requirement.name,
                        "disposition": "INCLUDED",
                        "dependency": dependency,
                        "reason": "",
                    }
                )
            else:
                declarations.append(
                    {
                        "requirement": raw,
                        "package_name": requirement.name,
                        "disposition": "NOT_APPLICABLE",
                        "dependency": None,
                        "reason": (
                            f"Marker evaluated false for {target_name}/CPython "
                            f"{definitions['python_version']} with extras "
                            f"{extras.get(normalized, []) or ['<none>']}."
                        ),
                    }
                )
        resolved[normalized] = {
            "name": metadata["package_name"],
            "version": metadata["version"],
            "metadata": metadata,
            "provenance": provenance,
            "dependencies": sorted(dependencies),
            "dependency_declarations": declarations,
            "direct": normalized in direct,
            "selected_extras": extras.get(normalized, []),
        }

    resolution = {
        "schema_version": "1",
        "target": target_name,
        "scope": scope_name,
        "python_version": definitions["python_version"],
        "approved_index": definitions["approved_index"],
        "resolver": "Code C metadata closure using packaging 25.0 markers",
        "runtime_identity": {
            "sha256": sha256_file(runtime_identity_path),
            "distribution_sha256": runtime_identity["distribution"]["sha256"],
            "python_free_threaded": runtime_identity["interpreter"]["python_free_threaded"],
            "python_abi": runtime_identity["interpreter"]["python_abi"],
            "target_descriptor_sha256": runtime_identity["target_descriptor"]["sha256"],
        },
        "marker_environment": marker_environment,
        "extras_reason": scope["extras_reason"],
        "packages": [resolved[name] for name in sorted(resolved)],
    }
    resolution_path = output_root / "resolution" / f"{target_name}-{scope_name}.json"
    resolution_path.parent.mkdir(parents=True, exist_ok=True)
    write_canonical_json(resolution_path, resolution)

    candidate_path = output_root / "candidates" / f"code-c-{target_name}-{scope_name}.v2.json"
    candidate_path.parent.mkdir(parents=True, exist_ok=True)
    arguments = [
        "node",
        str(CANDIDATE_TOOL),
        "--artifact-root",
        str(wheel_root),
        "--scope",
        scope["inventory_scope"],
        "--schema-version",
        "2",
        "--target-descriptor",
        str(target_descriptor),
        "--inventory-id",
        f"code-c-{target_name}-{scope_name}-py31315",
        "--source-index",
        definitions["approved_index"],
        "--source-base",
        "https://pypi.org/project",
        "--download-base",
        "https://files.pythonhosted.org/packages",
        "--supplier",
        "Python Package Index upstream project maintainers",
    ]
    for package in direct:
        arguments.extend(["--direct", package])
    arguments.extend(["--output", str(candidate_path)])
    run(arguments, env=environment)
    candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
    serialized = serialize_candidate_from_resolution(candidate, resolution)
    write_canonical_json(candidate_path, serialized)
    print(f"generated {target_name}/{scope_name}: {len(resolved)} wheels")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument(
        "--scope",
        action="append",
        choices=["runtime", "worker-build", "model-export", "model-evaluation"],
        dest="scopes",
        help="Generate only the selected scope. Repeat for multiple scopes; defaults to all target scopes.",
    )
    parser.add_argument("--target-descriptor", type=Path, required=True)
    parser.add_argument("--runtime-identity", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    arguments = parser.parse_args()
    try:
        locked_python = require_locked_python_environment()
        environment = hermetic_environment()
    except ValueError as error:
        raise SystemExit(str(error)) from error
    if packaging.__version__ != "25.0":
        raise SystemExit(f"marker resolver requires locked packaging 25.0, got {packaging.__version__}")
    environment["PYTHON_EXECUTABLE"] = str(locked_python)
    descriptor = json.loads(arguments.target_descriptor.read_text(encoding="utf-8"))
    runtime_identity = json.loads(arguments.runtime_identity.read_text(encoding="utf-8"))
    try:
        graph_attestation = attest_locked_interpreter(
            locked_python,
            target=arguments.target,
            target_descriptor=descriptor,
            environment=environment,
        )
    except ValueError as error:
        raise SystemExit(str(error)) from error
    recorded_locked_interpreter = runtime_identity.get("locked_interpreter", {})
    if (
        recorded_locked_interpreter.get("status") != "PASS"
        or recorded_locked_interpreter.get("executable") != graph_attestation["executable"]
        or recorded_locked_interpreter.get("executable_sha256")
        != graph_attestation["executable_sha256"]
        or recorded_locked_interpreter.get("runtime_library_sha256")
        != graph_attestation["runtime_library_sha256"]
    ):
        raise SystemExit("candidate generation locked interpreter differs from runtime evidence")
    arguments.output_root.mkdir(parents=True, exist_ok=True)
    graph_attestation_path = (
        arguments.output_root / "evidence" / f"{arguments.target}-graph-interpreter-attestation.json"
    )
    graph_attestation_path.parent.mkdir(parents=True, exist_ok=True)
    write_canonical_json(
        graph_attestation_path,
        {
            "schema_version": "1",
            **graph_attestation,
            "target_descriptor": {
                "path": str(arguments.target_descriptor),
                "sha256": sha256_file(arguments.target_descriptor),
            },
            "runtime_identity": {
                "path": str(arguments.runtime_identity),
                "sha256": sha256_file(arguments.runtime_identity),
            },
        },
    )
    run(
        [
            "node",
            str(TARGET_TOOL),
            "verify-current",
            "--target",
            str(arguments.target_descriptor),
        ],
        env=environment,
    )
    definitions = json.loads(DEFINITIONS_PATH.read_text(encoding="utf-8"))
    if definitions["python_version"] != "3.13.15":
        raise SystemExit("dependency definitions must bind approved CPython 3.13.15")
    if (
        runtime_identity.get("status") != "PASS"
        or runtime_identity.get("interpreter", {}).get("version") != "3.13.15"
        or runtime_identity.get("interpreter", {}).get("python_free_threaded") is not False
        or runtime_identity.get("interpreter", {}).get("python_abi") != "cp313"
        or runtime_identity.get("target_descriptor", {}).get("sha256")
        != sha256_file(arguments.target_descriptor)
    ):
        raise SystemExit("candidate generation requires matching standard-GIL cp313 runtime evidence")
    selected_scopes = set(arguments.scopes or definitions["scopes"].keys())
    for scope_name, scope in definitions["scopes"].items():
        if scope_name not in selected_scopes:
            continue
        if arguments.target not in scope["targets"]:
            continue
        resolve_scope(
            scope_name,
            scope,
            definitions,
            arguments.target,
            arguments.target_descriptor,
            arguments.runtime_identity,
            runtime_identity,
            arguments.output_root,
            environment,
        )


if __name__ == "__main__":
    main()
