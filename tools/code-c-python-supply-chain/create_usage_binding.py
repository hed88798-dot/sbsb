from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PYTHON_CLI = REPOSITORY_ROOT / "tools" / "python-supply-chain" / "cli.mjs"


def canonical_compact_hash(value: object) -> str:
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(payload.encode()).hexdigest()


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def normalized(value: str) -> str:
    return value.lower().replace("_", "-")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--build-provenance", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--evaluation-output", type=Path, required=True)
    arguments = parser.parse_args()

    evidence_path = (
        REPOSITORY_ROOT
        / "compliance"
        / "license-evidence"
        / "pyinstaller-6.22.2"
        / (
            "windows-x86_64.scan.json"
            if arguments.target == "windows"
            else "linux-x86_64.scan.json"
        )
    )
    inventory_path = (
        REPOSITORY_ROOT
        / "compliance"
        / "python-artifacts"
        / arguments.target
        / "worker-build.v2.json"
    )
    toolchain_path = (
        REPOSITORY_ROOT / "compliance" / "python-toolchain" / f"{arguments.target}.v1.json"
    )
    policy_path = (
        REPOSITORY_ROOT / "compliance" / "license-policy" / "python-spdx-v1" / "policy.json"
    )
    evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    toolchain = json.loads(toolchain_path.read_text(encoding="utf-8"))
    build = json.loads(arguments.build_provenance.read_text(encoding="utf-8"))
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    wheel = next(
        (package for package in inventory["packages"] if normalized(package["package_name"]) == "pyinstaller"),
        None,
    )
    tool = next(
        (component for component in toolchain["components"] if component["component_kind"] == "PYINSTALLER"),
        None,
    )
    if wheel is None or tool is None:
        raise SystemExit("formal worker-build/toolchain records must contain PyInstaller")
    if (
        build.get("schema_version") != "1"
        or build.get("target", {}).get("os") != arguments.target
        or build.get("target", {}).get("architecture") != "x86_64"
        or build.get("target", {}).get("python_version") != "3.13.15"
    ):
        raise SystemExit("Build Provenance target differs from the requested formal target")
    artifact_hash = evidence["artifact"]["sha256"]
    if wheel["sha256"] != artifact_hash or tool["artifact"]["sha256"] != artifact_hash:
        raise SystemExit("PyInstaller evidence, wheel inventory and toolchain identity differ")
    if build["inputs"]["pyinstaller_component_id"] != tool["component_id"]:
        raise SystemExit("Build Provenance does not reference the exact PyInstaller component")

    policy_hash = canonical_compact_hash(policy)
    build_hash = canonical_compact_hash(build)
    binding = {
        "schema_version": "1",
        "usage_binding_id": f"{build['build_id']}-pyinstaller-build-tool",
        "artifact_sha256": artifact_hash,
        "artifact_references": {
            "license_evidence_artifact_sha256": artifact_hash,
            "toolchain_artifact_sha256": artifact_hash,
            "build_sbom_artifact_sha256": artifact_hash,
        },
        "build_context": {
            "build_context_id": build["build_id"],
            "build_provenance_schema_version": "1",
            "build_provenance_identity_sha256": build_hash,
        },
        "dependency_role": "PYTHON_BUILD_DEPENDENCY",
        "functional_role": "PYINSTALLER_BUILD_TOOL",
        "distribution_role": "BUILD_ONLY",
        "exception_binding": {
            "artifact_sha256": artifact_hash,
            "build_context_id": build["build_id"],
            "detected_license_expression": evidence["package_license"]["expression"],
            "functional_role": "PYINSTALLER_BUILD_TOOL",
            "distribution_role": "BUILD_ONLY",
            "license_policy_version": policy["license_policy_version"],
            "license_policy_sha256": policy_hash,
            "evidence_source_ids": [
                "copying-license-and-exception",
                "pyinstaller-license-page",
            ],
        },
        "policy_binding": {
            "license_policy_version": policy["license_policy_version"],
            "license_policy_sha256": policy_hash,
        },
        "reachability": {
            "build_sbom": "INCLUDED",
            "runtime_sbom": "EXCLUDED_BUILD_ONLY",
            "internal_compliance": "RETAINED",
            "customer_notice": "EXCLUDED_BUILD_ONLY",
        },
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(canonical_json(binding), encoding="utf-8")
    arguments.evaluation_output.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            "node",
            str(PYTHON_CLI),
            "artifact-usage-license",
            "--artifact-license-evidence",
            str(evidence_path),
            "--artifact-usage-binding",
            str(arguments.output),
            "--build-provenance",
            str(arguments.build_provenance),
            "--toolchain-inventory",
            str(toolchain_path),
            "--output",
            str(arguments.evaluation_output),
        ],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise SystemExit(result.stderr.strip() or result.stdout.strip())
    print(result.stdout.strip())
    print(f"usage-binding-create: PASS ({arguments.target}; {artifact_hash}; {build['build_id']})")


if __name__ == "__main__":
    main()
