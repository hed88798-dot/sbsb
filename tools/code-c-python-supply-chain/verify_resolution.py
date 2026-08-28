from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import deque
from pathlib import Path

import packaging
from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name
from packaging.version import Version


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFINITIONS = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "dependency-definitions.json"
)
INSPECT_WHEEL = REPOSITORY_ROOT / "tools" / "python-supply-chain" / "inspect-wheel.py"


def inspect(path: Path) -> dict[str, object]:
    result = subprocess.run(
        [sys.executable, str(INSPECT_WHEEL), str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def applies(requirement: Requirement, environment: dict[str, str], extras: list[str]) -> bool:
    if requirement.marker is None:
        return True
    return any(
        requirement.marker.evaluate({**environment, "extra": extra}) for extra in (extras or [""])
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    arguments = parser.parse_args()
    if packaging.__version__ != "25.0":
        raise SystemExit("resolution verification requires locked packaging 25.0")
    definitions = json.loads(DEFINITIONS.read_text(encoding="utf-8"))
    environment = default_environment()
    if environment["python_full_version"] != definitions["python_version"]:
        raise SystemExit("current Python patch differs from dependency definitions")
    actual_target = "windows" if sys.platform == "win32" else "linux"
    if arguments.target != actual_target:
        raise SystemExit("resolution verification must run on its declared real target")
    versions = {
        canonicalize_name(name): str(version) for name, version in definitions["versions"].items()
    }
    verified_scopes = 0
    for scope_name, scope in definitions["scopes"].items():
        if arguments.target not in scope["targets"]:
            continue
        inventory_path = (
            REPOSITORY_ROOT
            / "compliance"
            / "python-artifacts"
            / arguments.target
            / f"{scope_name}.v2.json"
        )
        inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
        if inventory["target"]["python_version"] != definitions["python_version"]:
            raise SystemExit(f"{scope_name}: inventory target patch drift")
        packages = {
            canonicalize_name(package["package_name"]): package for package in inventory["packages"]
        }
        direct = {canonicalize_name(name) for name in scope["direct"]}
        selected_extras = {
            canonicalize_name(name): [str(value) for value in values]
            for name, values in scope.get("extras", {}).items()
        }
        pending = deque(sorted(direct))
        reachable: set[str] = set()
        while pending:
            name = pending.popleft()
            if name in reachable:
                continue
            package = packages.get(name)
            if not package:
                raise SystemExit(f"{scope_name}: metadata closure is missing {name}")
            reachable.add(name)
            if package["version"] != versions.get(name) or package["direct"] != (name in direct):
                raise SystemExit(f"{scope_name}: approved identity/direct flag drift for {name}")
            metadata = inspect(arguments.artifact_root / package["artifact_path"])
            expected_dependencies = []
            expected_declarations = []
            for raw in metadata["requires_dist_raw"]:
                requirement = Requirement(str(raw))
                dependency = canonicalize_name(requirement.name)
                if applies(requirement, environment, selected_extras.get(name, [])):
                    version = versions.get(dependency)
                    if not version:
                        raise SystemExit(f"{scope_name}: no exact version for {name} -> {raw}")
                    if requirement.specifier and Version(version) not in requirement.specifier:
                        raise SystemExit(f"{scope_name}: exact version violates {name} -> {raw}")
                    purl = f"pkg:pypi/{dependency}@{version}"
                    expected_dependencies.append(purl)
                    expected_declarations.append((raw, "INCLUDED", purl))
                    pending.append(dependency)
                else:
                    expected_declarations.append((raw, "NOT_APPLICABLE", None))
            actual_declarations = [
                (item["requirement"], item["disposition"], item["purl"])
                for item in package["dependency_declarations"]
            ]
            if sorted(set(expected_dependencies)) != sorted(package["dependencies"]):
                raise SystemExit(f"{scope_name}: dependency drift for {name}")
            if sorted(expected_declarations) != sorted(actual_declarations):
                raise SystemExit(f"{scope_name}: marker/extras declaration drift for {name}")
        if reachable != set(packages):
            raise SystemExit(f"{scope_name}: inventory contains packages outside metadata closure")
        verified_scopes += 1
    print(
        f"dependency-resolution-verify: PASS ({arguments.target}; {verified_scopes} scopes; "
        "markers/extras/closure match exact wheel METADATA)"
    )


if __name__ == "__main__":
    main()
