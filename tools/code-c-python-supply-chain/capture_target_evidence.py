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


def wheel_key(native: dict[str, object]) -> tuple[str, str, str]:
    return (str(native["purl"]), str(native["relative_path"]), str(native["sha256"]))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--distribution", type=Path, required=True)
    parser.add_argument("--pip-wheel", type=Path, required=True)
    parser.add_argument("--pyinstaller-wheel", type=Path, required=True)
    parser.add_argument("--build-context", type=Path, required=True)
    parser.add_argument("--build-evidence", type=Path, required=True)
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

    build_context = json.loads(arguments.build_context.read_text(encoding="utf-8"))
    build_evidence = json.loads(arguments.build_evidence.read_text(encoding="utf-8"))
    build_root = arguments.build_evidence.parent
    selected_path = build_root / build_evidence["selected_native_set"]["path"]
    materialized_path = build_root / build_evidence["materialized_native_set"]["path"]
    selected_document = json.loads(selected_path.read_text(encoding="utf-8"))
    materialized_document = json.loads(materialized_path.read_text(encoding="utf-8"))
    context_ids = {
        build_context["build_context_id"],
        build_evidence["build_context_id"],
        selected_document["build_context_id"],
        materialized_document["build_context_id"],
    }
    if len(context_ids) != 1:
        raise SystemExit("build context, selected set and materialized set identities differ")
    if (
        build_context["inputs"]["code_c_commit"] != subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=REPOSITORY_ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        or build_evidence["selected_set_capture"] != "COMPLETE"
        or build_evidence["staging_capture"] != "PASS"
    ):
        raise SystemExit("build evidence is incomplete or differs from the current Code C commit")
    if (
        sha256_file(selected_path) != build_evidence["selected_native_set"]["sha256"]
        or sha256_file(materialized_path) != build_evidence["materialized_native_set"]["sha256"]
    ):
        raise SystemExit("parsed selected/materialized evidence hash drift")

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
    selected = selected_document["entries"]
    materialized = materialized_document["entries"]
    selected_by_path = {str(item["internal_path"]): item for item in selected}
    materialized_by_path = {str(item["internal_path"]): item for item in materialized}
    final_by_path = {str(item["internal_path"]): item for item in inspection["native_artifacts"]}
    final_by_sha: dict[str, list[dict[str, object]]] = {}
    for item in inspection["native_artifacts"]:
        final_by_sha.setdefault(str(item["sha256"]), []).append(item)

    if len(selected_by_path) != len(selected) or len(materialized_by_path) != len(materialized):
        raise SystemExit("selected/materialized native set contains duplicate internal paths")

    wheel_by_key = {wheel_key(native): native for native in wheel_natives}
    selected_wheel_keys: set[tuple[str, str, str]] = set()
    final_wheel_keys: set[tuple[str, str, str]] = set()
    wheel_mapping = []
    cpython_mapping = []
    unknown = []
    selected_missing_paths = set()
    hash_match_recovered = 0
    for selected_item in selected:
        internal_path = str(selected_item["internal_path"])
        staged = materialized_by_path.get(internal_path)
        final = final_by_path.get(internal_path)
        if staged is None:
            raise SystemExit(f"selected native lacks materialized evidence: {internal_path}")
        owner = selected_item["source_owner"]
        if owner["resolution"] == "AMBIGUOUS":
            unknown.append(
                {
                    "internal_path": internal_path,
                    "classification": "UNRESOLVED",
                    "reason": "AMBIGUOUS_HASH_OWNER",
                    "selected": selected_item,
                }
            )
            continue
        selected_wheel_key = None
        if owner["owner_kind"] == "WHEEL_OWNED_NATIVE":
            selected_wheel_key = (
                str(owner["owner_reference"]),
                str(owner["source_native_relative_path"]),
                str(selected_item["source_sha256"]),
            )
            selected_wheel_keys.add(selected_wheel_key)
        if final is None:
            selected_missing_paths.add(internal_path)
            continue
        if (
            staged["materialized_sha256"] != final["sha256"]
            or staged["materialized_size"] != final["size"]
        ):
            unknown.append(
                {
                    **final,
                    "classification": "UNRESOLVED",
                    "reason": "MATERIALIZED_FINAL_IDENTITY_MISMATCH",
                    "selected": selected_item,
                    "materialized": staged,
                }
            )
            continue
        owner_kind = owner["owner_kind"]
        if owner_kind == "WHEEL_OWNED_NATIVE":
            if selected_wheel_key is None:
                raise SystemExit(f"selected wheel owner key was not captured: {internal_path}")
            key = selected_wheel_key
            final_wheel_keys.add(key)
            source = wheel_by_key.get(key)
            if source is None:
                unknown.append(
                    {
                        **final,
                        "classification": "UNRESOLVED",
                        "reason": "SELECTED_WHEEL_OWNER_NOT_IN_APPROVED_UNIVERSE",
                        "selected": selected_item,
                    }
                )
                continue
            wheel_mapping.append(
                {
                    "internal_path": internal_path,
                    "embedded_sha256": final["sha256"],
                    "embedded_size": final["size"],
                    "source_package": source["package_name"],
                    "source_purl": source["purl"],
                    "source_wheel_sha256": source["wheel_sha256"],
                    "source_relative_path": source["relative_path"],
                    "selected_source_path": selected_item["source_path"],
                    "materialized_sha256": staged["materialized_sha256"],
                }
            )
        elif owner_kind == "CPYTHON_TOOLCHAIN_NATIVE":
            cpython_mapping.append(
                {
                    **final,
                    "source_installed_path": owner["source_native_relative_path"],
                    "selected_source_path": selected_item["source_path"],
                    "source_cpython_artifact_sha256": owner["source_artifact_sha256"],
                    "materialized_sha256": staged["materialized_sha256"],
                }
            )
        elif owner_kind == "SYSTEM_BUILD_RUNTIME_NATIVE":
            system = owner["owner_reference"]
            if system.get("status") == "RESOLVED" and system.get("installation_status") == "installed":
                hash_match_recovered += 1
                unknown.append(
                    {
                        **final,
                        "classification": "U4_APPROVED_SYSTEM_BUILD_RUNTIME",
                        "selected_source_path": selected_item["source_path"],
                        "selected_source_sha256": selected_item["source_sha256"],
                        "materialized_sha256": staged["materialized_sha256"],
                        "system_package_provenance": system,
                        "approval_basis": "BUILD_CONTEXT_BOUND_UBUNTU_RUNNER_AND_INSTALLED_DPKG_IDENTITY",
                    }
                )
            else:
                unknown.append(
                    {
                        **final,
                        "classification": "UNRESOLVED",
                        "reason": "SYSTEM_SOURCE_PACKAGE_PROVENANCE_UNRESOLVED",
                        "selected": selected_item,
                    }
                )
        else:
            unknown.append(
                {
                    **final,
                    "classification": "UNRESOLVED",
                    "reason": "UNSUPPORTED_SELECTED_SOURCE_OWNER_KIND",
                    "selected": selected_item,
                }
            )

    missing = []
    missing_counts = {
        "M1_APPROVED_NOT_SELECTED": 0,
        "M2_SELECTED_BUT_MISSING": 0,
        "M3_RELOCATED_OR_RENAMED": 0,
        "M4_GRAPH_ERROR": 0,
        "UNRESOLVED": 0,
    }
    for native in wheel_natives:
        key = wheel_key(native)
        if key in final_wheel_keys:
            continue
        record = {**native}
        if key not in selected_wheel_keys:
            record.update(
                {
                    "classification": "M1_APPROVED_NOT_SELECTED",
                    "pyinstaller_selected": False,
                    "final_present": False,
                    "evidence": "COMPLETE_PKG_TOC_SELECTED_SET_HAS_NO_MATCHING_SOURCE_OWNER",
                }
            )
        else:
            relocated = final_by_sha.get(str(native["sha256"]), [])
            if len(relocated) == 1:
                record.update(
                    {
                        "classification": "M3_RELOCATED_OR_RENAMED",
                        "pyinstaller_selected": True,
                        "final_present": True,
                        "final_internal_path": relocated[0]["internal_path"],
                    }
                )
            else:
                record.update(
                    {
                        "classification": "M2_SELECTED_BUT_MISSING",
                        "pyinstaller_selected": True,
                        "final_present": False,
                    }
                )
        missing_counts[str(record["classification"])] += 1
        missing.append(record)

    unexpected_final_paths = sorted(set(final_by_path) - set(selected_by_path))
    for internal_path in unexpected_final_paths:
        final = final_by_path[internal_path]
        wheel_matches = [native for native in wheel_natives if native["sha256"] == final["sha256"]]
        python_matches = [native for native in installed if native["sha256"] == final["sha256"]]
        if len(wheel_matches) == 1:
            classification = "U1_WHEEL_PATH_MAPPING"
        elif len(python_matches) == 1:
            classification = "U2_TOOLCHAIN_OWNED"
        else:
            classification = "U5_TRULY_UNAPPROVED"
        unknown.append(
            {
                **final,
                "classification": classification,
                "reason": "FINAL_NATIVE_ABSENT_FROM_COMPLETE_PKG_SELECTED_SET",
                "wheel_hash_match_count": len(wheel_matches),
                "cpython_hash_match_count": len(python_matches),
            }
        )

    unknown_counts = {
        "U1_WHEEL_PATH_MAPPING": 0,
        "U2_TOOLCHAIN_OWNED": 0,
        "U3_BUNDLED_THIRD_PARTY": 0,
        "U4_APPROVED_SYSTEM_BUILD_RUNTIME": 0,
        "U5_TRULY_UNAPPROVED": 0,
        "UNRESOLVED": 0,
    }
    for item in unknown:
        unknown_counts[str(item["classification"])] += 1

    symlink_plan = {
        (str(item["internal_path"]), str(item["target_path"]).replace("\\", "/"))
        for item in build_evidence["pkg"]["symlink_metadata"]
    }
    final_symlinks = {
        (str(item["internal_path"]), str(item["symlink_target"]))
        for item in inspection["symlink_metadata"]
    }
    symlink_capture_matches = symlink_plan == final_symlinks
    selected_final_identity_complete = not selected_missing_paths and not unexpected_final_paths
    classification_complete = (
        missing_counts["UNRESOLVED"] == 0
        and unknown_counts["UNRESOLVED"] == 0
        and build_evidence["ambiguous_hash_owner_count"] == 0
        and selected_final_identity_complete
        and symlink_capture_matches
        and len(selected) == len(materialized) == len(inspection["native_artifacts"])
    )
    diagnostic_status = "PASS" if classification_complete else "INCOMPLETE"
    m1_proves_selected = missing_counts["M1_APPROVED_NOT_SELECTED"] > 0 and classification_complete
    qicr_required = m1_proves_selected
    if unknown_counts["U5_TRULY_UNAPPROVED"] > 0:
        owner_of_next_fix = "REAL_DEPENDENCY_BLOCKER"
    elif qicr_required:
        owner_of_next_fix = "CODE_F_QICR"
    else:
        owner_of_next_fix = "CODE_C"
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
        "schema_version": "2-diagnostic",
        "status": diagnostic_status,
        "build_context_id": build_context["build_context_id"],
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
        "native_reconciliation": {
            "approved_native_universe_count": len(wheel_natives) + len(installed),
            "approved_wheel_native_count": len(wheel_natives),
            "approved_cpython_native_count": len(installed),
            "pyinstaller_selected_native_count": len(selected),
            "pyinstaller_materialized_native_count": len(materialized),
            "final_embedded_native_count": len(inspection["native_artifacts"]),
            "symlink_metadata_count": len(inspection["symlink_metadata"]),
            "missing_classification": missing_counts,
            "unknown_classification": unknown_counts,
            "hash_match_recovered_count": hash_match_recovered,
            "ambiguous_hash_owner_count": build_evidence["ambiguous_hash_owner_count"],
            "classification_complete_and_exclusive": "PASS" if classification_complete else "FAIL",
        },
    }
    evidence_path = arguments.bundle / "evidence" / f"{target}-target-evidence.json"
    evidence_path.parent.mkdir(parents=True, exist_ok=True)
    evidence_path.write_text(canonical_json(evidence), encoding="utf-8")
    diagnostic = {
        "schema_name": "NATIVE_RECONCILIATION_DIAGNOSTIC",
        "schema_version": "2",
        "status": diagnostic_status,
        "mandatory_stop": "ACTIVE",
        "build_context_id": build_context["build_context_id"],
        "code_c_head_sha": build_context["inputs"]["code_c_commit"],
        "candidate_worker": inspection["final_artifact"],
        "previous_candidate_worker_sha256": "270cd37f1510417d5174a9adec9ee697be25b13fdf26708c93f267b22fb4af9f",
        "bit_for_bit_match_previous": (
            "YES"
            if inspection["final_artifact"]["sha256"]
            == "270cd37f1510417d5174a9adec9ee697be25b13fdf26708c93f267b22fb4af9f"
            else "NO"
        ),
        "clean_isolated_buildpath": build_context["clean_isolated_buildpath"],
        "evidence_capture_alters_build_inputs": build_context[
            "evidence_capture_alters_build_inputs"
        ],
        "pyinstaller_analysis_capture": build_evidence["analysis_capture"],
        "pyinstaller_toc_capture": build_evidence["toc_capture"],
        "pyinstaller_selected_set_capture": build_evidence["selected_set_capture"],
        "pyinstaller_staging_capture": build_evidence["staging_capture"],
        "final_carchive_capture": "PASS" if symlink_capture_matches else "FAIL",
        "raw_evidence": build_evidence["raw_evidence"],
        "selected_native_set": build_evidence["selected_native_set"],
        "materialized_native_set": build_evidence["materialized_native_set"],
        "final_carchive_identity": inspection["archive_payload"],
        "pyinstaller_version": build_evidence["pyinstaller_version"],
        "evidence_parser_version": build_evidence["evidence_parser_version"],
        "approved_native_universe_count": len(wheel_natives) + len(installed),
        "approved_wheel_native_count": len(wheel_natives),
        "approved_cpython_native_count": len(installed),
        "pyinstaller_selected_native_count": len(selected),
        "pyinstaller_materialized_native_count": len(materialized),
        "final_embedded_native_count": len(inspection["native_artifacts"]),
        "symlink_metadata_count": len(inspection["symlink_metadata"]),
        "missing_approved_native_count": len(missing),
        "missing_classification": missing_counts,
        "unknown_embedded_count": len(unknown),
        "unknown_classification": unknown_counts,
        "hash_match_recovered_count": hash_match_recovered,
        "ambiguous_hash_owner_count": build_evidence["ambiguous_hash_owner_count"],
        "ambiguous_hash_owner_resolution": build_evidence[
            "ambiguous_hash_owner_resolution"
        ],
        "selected_final_identity_complete": selected_final_identity_complete,
        "symlink_plan_final_match": symlink_capture_matches,
        "classification_complete_and_exclusive": "PASS" if classification_complete else "FAIL",
        "current_shared_contract_can_express_reality": "NO" if m1_proves_selected else "YES",
        "m1_proves_selected_set_required": "YES" if m1_proves_selected else "NO",
        "qicr_required": "YES" if qicr_required else "NO",
        "owner_of_next_fix": owner_of_next_fix,
        "missing_items": missing,
        "unknown_items": unknown,
        "blocked_not_rerun": [
            "CVE_2026_15806",
            "CVE_2026_15310",
            "REAL_SIGLIP_ONNX_E2E",
            "INDEX_REGRESSION",
            "WINDOWS_LATER_FAILURE",
        ],
    }
    diagnostic_path = arguments.bundle / "diagnostics" / f"{target}-native-reconciliation.json"
    diagnostic_path.parent.mkdir(parents=True, exist_ok=True)
    diagnostic_path.write_text(canonical_json(diagnostic), encoding="utf-8")
    raise SystemExit(
        f"native reconciliation diagnostic {diagnostic_status}; mandatory stop active; "
        f"owner={owner_of_next_fix}; M1={missing_counts['M1_APPROVED_NOT_SELECTED']}; "
        f"unknown={len(unknown)}"
    )


if __name__ == "__main__":
    main()
