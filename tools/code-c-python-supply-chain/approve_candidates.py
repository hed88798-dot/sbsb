from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

from packaging.utils import canonicalize_name

from policy import assert_exact_wheel_url, hermetic_environment, sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFINITIONS = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "dependency-definitions.json"
)
PYTHON_CLI = REPOSITORY_ROOT / "tools" / "python-supply-chain" / "cli.mjs"
REQUIRE_HASHES = (
    REPOSITORY_ROOT / "tools" / "python-supply-chain" / "generate-require-hashes.mjs"
)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def run(arguments: list[str], environment: dict[str, str]) -> None:
    result = subprocess.run(
        arguments,
        cwd=REPOSITORY_ROOT,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise SystemExit(result.stderr.strip() or result.stdout.strip() or "approval verifier failed")


def approved_license(
    package: dict[str, object],
    resolution: dict[str, object],
    target: str,
) -> tuple[str, str]:
    metadata = resolution["metadata"]
    expression = metadata.get("license_expression")
    if expression:
        return str(expression), "Upstream wheel License-Expression was verified byte-for-byte."
    normalized = canonicalize_name(str(package["package_name"]))
    if normalized == "pyinstaller":
        evidence_name = "windows-x86_64.scan.json" if target == "windows" else "linux-x86_64.scan.json"
        evidence = json.loads(
            (
                REPOSITORY_ROOT
                / "compliance"
                / "license-evidence"
                / "pyinstaller-6.22.2"
                / evidence_name
            ).read_text(encoding="utf-8")
        )
        if (
            evidence["artifact"]["sha256"] != package["sha256"]
            or evidence["artifact"]["filename"] != package["filename"]
            or evidence["package_license"]["metadata_status"]
            != "LEGACY_DESCRIPTION_REVIEWED"
            or metadata.get("legacy_license")
            != next(
                source["value"]
                for source in evidence["package_license"]["evidence_sources"]
                if source["evidence_type"] == "METADATA_LICENSE_DESCRIPTION"
            )
        ):
            raise SystemExit("PyInstaller candidate differs from public Artifact License Evidence v2")
        return (
            str(evidence["package_license"]["expression"]),
            "Expression comes from exact public Artifact License Evidence v2; usage approval remains build-context-bound.",
        )
    legacy = str(metadata.get("legacy_license") or "").strip()
    if legacy:
        return legacy, "Exact legacy wheel License value is retained for the shared policy gate."
    return "UNKNOWN", "Wheel metadata contains no license expression or legacy License value."


def native_path(
    scope_name: str,
    native: dict[str, object],
    inspection: dict[str, object] | None,
) -> str:
    if scope_name != "runtime":
        return f"installed-environment/{scope_name}/{native['relative_path']}"
    if inspection is None:
        raise SystemExit("runtime approval requires actual one-file CArchive inspection evidence")
    matches = [
        entry
        for entry in inspection["native_artifacts"]
        if entry["sha256"] == native["sha256"] and entry["filename"] == native["filename"]
    ]
    if len(matches) != 1:
        raise SystemExit(
            f"runtime native {native['relative_path']} has {len(matches)} exact CArchive matches"
        )
    return str(matches[0]["internal_path"])


def approve_scope(
    target: str,
    scope_name: str,
    bundle: Path,
    artifact_root: Path,
    inventory_root: Path,
    lock_root: Path,
    reviewed_at: str,
    environment: dict[str, str],
) -> None:
    candidate_path = bundle / "candidates" / f"code-c-{target}-{scope_name}.v2.json"
    resolution_path = bundle / "resolution" / f"{target}-{scope_name}.json"
    candidate = json.loads(candidate_path.read_text(encoding="utf-8"))
    resolution = json.loads(resolution_path.read_text(encoding="utf-8"))
    if candidate["graph_complete"] or any(
        package["provenance"]["review_status"] != "PENDING" for package in candidate["packages"]
    ):
        raise SystemExit(f"{target}/{scope_name}: input is not an unapproved candidate")
    resolved = {
        canonicalize_name(package["name"]): package for package in resolution["packages"]
    }
    if set(resolved) != {
        canonicalize_name(package["package_name"]) for package in candidate["packages"]
    }:
        raise SystemExit(f"{target}/{scope_name}: candidate differs from metadata resolution")
    inspection_path = bundle / "inspection" / f"{target}-worker-onefile.json"
    inspection = (
        json.loads(inspection_path.read_text(encoding="utf-8"))
        if inspection_path.is_file()
        else None
    )
    approved_packages = []
    for package in candidate["packages"]:
        normalized = canonicalize_name(package["package_name"])
        item = resolved[normalized]
        source = bundle / "wheels" / scope_name / package["filename"]
        if sha256_file(source) != package["sha256"] or package["sha256"] != item["provenance"]["sha256"]:
            raise SystemExit(f"{target}/{scope_name}/{normalized}: wheel hash drift")
        provenance = item["provenance"]
        assert_exact_wheel_url(str(provenance["download_url"]))
        relative_artifact = Path(target) / scope_name / package["filename"]
        destination = artifact_root / relative_artifact
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        if sha256_file(destination) != package["sha256"]:
            raise SystemExit(f"{target}/{scope_name}/{normalized}: approved artifact copy drift")
        license_expression, license_note = approved_license(package, item, target)
        by_dependency = {
            canonicalize_name(other["name"]): f"pkg:pypi/{canonicalize_name(other['name'])}@{other['version']}"
            for other in resolution["packages"]
        }
        dependencies = [by_dependency[name] for name in item["dependencies"]]
        declarations = []
        for declaration in item["dependency_declarations"]:
            dependency = declaration["dependency"]
            declarations.append(
                {
                    "requirement": declaration["requirement"],
                    "package_name": declaration["package_name"],
                    "disposition": declaration["disposition"],
                    "purl": by_dependency[dependency] if dependency else None,
                    "reason": declaration["reason"],
                }
            )
        package.update(
            {
                "artifact_path": relative_artifact.as_posix(),
                "source": provenance["source"],
                "source_index": provenance["source_index"],
                "license_expression": license_expression,
                "provenance": {
                    "supplier": "Python Package Index upstream project maintainers",
                    "download_url": provenance["download_url"],
                    "review_status": "APPROVED",
                    "reviewed_at": reviewed_at,
                    "upstream_signature": None,
                    "notes": (
                        f"Exact PyPI artifact and target metadata closure reviewed. {license_note} "
                        f"Selected extras: {item['selected_extras'] or ['<none>']}."
                    ),
                },
                "direct": item["direct"],
                "dependencies": sorted(dependencies),
                "dependency_declarations": declarations,
                "native_artifacts": [
                    {
                        "filename": native["filename"],
                        "relative_path": native["relative_path"],
                        "packaged_relative_path": native_path(scope_name, native, inspection),
                        "sha256": native["sha256"],
                        "type": native["type"],
                        "source_package": package["package_name"],
                    }
                    for native in item["metadata"]["native_artifacts"]
                ],
            }
        )
        approved_packages.append(package)
    approved = {**candidate, "graph_complete": True, "packages": approved_packages}
    output = inventory_root / target / f"{scope_name}.v2.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(canonical_json(approved), encoding="utf-8")
    run(
        [
            "node",
            str(PYTHON_CLI),
            "verify",
            "--inventory",
            str(output),
            "--artifact-root",
            str(artifact_root),
        ],
        environment,
    )
    lock = lock_root / f"{target}-{scope_name}.requirements.txt"
    run(
        [
            "node",
            str(REQUIRE_HASHES),
            "--inventory",
            str(output),
            "--artifact-root",
            str(artifact_root),
            "--output",
            str(lock),
        ],
        environment,
    )
    print(f"candidate-approval: PASS ({target}/{scope_name}; {len(approved_packages)} wheels)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--reviewed-at", required=True)
    parser.add_argument(
        "--inventory-root",
        type=Path,
        default=REPOSITORY_ROOT / "compliance" / "python-artifacts",
    )
    parser.add_argument(
        "--lock-root",
        type=Path,
        default=REPOSITORY_ROOT / "sidecars" / "media-worker" / "supply-chain" / "locks",
    )
    arguments = parser.parse_args()
    try:
        environment = hermetic_environment()
    except ValueError as error:
        raise SystemExit(str(error)) from error
    definitions = json.loads(DEFINITIONS.read_text(encoding="utf-8"))
    for scope_name, scope in definitions["scopes"].items():
        if arguments.target in scope["targets"]:
            approve_scope(
                arguments.target,
                scope_name,
                arguments.bundle,
                arguments.artifact_root,
                arguments.inventory_root,
                arguments.lock_root,
                arguments.reviewed_at,
                environment,
            )


if __name__ == "__main__":
    main()
