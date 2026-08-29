from __future__ import annotations

import argparse
import ast
import datetime as dt
import hashlib
import json
import platform
import shutil
import subprocess
import sys
from collections import defaultdict
from pathlib import Path, PurePosixPath

import PyInstaller


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
EXPECTED_PYINSTALLER_VERSION = "6.22.2"
EVIDENCE_PARSER_VERSION = "code-c-pyinstaller-build-evidence-v1"
TOC_LAYOUT = {
    "Analysis": {
        "minimum_length": 20,
        "hiddenimports": 2,
        "scripts": 13,
        "pure": 14,
        "binaries": 15,
        "datas": 18,
    },
    "PYZ": {"minimum_length": 2, "toc": 1},
    "PKG": {"minimum_length": 11, "toc": 2},
    "EXE": {"minimum_length": 22, "toc": 15, "strip": 17, "upx": 18},
}


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def normalize_path(value: str) -> str:
    return value.replace("\\", "/")


def load_toc(path: Path, kind: str) -> tuple[object, ...]:
    try:
        value = ast.literal_eval(path.read_text(encoding="utf-8"))
    except (SyntaxError, ValueError) as error:
        raise SystemExit(f"{kind} TOC is not a safe Python literal: {path}: {error}") from error
    if not isinstance(value, tuple) or len(value) < int(TOC_LAYOUT[kind]["minimum_length"]):
        raise SystemExit(f"{kind} TOC has an unexpected PyInstaller 6.22.2 layout: {path}")
    return value


def toc_entries(value: object, label: str) -> list[tuple[str, str | None, str]]:
    if not isinstance(value, (list, tuple)):
        raise SystemExit(f"{label} is not a TOC sequence")
    output = []
    for index, item in enumerate(value):
        if not isinstance(item, (list, tuple)) or len(item) != 3:
            raise SystemExit(f"{label}[{index}] is not a three-field TOC entry")
        destination, source, category = item
        if not isinstance(destination, str) or not isinstance(category, str):
            raise SystemExit(f"{label}[{index}] contains a non-string destination/category")
        if source is not None and not isinstance(source, str):
            raise SystemExit(f"{label}[{index}] contains an unsupported source value")
        output.append((normalize_path(destination), normalize_path(source) if source else None, category))
    return output


def find_exact_toc(workpath: Path, kind: str) -> Path:
    matches = sorted(workpath.rglob(f"{kind}-*.toc"))
    if len(matches) != 1:
        raise SystemExit(f"expected exactly one {kind}-*.toc in isolated workpath, got {len(matches)}")
    return matches[0]


def dpkg_provenance(path: Path) -> dict[str, object]:
    if not sys.platform.startswith("linux"):
        return {"status": "NOT_APPLICABLE"}
    candidates = [path]
    try:
        resolved = path.resolve(strict=True)
    except OSError:
        resolved = path
    if resolved != path:
        candidates.append(resolved)
    for candidate in candidates:
        query = subprocess.run(
            ["dpkg-query", "--search", str(candidate)],
            check=False,
            capture_output=True,
            text=True,
        )
        if query.returncode:
            continue
        package = query.stdout.splitlines()[0].split(": ", 1)[0].strip()
        details = subprocess.run(
            [
                "dpkg-query",
                "--show",
                "--showformat=${binary:Package}\t${Version}\t${Architecture}\t${db:Status-Status}\n",
                package,
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        if details.returncode:
            continue
        fields = details.stdout.strip().split("\t")
        if len(fields) != 4:
            continue
        name, version, architecture, status = fields
        return {
            "status": "RESOLVED",
            "package": name,
            "version": version,
            "architecture": architecture,
            "installation_status": status,
            "query_path": str(candidate),
        }
    return {"status": "UNRESOLVED"}


def source_owner(
    source_path: Path,
    source_sha256: str,
    wheel_by_sha: dict[str, list[dict[str, object]]],
    cpython_distribution: dict[str, object],
) -> dict[str, object]:
    candidates = wheel_by_sha.get(source_sha256, [])
    path_candidates = [
        item
        for item in candidates
        if normalize_path(str(source_path)).endswith("/" + str(item["relative_path"]))
        or normalize_path(str(source_path)) == str(item["relative_path"])
    ]
    if len(path_candidates) == 1:
        item = path_candidates[0]
        return {
            "resolution": "RESOLVED",
            "owner_kind": "WHEEL_OWNED_NATIVE",
            "owner_reference": item["purl"],
            "source_artifact_sha256": item["wheel_sha256"],
            "source_native_relative_path": item["relative_path"],
            "hash_owner_candidate_count": len(candidates),
            "resolution_basis": "PAYLOAD_SHA256_AND_SELECTED_SOURCE_PATH",
        }
    if len(path_candidates) > 1 or len(candidates) > 1:
        return {
            "resolution": "AMBIGUOUS",
            "owner_kind": "UNKNOWN",
            "hash_owner_candidate_count": len(candidates),
            "candidates": candidates,
        }
    base = Path(sys.base_prefix).resolve()
    try:
        installed_relative = source_path.resolve().relative_to(base).as_posix()
    except ValueError:
        installed_relative = None
    if installed_relative is not None:
        return {
            "resolution": "RESOLVED",
            "owner_kind": "CPYTHON_TOOLCHAIN_NATIVE",
            "owner_reference": cpython_distribution["filename"],
            "source_artifact_sha256": cpython_distribution["sha256"],
            "source_native_relative_path": installed_relative,
            "hash_owner_candidate_count": len(candidates),
            "resolution_basis": "SELECTED_SOURCE_PATH_UNDER_LOCKED_CPYTHON_PREFIX",
        }
    return {
        "resolution": "SOURCE_PROVENANCE_CAPTURED_APPROVAL_PENDING",
        "owner_kind": "SYSTEM_BUILD_RUNTIME_NATIVE",
        "owner_reference": dpkg_provenance(source_path),
        "source_artifact_sha256": "NOT_AVAILABLE_FOR_SYSTEM_PACKAGE",
        "source_native_relative_path": str(source_path),
        "hash_owner_candidate_count": len(candidates),
        "resolution_basis": "PYINSTALLER_SELECTED_SOURCE_PATH_AND_SYSTEM_PACKAGE_DATABASE",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["linux", "windows"], required=True)
    parser.add_argument("--workpath", type=Path, required=True)
    parser.add_argument("--distpath", type=Path, required=True)
    parser.add_argument("--build-log", type=Path, required=True)
    parser.add_argument("--spec", type=Path, required=True)
    parser.add_argument("--build-context", type=Path, required=True)
    parser.add_argument("--runtime-inventory", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    arguments = parser.parse_args()

    if PyInstaller.__version__ != EXPECTED_PYINSTALLER_VERSION:
        raise SystemExit(
            f"build evidence parser requires PyInstaller {EXPECTED_PYINSTALLER_VERSION}, got {PyInstaller.__version__}"
        )
    build_context = json.loads(arguments.build_context.read_text(encoding="utf-8"))
    if not build_context.get("created_before_build") or build_context.get("clean_isolated_buildpath") != "PASS":
        raise SystemExit("build context does not prove a clean isolated pre-build workpath")
    if not arguments.build_log.is_file() or not arguments.workpath.is_dir() or not arguments.distpath.is_dir():
        raise SystemExit("PyInstaller build output, log or isolated workpath is missing")

    toc_paths = {kind: find_exact_toc(arguments.workpath, kind) for kind in TOC_LAYOUT}
    toc_values = {kind: load_toc(path, kind) for kind, path in toc_paths.items()}
    analysis = toc_values["Analysis"]
    pkg = toc_values["PKG"]
    exe = toc_values["EXE"]
    analysis_binaries = toc_entries(analysis[int(TOC_LAYOUT["Analysis"]["binaries"])], "Analysis.binaries")
    analysis_datas = toc_entries(analysis[int(TOC_LAYOUT["Analysis"]["datas"])], "Analysis.datas")
    pkg_entries = toc_entries(pkg[int(TOC_LAYOUT["PKG"]["toc"])], "PKG.toc")
    exe_entries = toc_entries(exe[int(TOC_LAYOUT["EXE"]["toc"])], "EXE.toc")
    if exe[int(TOC_LAYOUT["EXE"]["strip"])] is not False or exe[int(TOC_LAYOUT["EXE"]["upx"])] is not False:
        raise SystemExit("diagnostic requires the frozen strip=False/upx=False build configuration")

    runtime = json.loads(arguments.runtime_inventory.read_text(encoding="utf-8"))
    wheel_by_sha: dict[str, list[dict[str, object]]] = defaultdict(list)
    for package in runtime["packages"]:
        for native in package.get("native_artifacts", []):
            wheel_by_sha[str(native["sha256"])].append(
                {
                    "purl": package["purl"],
                    "wheel_sha256": package["sha256"],
                    "relative_path": native["relative_path"],
                    "filename": native["filename"],
                }
            )
    cpython_distribution = build_context["inputs"]["cpython_distribution"]
    analysis_keys = {(destination, source, category) for destination, source, category in analysis_binaries}
    selected = []
    materialized = []
    seen_destinations = set()
    for destination, source, category in pkg_entries:
        if category not in {"BINARY", "EXTENSION"}:
            continue
        if source is None:
            raise SystemExit(f"selected native has no source path: {destination}")
        if destination in seen_destinations:
            raise SystemExit(f"selected native has duplicate destination: {destination}")
        seen_destinations.add(destination)
        source_path = Path(source)
        if not source_path.is_file():
            raise SystemExit(f"selected native source is not materialized: {destination}: {source}")
        source_sha256 = sha256_file(source_path)
        owner = source_owner(source_path, source_sha256, wheel_by_sha, cpython_distribution)
        selected_item = {
            "internal_path": destination,
            "filename": PurePosixPath(destination).name,
            "source_path": str(source_path),
            "source_sha256": source_sha256,
            "source_size": source_path.stat().st_size,
            "pyinstaller_category": category,
            "pyinstaller_stage": "PKG_TOC",
            "present_in_analysis_binaries": (destination, source, category) in analysis_keys,
            "source_owner": owner,
        }
        selected.append(selected_item)
        materialized.append(
            {
                **selected_item,
                "materialized_path": str(source_path.resolve()),
                "materialized_sha256": source_sha256,
                "materialized_size": source_path.stat().st_size,
                "transformation": "NONE_STRIP_FALSE_UPX_FALSE_NON_DARWIN",
            }
        )

    selected.sort(key=lambda item: str(item["internal_path"]))
    materialized.sort(key=lambda item: str(item["internal_path"]))
    symlink_plan = [
        {"internal_path": destination, "target_path": source, "pyinstaller_category": category}
        for destination, source, category in pkg_entries
        if category == "SYMLINK"
    ]
    symlink_plan.sort(key=lambda item: str(item["internal_path"]))

    raw_root = arguments.output_root / "raw"
    parsed_root = arguments.output_root / "parsed"
    raw_root.mkdir(parents=True, exist_ok=True)
    parsed_root.mkdir(parents=True, exist_ok=True)
    raw_evidence = {}
    for kind, source in {**toc_paths, "SPEC": arguments.spec, "BUILD_LOG": arguments.build_log}.items():
        destination = raw_root / source.name
        if source.resolve() != destination.resolve():
            shutil.copyfile(source, destination)
        if sha256_file(destination) != sha256_file(source):
            raise SystemExit(f"raw evidence copy hash drift: {source}")
        raw_evidence[kind] = {
            "source_path": str(source.resolve()),
            "preserved_path": destination.relative_to(arguments.output_root).as_posix(),
            "sha256": sha256_file(destination),
            "size": destination.stat().st_size,
        }

    selected_document = {
        "schema_version": "1",
        "build_context_id": build_context["build_context_id"],
        "capture_status": "COMPLETE",
        "pyinstaller_version": PyInstaller.__version__,
        "entries": selected,
    }
    staged_document = {
        "schema_version": "1",
        "build_context_id": build_context["build_context_id"],
        "capture_status": "COMPLETE",
        "staging_semantics": "PKG_TOC_RESOLVED_MATERIALIZED_SOURCES_NO_BINARY_TRANSFORMATION",
        "entries": materialized,
    }
    selected_path = parsed_root / "pyinstaller-selected-native-set.json"
    staged_path = parsed_root / "pyinstaller-materialized-native-set.json"
    selected_path.write_text(canonical_json(selected_document), encoding="utf-8")
    staged_path.write_text(canonical_json(staged_document), encoding="utf-8")

    ambiguous = sum(
        1 for item in selected if item["source_owner"]["resolution"] == "AMBIGUOUS"
    )
    manifest = {
        "schema_version": "1",
        "evidence_parser_version": EVIDENCE_PARSER_VERSION,
        "captured_at": dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "build_context_id": build_context["build_context_id"],
        "target": arguments.target,
        "pyinstaller_version": PyInstaller.__version__,
        "python_version": platform.python_version(),
        "clean_isolated_buildpath": build_context["clean_isolated_buildpath"],
        "evidence_capture_alters_build_inputs": build_context["evidence_capture_alters_build_inputs"],
        "analysis_capture": "PASS",
        "toc_capture": "PASS",
        "selected_set_capture": "COMPLETE",
        "staging_capture": "PASS",
        "staging_semantics": staged_document["staging_semantics"],
        "raw_evidence": raw_evidence,
        "workpath": str(arguments.workpath.resolve()),
        "distpath": str(arguments.distpath.resolve()),
        "analysis": {
            "hiddenimports": analysis[int(TOC_LAYOUT["Analysis"]["hiddenimports"])],
            "scripts": toc_entries(analysis[int(TOC_LAYOUT["Analysis"]["scripts"])], "Analysis.scripts"),
            "binaries": analysis_binaries,
            "datas": analysis_datas,
            "pure_module_count": len(analysis[int(TOC_LAYOUT["Analysis"]["pure"])]),
        },
        "pkg": {
            "entry_count": len(pkg_entries),
            "native_selected_count": len(selected),
            "symlink_metadata_count": len(symlink_plan),
            "symlink_metadata": symlink_plan,
        },
        "exe": {"entry_count": len(exe_entries), "strip": False, "upx": False},
        "selected_native_set": {
            "path": selected_path.relative_to(arguments.output_root).as_posix(),
            "sha256": sha256_file(selected_path),
            "count": len(selected),
        },
        "materialized_native_set": {
            "path": staged_path.relative_to(arguments.output_root).as_posix(),
            "sha256": sha256_file(staged_path),
            "count": len(materialized),
        },
        "ambiguous_hash_owner_count": ambiguous,
        "ambiguous_hash_owner_resolution": "PASS" if ambiguous == 0 else "FAIL",
    }
    manifest_path = arguments.output_root / "pyinstaller-build-evidence.json"
    manifest_path.write_text(canonical_json(manifest), encoding="utf-8")
    print(
        f"pyinstaller-build-evidence: PASS ({build_context['build_context_id']}; "
        f"{len(selected)} selected/materialized; {len(symlink_plan)} symlinks)"
    )


if __name__ == "__main__":
    main()
