from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import zipfile
from pathlib import Path, PurePosixPath

from canonical_evidence import write_canonical_json
from policy import hermetic_environment, sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "toolchain-source-lock.json"
)
PYINSTALLER_QUALITY_LOCK = (
    REPOSITORY_ROOT
    / "compliance"
    / "quality-tooling"
    / "python"
    / "pyinstaller-archive-inspector-6.22.2.lock.json"
)
PYTHON_CLI = REPOSITORY_ROOT / "tools" / "python-supply-chain" / "cli.mjs"


def copy_exact(source: Path, destination: Path, expected_hash: str) -> None:
    if sha256_file(source) != expected_hash:
        raise SystemExit(f"source artifact hash drift: {source.name}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)
    if sha256_file(destination) != expected_hash:
        raise SystemExit(f"approved artifact copy drift: {destination.name}")


def verify_wheel_license_files(
    wheel: Path, expected: list[dict[str, object]], label: str
) -> None:
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise SystemExit(f"{label} wheel contains duplicate archive paths")
        for name in names:
            path = PurePosixPath(name)
            if path.is_absolute() or ".." in path.parts or "\\" in name:
                raise SystemExit(f"{label} wheel contains unsafe path: {name}")
        for entry in expected:
            relative_path = str(entry["relative_path"])
            matches = [name for name in names if name == relative_path]
            if len(matches) != 1:
                raise SystemExit(
                    f"{label} wheel has {len(matches)} exact license files: {relative_path}"
                )
            actual_hash = hashlib.sha256(archive.read(matches[0])).hexdigest()
            if actual_hash != entry["sha256"]:
                raise SystemExit(f"{label} wheel license evidence hash drift: {relative_path}")


def vulnerability(
    review: dict[str, object], component_id: str, version: str, artifact_sha256: str
) -> dict[str, object]:
    item = review["components"].get(component_id)
    if not item:
        raise SystemExit(f"vulnerability review missing component: {component_id}")
    if item["version"] != version or item["artifact_sha256"] != artifact_sha256:
        raise SystemExit(f"vulnerability review identity drift: {component_id}")
    if item["advisory_ids"]:
        raise SystemExit(f"vulnerability review has unresolved advisories: {component_id}")
    return {
        "source_type": item["source_type"],
        "data_source": item["data_source"],
        "review_status": "APPROVED",
        "reviewed_at": review["reviewed_at"],
        "review_expires_at": review["review_expires_at"],
        "advisory_ids": [],
        "unsupported_policy": item["unsupported_policy"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--reviewed-at", required=True)
    parser.add_argument("--vulnerability-review", type=Path, required=True)
    arguments = parser.parse_args()
    try:
        environment = hermetic_environment()
    except ValueError as error:
        raise SystemExit(str(error)) from error
    source_lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
    target_lock = source_lock["targets"][arguments.target]
    evidence_path = arguments.bundle / "evidence" / f"{arguments.target}-target-evidence.json"
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    if evidence["status"] != "PASS" or evidence["unknown_native_artifacts"]:
        raise SystemExit("toolchain approval requires closed target-native evidence")
    review = json.loads(arguments.vulnerability_review.read_text(encoding="utf-8"))
    if review.get("schema_version") != "1":
        raise SystemExit("toolchain vulnerability review schema is invalid")

    target_source = arguments.bundle / "toolchain" / arguments.target
    cpython_license = evidence["actual_sources"]["cpython_distribution"][
        "installed_license"
    ]
    cpython_license_source = arguments.bundle / cpython_license["evidence_path"]
    cpython_license_destination = (
        REPOSITORY_ROOT
        / "compliance"
        / "license-evidence"
        / "cpython-3.13.15"
        / f"{arguments.target}.LICENSE.txt"
    )
    copy_exact(cpython_license_source, cpython_license_destination, cpython_license["sha256"])
    distribution = target_lock["cpython_distribution"]
    pip = source_lock["pip"]
    pyinstaller = target_lock["pyinstaller"]
    bootloader = evidence["actual_sources"]["pyinstaller_bootloader"]
    source_paths = {
        "cpython": target_source / distribution["filename"],
        "pip": target_source / pip["filename"],
        "pyinstaller": target_source / pyinstaller["filename"],
        "bootloader": target_source / "bootloader" / bootloader["filename"],
    }
    relative_paths = {
        "cpython": Path(arguments.target) / "cpython" / distribution["filename"],
        "pip": Path(arguments.target) / "pip" / pip["filename"],
        "pyinstaller": Path(arguments.target) / "pyinstaller" / pyinstaller["filename"],
        "bootloader": Path(arguments.target) / "bootloader" / bootloader["filename"],
    }
    hashes = {
        "cpython": distribution["sha256"],
        "pip": pip["sha256"],
        "pyinstaller": pyinstaller["sha256"],
        "bootloader": bootloader["sha256"],
    }
    for key in source_paths:
        copy_exact(source_paths[key], arguments.artifact_root / relative_paths[key], hashes[key])

    pyinstaller_lock = json.loads(PYINSTALLER_QUALITY_LOCK.read_text(encoding="utf-8"))
    pyinstaller_component = next(
        item for item in pyinstaller_lock["components"] if item["package_name"] == "pyinstaller"
    )
    verify_wheel_license_files(source_paths["pip"], pip["license_files"], "pip")
    verify_wheel_license_files(
        source_paths["pyinstaller"],
        pyinstaller_component["license_files"],
        "PyInstaller",
    )
    ids = {
        "cpython": f"cpython-{source_lock['python_version'].replace('.', '')}-{arguments.target}-x64",
        "pip": f"pip-{pip['version'].replace('.', '')}-{arguments.target}-x64",
        "pyinstaller": f"pyinstaller-6222-{arguments.target}-x64",
        "bootloader": f"pyinstaller-bootloader-6222-{arguments.target}-x64",
    }
    shared_target = {
        "implementation": "cpython",
        "python_version": source_lock["python_version"],
        "os": arguments.target,
        "architecture": "x86_64",
    }
    components = [
        {
            "component_id": ids["cpython"],
            "component_kind": "CPYTHON_DISTRIBUTION",
            "name": "CPython actions/setup-python distribution",
            "version": source_lock["python_version"],
            "usage_scopes": ["BUILD_TOOLCHAIN_COMPONENT", "PACKAGED_RUNTIME_COMPONENT"],
            "platform": arguments.target,
            "architecture": "x86_64",
            "artifact": {
                "artifact_type": "distribution",
                "filename": distribution["filename"],
                "artifact_path": relative_paths["cpython"].as_posix(),
                "sha256": hashes["cpython"],
                "canonical_reference": distribution["download_url"],
                "canonical_source": distribution["canonical_source"],
            },
            "provenance": {
                "supplier": "GitHub Actions python-versions build pipeline from CPython source",
                "review_status": "APPROVED",
                "reviewed_at": arguments.reviewed_at,
                "notes": (
                    f"Exact distribution consumed by actions/setup-python on {target_lock['runner']}; "
                    "inventory records the real setup-python artifact, not a substitute installer."
                ),
            },
            "license": {
                "expression": source_lock["cpython_license_expression"],
                "files": [
                    {
                        "relative_path": cpython_license_destination.relative_to(
                            REPOSITORY_ROOT
                        ).as_posix(),
                        "sha256": cpython_license["sha256"],
                    }
                ],
                "review_status": "APPROVED",
                "redistribution_evidence": source_lock["cpython_license_reference"],
            },
            "vulnerability": vulnerability(
                review, ids["cpython"], source_lock["python_version"], hashes["cpython"]
            ),
            "reason_included": "Provides the exact interpreter and CPython runtime bytes used by the worker build.",
            "packaged_native_artifacts": [
                {
                    "filename": native["filename"],
                    "internal_path": native["internal_path"],
                    "sha256": native["sha256"],
                    "size": native["size"],
                    "type": native["type"],
                    "reason_included": (
                        f"PyInstaller embedded exact CPython installation byte {native['source_installed_path']}."
                    ),
                    "build_layer": "CARCHIVE_PAYLOAD",
                }
                for native in evidence["cpython_native_mapping"]
            ],
            "dependencies": [],
        },
        {
            "component_id": ids["pip"],
            "component_kind": "PIP",
            "name": "pip",
            "version": pip["version"],
            "usage_scopes": ["BUILD_TOOLCHAIN_COMPONENT"],
            "platform": "any",
            "architecture": "any",
            "artifact": {
                "artifact_type": "wheel",
                "filename": pip["filename"],
                "artifact_path": relative_paths["pip"].as_posix(),
                "sha256": hashes["pip"],
                "canonical_reference": pip["download_url"],
                "canonical_source": pip["canonical_source"],
            },
            "provenance": {
                "supplier": "Python Packaging Authority (PyPA)",
                "review_status": "APPROVED",
                "reviewed_at": arguments.reviewed_at,
                "notes": "Extracted directly into a venv created without pip; no runner-bundled pip is used.",
            },
            "license": {
                "expression": pip["license_expression"],
                "files": pip["license_files"],
                "review_status": "APPROVED",
                "redistribution_evidence": pip["license_reference"],
            },
            "vulnerability": vulnerability(review, ids["pip"], pip["version"], hashes["pip"]),
            "reason_included": "Performs all exact wheel installations with --require-hashes.",
            "packaged_native_artifacts": [],
            "dependencies": [ids["cpython"]],
        },
        {
            "component_id": ids["pyinstaller"],
            "component_kind": "PYINSTALLER",
            "name": "PyInstaller",
            "version": pyinstaller["version"],
            "usage_scopes": ["BUILD_TOOLCHAIN_COMPONENT"],
            "platform": arguments.target,
            "architecture": "x86_64",
            "artifact": {
                "artifact_type": "wheel",
                "filename": pyinstaller["filename"],
                "artifact_path": relative_paths["pyinstaller"].as_posix(),
                "sha256": hashes["pyinstaller"],
                "canonical_reference": pyinstaller["download_url"],
                "canonical_source": pyinstaller["canonical_source"],
            },
            "provenance": {
                "supplier": "PyInstaller Development Team",
                "review_status": "APPROVED",
                "reviewed_at": arguments.reviewed_at,
                "notes": "Exact target wheel is also present in the approved WORKER_BUILD dependency graph.",
            },
            "license": {
                "expression": source_lock["pyinstaller_license_expression"],
                "files": pyinstaller_component["license_files"],
                "review_status": "APPROVED",
                "redistribution_evidence": source_lock["pyinstaller_license_reference"],
            },
            "vulnerability": vulnerability(
                review, ids["pyinstaller"], pyinstaller["version"], hashes["pyinstaller"]
            ),
            "reason_included": "Builds the final one-file media worker.",
            "packaged_native_artifacts": [],
            "dependencies": [ids["cpython"], ids["pip"]],
        },
        {
            "component_id": ids["bootloader"],
            "component_kind": "PYINSTALLER_BOOTLOADER",
            "name": "PyInstaller target bootloader",
            "version": pyinstaller["version"],
            "usage_scopes": ["BUILD_TOOLCHAIN_COMPONENT", "PACKAGED_RUNTIME_COMPONENT"],
            "platform": arguments.target,
            "architecture": "x86_64",
            "artifact": {
                "artifact_type": "bootloader",
                "filename": bootloader["filename"],
                "artifact_path": relative_paths["bootloader"].as_posix(),
                "sha256": hashes["bootloader"],
                "canonical_reference": pyinstaller["download_url"],
                "canonical_source": pyinstaller["canonical_source"],
            },
            "provenance": {
                "supplier": "PyInstaller Development Team",
                "review_status": "APPROVED",
                "reviewed_at": arguments.reviewed_at,
                "notes": (
                    f"Extracted unchanged from {pyinstaller['filename']} at {bootloader['installed_path']}; "
                    "final PE/ELF bootloader-layer hash is bound separately by Build Provenance."
                ),
            },
            "license": {
                "expression": source_lock["pyinstaller_license_expression"],
                "files": pyinstaller_component["license_files"],
                "review_status": "APPROVED",
                "redistribution_evidence": source_lock["pyinstaller_license_reference"],
            },
            "vulnerability": vulnerability(
                review, ids["bootloader"], pyinstaller["version"], hashes["bootloader"]
            ),
            "reason_included": "Forms the executable layer of the final one-file worker.",
            "packaged_native_artifacts": [],
            "dependencies": [ids["pyinstaller"]],
        },
    ]
    inventory = {
        "schema_version": "1",
        "inventory_id": f"code-c-{arguments.target}-toolchain-py31315",
        "target": shared_target,
        "graph_complete": True,
        "components": components,
    }
    output = REPOSITORY_ROOT / "compliance" / "python-toolchain" / f"{arguments.target}.v1.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    write_canonical_json(output, inventory)
    result = subprocess.run(
        [
            "node",
            str(PYTHON_CLI),
            "toolchain-verify",
            "--toolchain-inventory",
            str(output),
            "--toolchain-artifact-root",
            str(arguments.artifact_root),
        ],
        cwd=REPOSITORY_ROOT,
        env=environment,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise SystemExit(result.stderr.strip() or result.stdout.strip())
    print(f"toolchain-approval: PASS ({arguments.target}; 4 exact components)")


if __name__ == "__main__":
    main()
