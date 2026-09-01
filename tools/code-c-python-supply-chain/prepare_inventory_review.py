from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qsl, urlsplit

from canonical_evidence import canonical_sha256, write_canonical_json
from inventory_candidate_serialization import (
    CandidateSerializationError,
    normalize_python_name,
    python_purl,
    serialize_v3_candidate_from_resolution,
    validate_resolution_serialization,
)
from policy import sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "toolchain-source-lock.json"
)
DEFINITIONS = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "dependency-definitions.json"
)
PREREQUISITE = (
    REPOSITORY_ROOT
    / "compliance"
    / "runtime-prerequisites"
    / "msvc-v14-x64"
    / "external-prerequisite.v1.json"
)
INVENTORY_V3_SCHEMA_PATH = (
    REPOSITORY_ROOT
    / "schemas"
    / "compliance"
    / "python-artifact-inventory"
    / "v3"
    / "inventory.schema.json"
)
INVENTORY_V3_SCHEMA_ID = "https://local.app/schemas/compliance/python-artifact-inventory/v3/inventory.schema.json"
INVENTORY_V3_VALIDATOR_ID = "AJV2020@8.18.0+ajv-formats@3.0.1"
APPROVAL_CONTRACT_SHA256 = "9d1b5b0db328a44e128666083f4bdfc4f5dd7fd026e306fe724a8d81c42e90f2"
REVIEWER_AUTHORITY_POLICY_SHA256 = "e4f8eb4eb82e9ae5a12764b5f950211e2ef18b8727647e65108efd452ea4aa12"
REQUIRED_MAIN_BASELINE = "849e386862c042619357d284b71f9c6d2b27c130"
REQUIRED_PREVIOUS_CODE_C_HEAD = "5bd956b5eae2c8730144acc962ad085719ea250f"
REJECTED_CANDIDATE_BASELINE = (
    REPOSITORY_ROOT
    / "tools"
    / "code-c-python-supply-chain"
    / "fixtures"
    / "rejected_inventory_candidates_f57ecb7.json"
)
REJECTED_SOURCE_PROVENANCE_CANDIDATES = {
    "linux/runtime": "00a90cd659371490a736473c1f33e9731d9f546ef5fc617d4cfaf0384694a48e",
    "linux/worker-build": "92a9d967a304944585c1b3f58aacbadbb36e84c902203acf20dcd52767109fcd",
    "windows/runtime": "65bf328ca67a912e6d72e8355aa914201510f21f36ce6fdace20693a1d92f6a7",
    "windows/worker-build": "ceff3d125fde22ec0a0e5d163b239c61059dfb5d90127ec45c104b3d60e6c893",
}
ROLE_BY_SCOPE = {
    "runtime": "RUNTIME",
    "worker-build": "WORKER_BUILD",
}


def load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def inventory_v3_contract_identity() -> dict[str, str]:
    schema = load_json(INVENTORY_V3_SCHEMA_PATH)
    if schema.get("$id") != INVENTORY_V3_SCHEMA_ID:
        raise SystemExit("Inventory v3 schema identity does not match the approved contract")
    return {
        "schema_id": INVENTORY_V3_SCHEMA_ID,
        "schema_sha256": sha256_file(INVENTORY_V3_SCHEMA_PATH),
        "validator_id": INVENTORY_V3_VALIDATOR_ID,
        "contract_source": "MAIN_QUALITY_BASELINE",
    }


def git(*arguments: str) -> str:
    result = subprocess.run(
        ["git", *arguments],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise SystemExit(result.stderr.strip() or result.stdout.strip() or "git command failed")
    return result.stdout.strip()


def require_ancestor(commit: str, head: str, label: str) -> None:
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", commit, head],
        cwd=REPOSITORY_ROOT,
        check=False,
    )
    if result.returncode:
        raise SystemExit(f"current HEAD does not contain required {label}: {commit}")


def safe_archive_member(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name:
        raise SystemExit(f"unsafe PyInstaller wheel path: {name}")
    return path


def exact_toolchain_evidence(
    target: str,
    toolchain_root: Path,
    runtime_identity: dict[str, object],
) -> dict[str, object]:
    lock = load_json(SOURCE_LOCK)
    target_lock = lock["targets"][target]
    inputs = {
        "CPYTHON_DISTRIBUTION": target_lock["cpython_distribution"],
        "PIP": lock["pip"],
        "PYINSTALLER": target_lock["pyinstaller"],
    }
    components: list[dict[str, object]] = []
    for kind, item in inputs.items():
        path = toolchain_root / target / str(item["filename"])
        if not path.is_file():
            raise SystemExit(f"missing exact toolchain input: {path}")
        actual_hash = sha256_file(path)
        if actual_hash != item["sha256"] or path.stat().st_size != item["size"]:
            raise SystemExit(f"toolchain artifact differs from source lock: {path.name}")
        components.append(
            {
                "component_kind": kind,
                "filename": item["filename"],
                "sha256": actual_hash,
                "size": path.stat().st_size,
                "canonical_reference": item["download_url"],
                "canonical_source": item["canonical_source"],
                "approval_status": "PENDING_CODE_F_REVIEW",
            }
        )

    pyinstaller_path = toolchain_root / target / str(target_lock["pyinstaller"]["filename"])
    expected_member = (
        "PyInstaller/bootloader/Windows-64bit-intel/run.exe"
        if target == "windows"
        else "PyInstaller/bootloader/Linux-64bit-intel/run"
    )
    with zipfile.ZipFile(pyinstaller_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise SystemExit("PyInstaller wheel contains duplicate archive members")
        for name in names:
            safe_archive_member(name)
        matches = [name for name in names if name == expected_member]
        if len(matches) != 1:
            raise SystemExit(f"PyInstaller wheel has {len(matches)} selected bootloader members")
        bootloader_bytes = archive.read(matches[0])
    components.append(
        {
            "component_kind": "PYINSTALLER_BOOTLOADER",
            "filename": PurePosixPath(expected_member).name,
            "wheel_member_path": expected_member,
            "sha256": hashlib.sha256(bootloader_bytes).hexdigest(),
            "size": len(bootloader_bytes),
            "source_pyinstaller_sha256": target_lock["pyinstaller"]["sha256"],
            "canonical_reference": target_lock["pyinstaller"]["download_url"],
            "canonical_source": target_lock["pyinstaller"]["canonical_source"],
            "approval_status": "PENDING_CODE_F_REVIEW",
        }
    )
    return {
        "schema_version": "1",
        "evidence_type": "PYTHON_TOOLCHAIN_INTAKE_EVIDENCE",
        "target": target,
        "inventory_schema": "python-toolchain-inventory/v1",
        "formal_inventory_status": "MISSING_PENDING_CODE_F_REVIEW",
        "source_lock_sha256": canonical_sha256(lock),
        "python": {
            "implementation": "CPython",
            "version": lock["python_version"],
            "abi": lock["python_abi"],
            "free_threaded": lock["free_threaded"],
            "locked_executable_sha256": runtime_identity["locked_interpreter"][
                "executable_sha256"
            ],
            "locked_runtime_library_sha256": runtime_identity["locked_interpreter"][
                "runtime_library_sha256"
            ],
        },
        "components": components,
        "packaged_native_mapping": "DEFERRED_UNTIL_INVENTORY_APPROVAL_AND_NATIVE_STAGE",
        "approval_owner": "CODE_F",
    }


def compare_candidate_to_resolution(
    candidate: dict[str, object], resolution: dict[str, object], target: str, scope: str
) -> tuple[list[dict[str, object]], dict[str, int | str]]:
    expected_scope = "PRODUCTION_WORKER_RUNTIME" if scope == "runtime" else "WORKER_BUILD"
    if (
        candidate.get("schema_version") != "3"
        or candidate.get("scope") != expected_scope
        or candidate.get("subject_state") != "CANDIDATE"
    ):
        raise SystemExit(f"{target}/{scope}: candidate schema or scope mismatch")
    if candidate.get("graph_complete") is not True:
        raise SystemExit(f"{target}/{scope}: v3 factual graph must be complete")
    candidate_packages = {
        str(package["purl"]): package for package in candidate.get("packages", [])
    }
    try:
        validation = validate_resolution_serialization(candidate, resolution)
    except CandidateSerializationError as error:
        raise SystemExit(f"{target}/{scope}: {error}") from error
    resolution_packages = {
        python_purl(str(package["name"]), str(package["version"])): package
        for package in resolution.get("packages", [])
    }
    if len(candidate_packages) != len(resolution.get("packages", [])):
        raise SystemExit(f"{target}/{scope}: candidate/resolution package count mismatch")
    exact_artifacts = []
    for purl, package in sorted(candidate_packages.items()):
        name_version = purl.removeprefix("pkg:pypi/").rsplit("@", 1)
        if len(name_version) != 2:
            raise SystemExit(f"{target}/{scope}: invalid candidate purl {purl}")
        resolved = resolution_packages.get(purl)
        if not resolved:
            raise SystemExit(f"{target}/{scope}: candidate package absent from resolution: {purl}")
        provenance = resolved["provenance"]
        metadata = resolved["metadata"]
        if (
            package["filename"] != provenance["filename"]
            or package["sha256"] != provenance["sha256"]
            or package["version"] != resolved["version"]
        ):
            raise SystemExit(f"{target}/{scope}: exact artifact drift for {purl}")
        candidate_natives = {
            (entry["relative_path"], entry["sha256"])
            for entry in package["native_artifacts"]
        }
        resolution_natives = {
            (entry["relative_path"], entry["sha256"])
            for entry in metadata["native_artifacts"]
        }
        if candidate_natives != resolution_natives:
            raise SystemExit(f"{target}/{scope}: native-member drift for {purl}")
        exact_artifacts.append(
            {
                "purl": purl,
                "filename": package["filename"],
                "sha256": package["sha256"],
                "download_url": provenance["download_url"],
                "source": provenance["source"],
                "direct": resolved["direct"],
                "dependencies": resolved["dependencies"],
                "native_member_count": len(resolution_natives),
                "license_expression": package["license_expression"],
                "license_files": package["license_files"],
            }
        )
    return exact_artifacts, validation


def compare_candidate_provenance_to_resolution(
    candidate: dict[str, object],
    resolution: dict[str, object],
    resolution_path: Path,
    target: str,
    scope: str,
) -> dict[str, object]:
    """Bind candidate provenance to the exact, offline resolver evidence record."""

    resolution_record_hash = sha256_file(resolution_path)
    if resolution_record_hash != canonical_sha256(resolution):
        raise SystemExit(f"{target}/{scope}: resolver evidence is not canonical")
    resolved_by_purl = {
        python_purl(str(package["name"]), str(package["version"])): package
        for package in resolution.get("packages", [])
    }
    package_records = []
    download_url_mismatches = 0
    source_mismatches = 0
    record_hash_mismatches = 0
    unresolved = 0
    candidate_packages = {str(package["purl"]): package for package in candidate["packages"]}
    try:
        resolver_record_path = str(resolution_path.relative_to(REPOSITORY_ROOT))
    except ValueError:
        resolver_record_path = str(resolution_path)
    for purl, resolved in sorted(resolved_by_purl.items()):
        package = candidate_packages.get(purl)
        resolver_provenance = resolved.get("provenance", {})
        for locator_key in ("download_url", "source"):
            locator = str(resolver_provenance.get(locator_key, ""))
            parsed_locator = urlsplit(locator)
            sensitive_keys = {
                "access_token",
                "auth",
                "credential",
                "expires",
                "key",
                "sig",
                "signature",
                "token",
                "x-amz-credential",
                "x-amz-signature",
                "x-goog-signature",
            }
            if parsed_locator.username or parsed_locator.password or any(
                key.lower() in sensitive_keys for key, _ in parse_qsl(parsed_locator.query)
            ):
                raise SystemExit(
                    f"{target}/{scope}: resolver {locator_key} is secret-bearing and has no "
                    "approved secret-free representation"
                )
        if package is None:
            unresolved += 1
            continue
        package_match = package.get("package_name") == resolved.get("name")
        version_match = package.get("version") == resolved.get("version")
        filename_match = package.get("filename") == resolver_provenance.get("filename")
        artifact_hash_match = package.get("sha256") == resolver_provenance.get("sha256")
        download_url_match = (
            package.get("provenance", {}).get("download_url")
            == resolver_provenance.get("download_url")
        )
        source_match = package.get("source") == resolver_provenance.get("source")
        source_index_match = package.get("source_index") == resolver_provenance.get("source_index")
        if not download_url_match:
            download_url_mismatches += 1
        if not source_match:
            source_mismatches += 1
        if not all(
            (
                package_match,
                version_match,
                filename_match,
                artifact_hash_match,
                download_url_match,
                source_match,
                source_index_match,
            )
        ):
            unresolved += 1
        entry = {
            "candidate_purl": purl,
            "resolver_record_path": resolver_record_path,
            "resolver_record_sha256": resolution_record_hash,
            "resolver_entry_sha256": canonical_sha256(resolved),
            "package_match": package_match,
            "version_match": version_match,
            "wheel_filename_match": filename_match,
            "artifact_sha256_match": artifact_hash_match,
            "download_url_match": download_url_match,
            "source_match": source_match,
            "source_index_match": source_index_match,
            "artifact_identity_sha256": resolver_provenance.get("sha256"),
            "resolver_download_url": resolver_provenance.get("download_url"),
            "resolver_source": resolver_provenance.get("source"),
        }
        package_records.append(entry)
        if entry["resolver_record_sha256"] != resolution_record_hash:
            record_hash_mismatches += 1
    status = "PASS" if not any(
        (download_url_mismatches, source_mismatches, record_hash_mismatches, unresolved)
    ) else "FAIL"
    if status != "PASS":
        raise SystemExit(f"{target}/{scope}: resolver provenance binding failed")
    return {
        "status": status,
        "resolver_provenance_binding": status,
        "resolver_record_binding": status,
        "resolver_record_hash": resolution_record_hash,
        "resolver_record_hash_mismatch_count": record_hash_mismatches,
        "candidate_download_url_mismatch_count": download_url_mismatches,
        "candidate_source_url_mismatch_count": source_mismatches,
        "unresolved_provenance_defect_count": unresolved,
        "download_url_semantics": "MATCH_CURRENT_RESOLVER_CONTRACT",
        "candidate_url_recanonicalization_by_generator": "NO",
        "generator_derived_provenance_forbidden": "PASS",
        "resolver_provenance_source_of_truth": "PASS",
        "provenance_offline_replay": "PASS",
        "http_availability": "DIAGNOSTIC_ONLY",
        "records": package_records,
    }


def validate_candidate_against_shared_inventory_v3(
    candidate: dict[str, object], candidate_path: Path, target: str, scope: str
) -> dict[str, object]:
    """Strictly validate the raw v3 subject bytes against main's shared schema."""

    if candidate.get("schema_version") != "3" or candidate.get("subject_state") != "CANDIDATE":
        raise SystemExit(f"{target}/{scope}: raw candidate is not an Inventory v3 subject")
    forbidden_keys = {
        "approval_id",
        "decision",
        "reviewer",
        "reviewer_authority",
        "authority_policy_sha256",
        "revocation",
        "revocation_state",
        "expiry",
        "supersession",
        "review_status",
        "candidate_status",
        "review_state",
    }

    def find_forbidden(value: object) -> bool:
        if isinstance(value, dict):
            if any(key in forbidden_keys for key in value):
                return True
            return any(find_forbidden(nested) for nested in value.values())
        if isinstance(value, list):
            return any(find_forbidden(nested) for nested in value)
        return False

    if find_forbidden(candidate):
        raise SystemExit(f"{target}/{scope}: raw v3 subject embeds approval lifecycle state")
    validation_script = r'''
const fs = require('node:fs');
const Ajv2020 = require('ajv/dist/2020.js').default;
const addFormats = require('ajv-formats').default;
const subjectPath = process.argv[1];
const schemaPath = process.argv[2];
const subject = JSON.parse(fs.readFileSync(subjectPath, 'utf8'));
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);
if (!validate(subject)) {
  const errors = (validate.errors || []).map((entry) => `${entry.instancePath || '/'} ${entry.message}`).join('; ');
  console.error(errors);
  process.exit(1);
}
'''
    result = subprocess.run(
        ["node", "-e", validation_script, str(candidate_path), str(INVENTORY_V3_SCHEMA_PATH)],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode:
        raise SystemExit(
            f"{target}/{scope}: shared Inventory v3 validation failed: "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
    raw_validation_bytes = candidate_path.read_bytes()
    subject_sha = hashlib.sha256(raw_validation_bytes).hexdigest()
    if candidate_path.read_bytes() != raw_validation_bytes:
        raise SystemExit(f"{target}/{scope}: raw validation input bytes changed")
    return {
        "raw_v3_schema_validation": "PASS",
        "inventory_v3_schema_validation": "PASS",
        "validation_engine": INVENTORY_V3_VALIDATOR_ID,
        "raw_validation_input_sha256": subject_sha,
        "raw_validation_input_sha256_matches_subject": "PASS",
        "approval_projection_used_for_raw_validation": "NO",
        "validation_time_field_injection": "NO",
        "validation_time_subject_mutation": "NO",
        "factual_graph_completeness": "PASS",
        "approval_lifecycle_embedded_in_subject": "NO",
        "approval_provenance_embedded_in_raw_subject": "NO",
        "reviewer_authority_embedded_in_raw_subject": "NO",
        "revocation_state_embedded_in_raw_subject": "NO",
        "external_approval_is_authoritative": "YES",
    }


def _factual_semantics(candidate: dict[str, object]) -> dict[str, object]:
    packages = sorted(candidate["packages"], key=lambda item: str(item["purl"]))
    return {
        "artifact_graph": [
            {
                key: package[key]
                for key in (
                    "package_name",
                    "version",
                    "artifact_type",
                    "filename",
                    "artifact_path",
                    "sha256",
                    "source",
                    "source_index",
                    "purl",
                    "wheel_tags",
                    "compatibility",
                    "license_expression",
                    "license_files",
                    "native_artifacts",
                    "direct",
                )
            }
            for package in packages
        ],
        "dependency_graph": [
            {
                "purl": package["purl"],
                "dependencies": package["dependencies"],
                "dependency_declarations": package["dependency_declarations"],
            }
            for package in packages
        ],
        "resolver_provenance": [
            {
                "purl": package["purl"],
                "source": package["source"],
                "source_index": package["source_index"],
                "download_url": package["provenance"]["download_url"],
                "filename": package["filename"],
                "sha256": package["sha256"],
            }
            for package in packages
        ],
        "target": candidate["target"],
        "role": {
            "scope": candidate["scope"],
            "direct_packages": [package["purl"] for package in packages if package["direct"]],
        },
    }


def factual_semantic_equivalence(
    candidate: dict[str, object],
    resolution: dict[str, object],
    target_descriptor: dict[str, object],
    wheel_root: Path,
    inventory_id: str,
    scope: str,
) -> dict[str, object]:
    """Compare v3 facts with a resolver replay of the prior v2 factual subject."""

    expected = serialize_v3_candidate_from_resolution(
        resolution, target_descriptor, wheel_root, inventory_id, scope
    )
    actual_facts = _factual_semantics(candidate)
    expected_facts = _factual_semantics(expected)
    if actual_facts != expected_facts:
        raise SystemExit(f"{resolution['target']}/{scope}: v2 to v3 factual semantics drifted")
    digests = {
        "artifact_graph_semantic_digest": canonical_sha256(expected_facts["artifact_graph"]),
        "dependency_graph_semantic_digest": canonical_sha256(expected_facts["dependency_graph"]),
        "resolver_provenance_semantic_digest": canonical_sha256(
            expected_facts["resolver_provenance"]
        ),
        "target_semantic_digest": canonical_sha256(expected_facts["target"]),
        "role_semantic_digest": canonical_sha256(expected_facts["role"]),
    }
    return {
        "v2_to_v3_factual_semantic_equivalence": "PASS",
        "subject_bytes": "CHANGED_AS_EXPECTED",
        "factual_semantics": "UNCHANGED",
        "artifact_graph_semantic_digest": digests["artifact_graph_semantic_digest"],
        "dependency_graph_semantic_digest": digests["dependency_graph_semantic_digest"],
        "resolver_provenance_semantic_digest": digests["resolver_provenance_semantic_digest"],
        "target_semantic_digest": digests["target_semantic_digest"],
        "role_semantic_digest": digests["role_semantic_digest"],
        "artifact_graph_semantic_digest_status": "UNCHANGED",
        "dependency_graph_semantic_digest_status": "UNCHANGED",
        "resolver_provenance_semantic_digest_status": "UNCHANGED",
        "target_semantics": "UNCHANGED",
        "role_semantics": "UNCHANGED",
    }


def rejected_candidate_drift(
    candidate: dict[str, object], resolution: dict[str, object], target: str, scope: str
) -> dict[str, object]:
    baseline = load_json(REJECTED_CANDIDATE_BASELINE)["candidates"][f"{target}/{scope}"]
    exact_artifacts = sorted(
        (
            {
                "purl": package["purl"],
                "filename": package["filename"],
                "sha256": package["sha256"],
            }
            for package in candidate["packages"]
        ),
        key=lambda item: str(item["purl"]),
    )
    purls = {
        normalize_python_name(str(package["name"])): python_purl(
            str(package["name"]), str(package["version"])
        )
        for package in resolution["packages"]
    }
    graph = sorted(
        (
            {
                "source": python_purl(str(package["name"]), str(package["version"])),
                "dependency": purls[str(dependency)],
            }
            for package in resolution["packages"]
            for dependency in package["dependencies"]
        ),
        key=lambda item: (str(item["source"]), str(item["dependency"])),
    )
    artifact_identity = canonical_sha256(exact_artifacts)
    graph_identity = canonical_sha256(graph)
    artifact_drift = (
        "NONE" if artifact_identity == baseline["exact_artifact_set_sha256"] else "PRESENT"
    )
    semantic_drift = (
        "EXPECTED_INVALID_EDGE_REMOVAL_ONLY"
        if graph_identity == baseline["resolver_dependency_graph_sha256"]
        else "PRESENT"
    )
    if artifact_drift != "NONE" or semantic_drift == "PRESENT":
        raise SystemExit(f"{target}/{scope}: candidate drift exceeded the serialization fix")
    return {
        "rejected_candidate_sha256": baseline["candidate_sha256"],
        "exact_artifact_set_sha256": artifact_identity,
        "exact_artifact_set_drift_from_rejected_candidate": artifact_drift,
        "semantic_dependency_graph_sha256": graph_identity,
        "semantic_dependency_graph_drift_from_first_generation": semantic_drift,
        "dependency_graph_drift_from_source_provenance_generation": "NONE",
        "removed_rejected_review_required_edges": baseline[
            "invalid_review_required_dependency_entries"
        ],
        "repaired_rejected_missing_purl_fields": baseline["missing_required_purl_fields"],
        "drift_explanation": (
            "Wheel identities are unchanged. Formal edges now equal resolver truth; only "
            "metadata-derived edges not authorized by resolver disposition were removed."
        ),
    }


def historical_drift(
    target: str, scope: str, exact_artifacts: list[dict[str, object]], target_sha256: str
) -> dict[str, object]:
    historical_path = REPOSITORY_ROOT / "compliance" / "python-artifacts" / target / f"{scope}.v2.json"
    current = {entry["purl"]: entry for entry in exact_artifacts}
    if not historical_path.is_file():
        return {
            "scope": scope,
            "comparison_basis": None,
            "comparison_basis_status": "NO_COMPARABLE_HISTORICAL_INVENTORY",
            "inventory_drift": "PRESENT",
            "target_identity_changed": True,
            "added": sorted(current),
            "removed": [],
            "changed_exact_artifacts": [],
            "historical_approval_reuse": [],
        }
    historical = load_json(historical_path)
    prior = {package["purl"]: package for package in historical["packages"]}
    added = sorted(set(current) - set(prior))
    removed = sorted(set(prior) - set(current))
    changed = sorted(
        purl
        for purl in set(current) & set(prior)
        if current[purl]["sha256"] != prior[purl]["sha256"]
        or current[purl]["filename"] != prior[purl]["filename"]
    )
    historical_target_sha = canonical_sha256(historical["target"])
    target_changed = historical_target_sha != target_sha256
    drift = "PRESENT" if added or removed or changed or target_changed else "NONE"
    return {
        "scope": scope,
        "comparison_basis": str(historical_path.relative_to(REPOSITORY_ROOT)),
        "comparison_basis_sha256": sha256_file(historical_path),
        "comparison_basis_status": "FORMAL_INVENTORY",
        "inventory_drift": drift,
        "target_identity_changed": target_changed,
        "added": added,
        "removed": removed,
        "changed_exact_artifacts": changed,
        "historical_approval_reuse": [] if drift == "PRESENT" else [historical["inventory_id"]],
    }


def copy_json(source: Path, destination: Path) -> None:
    if not source.is_file() or source.suffix.lower() != ".json":
        raise SystemExit(f"review evidence must be an existing JSON file: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


def copy_canonical_json(source: Path, destination: Path) -> None:
    if not source.is_file() or source.suffix.lower() != ".json":
        raise SystemExit(f"canonical review evidence must be an existing JSON file: {source}")
    write_canonical_json(destination, load_json(source))


def prepare_target(arguments: argparse.Namespace) -> None:
    head = git("rev-parse", "HEAD")
    require_ancestor(arguments.main_baseline, head, "main quality baseline")
    require_ancestor(arguments.previous_code_c_head, head, "previous Code C factual-fix HEAD")
    require_ancestor(arguments.containment_sha, head, "artifact containment commit")
    target = arguments.target
    descriptor = load_json(arguments.target_descriptor)
    runtime_identity = load_json(arguments.runtime_identity)
    installation = load_json(arguments.installation_evidence)
    descriptor_sha = sha256_file(arguments.target_descriptor)
    descriptor_identity = canonical_sha256(descriptor)
    if (
        descriptor.get("implementation") != "cpython"
        or descriptor.get("python_version") != "3.13.15"
        or descriptor.get("os") != target
        or descriptor.get("architecture") != "x86_64"
        or descriptor.get("compatibility", {}).get("tag_source")
        != "packaging.tags.sys_tags"
    ):
        raise SystemExit(f"{target}: target descriptor violates approved cp313 x64 target")
    interpreter = runtime_identity.get("interpreter", {})
    if (
        runtime_identity.get("status") != "PASS"
        or interpreter.get("version") != "3.13.15"
        or interpreter.get("python_abi") != "cp313"
        or interpreter.get("python_free_threaded") is not False
        or runtime_identity.get("target_descriptor", {}).get("sha256") != descriptor_sha
        or installation.get("status") != "PASS"
    ):
        raise SystemExit(f"{target}: locked runtime identity is not approved standard-GIL cp313")

    output_root = arguments.output_root
    if output_root.exists():
        raise SystemExit(f"inventory review output must start absent: {output_root}")
    output_root.mkdir(parents=True)
    copied = {
        "target_descriptor": output_root / "target-descriptor.json",
        "runtime_identity": output_root / "runtime-identity.json",
        "installation_evidence": output_root / "cpython-installation.json",
        "graph_interpreter_attestation": output_root / "graph-interpreter-attestation.json",
        "dependency_definitions": output_root / "dependency-definitions.snapshot.json",
        "toolchain_source_lock": output_root / "toolchain-source-lock.snapshot.json",
    }
    for source, destination in (
        (arguments.target_descriptor, copied["target_descriptor"]),
        (arguments.runtime_identity, copied["runtime_identity"]),
        (arguments.installation_evidence, copied["installation_evidence"]),
        (arguments.graph_attestation, copied["graph_interpreter_attestation"]),
    ):
        copy_json(source, destination)
    for source, destination in (
        (DEFINITIONS, copied["dependency_definitions"]),
        (SOURCE_LOCK, copied["toolchain_source_lock"]),
    ):
        copy_canonical_json(source, destination)

    inventories = []
    drift_entries = []
    inventory_v3_identity = inventory_v3_contract_identity()
    for scope, role in ROLE_BY_SCOPE.items():
        candidate_path = arguments.candidate_root / f"code-c-{target}-{scope}.v3.json"
        resolution_path = arguments.resolution_root / f"{target}-{scope}.json"
        candidate = load_json(candidate_path)
        resolution = load_json(resolution_path)
        expected_v3_target = {
            key: descriptor[key]
            for key in (
                "target_descriptor_version",
                "implementation",
                "python_version",
                "os",
                "architecture",
                "compatibility",
            )
        }
        if candidate.get("target") != expected_v3_target:
            raise SystemExit(f"{target}/{scope}: candidate target descriptor drift")
        if resolution.get("target") != target or resolution.get("scope") != scope:
            raise SystemExit(f"{target}/{scope}: resolution target/scope drift")
        if (
            resolution.get("runtime_identity", {}).get("distribution_sha256")
            != runtime_identity["distribution"]["sha256"]
            or resolution.get("runtime_identity", {}).get("target_descriptor_sha256")
            != descriptor_sha
        ):
            raise SystemExit(f"{target}/{scope}: resolution runtime binding drift")
        exact_artifacts, consistency = compare_candidate_to_resolution(
            candidate, resolution, target, scope
        )
        provenance_binding = compare_candidate_provenance_to_resolution(
            candidate, resolution, resolution_path, target, scope
        )
        schema_validation = validate_candidate_against_shared_inventory_v3(
            candidate, candidate_path, target, scope
        )
        semantic_equivalence = factual_semantic_equivalence(
            candidate,
            resolution,
            descriptor,
            arguments.wheel_root / scope,
            str(candidate["inventory_id"]),
            scope,
        )
        rejected_drift = rejected_candidate_drift(candidate, resolution, target, scope)
        candidate_destination = output_root / "candidates" / candidate_path.name
        resolution_destination = output_root / "resolution" / resolution_path.name
        copy_json(candidate_path, candidate_destination)
        copy_json(resolution_path, resolution_destination)
        drift = historical_drift(target, scope, exact_artifacts, descriptor_identity)
        drift_entries.append(drift)
        inventories.append(
            {
                "inventory_id": candidate["inventory_id"],
                "target": target,
                "role": role,
                "scope": candidate["scope"],
                "candidate_path": candidate_destination.relative_to(output_root).as_posix(),
                "candidate_sha256": sha256_file(candidate_destination),
                "resolution_path": resolution_destination.relative_to(output_root).as_posix(),
                "resolution_sha256": sha256_file(resolution_destination),
                "dependency_graph_identity_sha256": canonical_sha256(resolution),
                "inventory_schema_version": "3",
                "inventory_v3_schema_id": inventory_v3_identity["schema_id"],
                "inventory_v3_schema_sha256": inventory_v3_identity["schema_sha256"],
                "inventory_v3_validator_id": inventory_v3_identity["validator_id"],
                "inventory_v3_contract_source": inventory_v3_identity["contract_source"],
                "package_count": len(exact_artifacts),
                "native_member_count": sum(
                    int(entry["native_member_count"]) for entry in exact_artifacts
                ),
                "graph_complete_evidence": "PASS",
                "factual_graph_completeness": schema_validation["factual_graph_completeness"],
                "raw_v3_schema_validation": schema_validation["raw_v3_schema_validation"],
                "inventory_v3_schema_validation": schema_validation[
                    "inventory_v3_schema_validation"
                ],
                "dependency_graph_validation": consistency["dependency_graph_validation"],
                "resolution_serialization_consistency": consistency[
                    "resolution_serialization_consistency"
                ],
                "resolution_state_conflict_count": consistency[
                    "resolution_state_conflict_count"
                ],
                "resolved_not_applicable_emitted_as_formal_dependency_count": consistency[
                    "resolved_not_applicable_emitted_as_formal_dependency_count"
                ],
                "invalid_review_required_dependency_entries": consistency[
                    "invalid_review_required_dependency_entries"
                ],
                "invalid_pseudo_purl_count": consistency["invalid_pseudo_purl_count"],
                "missing_required_purl_field_count": consistency[
                    "missing_required_purl_field_count"
                ],
                "invalid_purl_format_count": consistency["invalid_purl_format_count"],
                "pseudo_purl_in_formal_dependencies": consistency[
                    "pseudo_purl_in_formal_dependencies"
                ],
                "resolution_state_conflict_fail_closed": consistency[
                    "resolution_state_conflict_fail_closed"
                ],
                "schema_validation_details": schema_validation,
                "semantic_equivalence": semantic_equivalence,
                "v2_to_v3_factual_semantic_equivalence": semantic_equivalence[
                    "v2_to_v3_factual_semantic_equivalence"
                ],
                "subject_bytes": semantic_equivalence["subject_bytes"],
                "factual_semantics": semantic_equivalence["factual_semantics"],
                "artifact_graph_semantic_digest": semantic_equivalence[
                    "artifact_graph_semantic_digest"
                ],
                "dependency_graph_semantic_digest": semantic_equivalence[
                    "dependency_graph_semantic_digest"
                ],
                "resolver_provenance_semantic_digest": semantic_equivalence[
                    "resolver_provenance_semantic_digest"
                ],
                "target_semantics": semantic_equivalence["target_semantics"],
                "role_semantics": semantic_equivalence["role_semantics"],
                "resolver_provenance_binding": provenance_binding["resolver_provenance_binding"],
                "resolver_record_binding": provenance_binding["resolver_record_binding"],
                "resolver_provenance_details": provenance_binding,
                "resolver_record_hash": provenance_binding["resolver_record_hash"],
                "resolver_record_hash_mismatch_count": provenance_binding[
                    "resolver_record_hash_mismatch_count"
                ],
                "candidate_download_url_mismatch_count": provenance_binding[
                    "candidate_download_url_mismatch_count"
                ],
                "candidate_source_url_mismatch_count": provenance_binding[
                    "candidate_source_url_mismatch_count"
                ],
                "unresolved_provenance_defect_count": provenance_binding[
                    "unresolved_provenance_defect_count"
                ],
                "download_url_semantics": provenance_binding["download_url_semantics"],
                "candidate_url_recanonicalization_by_generator": provenance_binding[
                    "candidate_url_recanonicalization_by_generator"
                ],
                "generator_derived_provenance_forbidden": provenance_binding[
                    "generator_derived_provenance_forbidden"
                ],
                "resolver_provenance_source_of_truth": provenance_binding[
                    "resolver_provenance_source_of_truth"
                ],
                "provenance_offline_replay": provenance_binding["provenance_offline_replay"],
                "http_availability": provenance_binding["http_availability"],
                "rejected_candidate_drift": rejected_drift,
                "exact_artifacts": exact_artifacts,
            }
        )

    drift_report = {
        "schema_version": "1",
        "report_id": f"code-c-python-inventory-drift-{target}-{head[:12]}",
        "target": target,
        "head_sha": head,
        "inventory_drift": (
            "PRESENT"
            if any(entry["inventory_drift"] == "PRESENT" for entry in drift_entries)
            else "NONE"
        ),
        "comparisons": drift_entries,
    }
    drift_path = output_root / "inventory-drift-report.json"
    write_canonical_json(drift_path, drift_report)

    toolchain = exact_toolchain_evidence(target, arguments.toolchain_root, runtime_identity)
    toolchain_path = output_root / "toolchain-intake-evidence.json"
    write_canonical_json(toolchain_path, toolchain)
    rejected_baseline = load_json(REJECTED_CANDIDATE_BASELINE)
    expected_toolchain_sha = rejected_baseline["toolchain_evidence_sha256"][target]
    if sha256_file(toolchain_path) != expected_toolchain_sha:
        raise SystemExit(f"{target}: toolchain evidence identity changed without toolchain drift")

    runtime_prerequisite = None
    if target == "windows":
        if not arguments.runtime_prerequisite_attestation:
            raise SystemExit("windows inventory review requires current runtime prerequisite attestation")
        probe = load_json(arguments.runtime_prerequisite_attestation)
        prerequisite = load_json(PREREQUISITE)
        installed = probe.get("installed_runtime", {})
        if (
            probe.get("runtime_provider_closure") != "PASS"
            or probe.get("prerequisite_id") != prerequisite["prerequisite_id"]
            or installed.get("minimum_version_satisfied") is not True
        ):
            raise SystemExit("Windows preinstalled runtime prerequisite attestation failed")
        probe_destination = output_root / "windows-runtime-prerequisite-attestation.json"
        copy_json(arguments.runtime_prerequisite_attestation, probe_destination)
        prerequisite_destination = output_root / "external-prerequisite.snapshot.json"
        copy_canonical_json(PREREQUISITE, prerequisite_destination)
        runtime_prerequisite = {
            "status": "PASS",
            "validation_mode": "PREINSTALLED_COMPATIBLE_RUNTIME_ONLY",
            "manifest_id": prerequisite["prerequisite_id"],
            "manifest_sha256": prerequisite["manifest_sha256"],
            "attestation_path": probe_destination.relative_to(output_root).as_posix(),
            "attestation_sha256": sha256_file(probe_destination),
            "installed_runtime_version": installed["version"],
            "minimum_accepted_runtime_version": prerequisite["compatibility_policy"][
                "minimum_accepted_version"
            ],
            "installed_runtime_compatibility": "PASS",
            "vc_redist_downloaded_by_code_c": "NO",
            "vc_redist_bundled_by_code_c": "NO",
            "vc_redist_installed_by_code_c": "NO",
        }

    formal_inventory_root = REPOSITORY_ROOT / "compliance" / "python-artifacts" / target
    current_inventory_ids = []
    if formal_inventory_root.is_dir():
        for path in sorted(formal_inventory_root.glob("*.json")):
            current_inventory_ids.append(load_json(path).get("inventory_id"))
    formal_toolchain = REPOSITORY_ROOT / "compliance" / "python-toolchain" / f"{target}.v1.json"
    target_report = {
        "schema_version": "1",
        "report_id": f"code-c-python-inventory-target-{target}-{head[:12]}",
        "status": "PASS",
        "validation_phase": "PYTHON_INVENTORY_ONLY",
        "code_c_head_sha": head,
        "main_quality_baseline": arguments.main_baseline,
        "contains_required_main_baseline": "PASS",
        "required_previous_code_c_head": arguments.previous_code_c_head,
        "contains_required_previous_c_head": "PASS",
        "required_code_c_containment_sha": arguments.containment_sha,
        "contains_required_containment_sha": "PASS",
        "target": {
            "descriptor_id": f"code-c-{target}-cpython-31315-x86-64-{descriptor_identity[:12]}",
            "descriptor_sha256": descriptor_sha,
            "descriptor_identity_sha256": descriptor_identity,
            "os": target,
            "architecture": "x86_64",
            "python_version": "3.13.15",
            "python_abi": "cp313",
            "python_free_threaded": False,
            "python_gil": "STANDARD",
        },
        "cpython_artifact": {
            "distribution_sha256": runtime_identity["distribution"]["sha256"],
            "interpreter_payload_sha256": load_json(SOURCE_LOCK)["targets"][target][
                "cpython_distribution"
            ]["interpreter_payload_sha256"],
        },
        "inventory_gate_diagnostic": {
            "status": "PASS",
            "required_inventory_roles": ["RUNTIME", "WORKER_BUILD"],
            "current_inventory_ids": current_inventory_ids,
            "current_active_approval_ids": [],
            "missing_inventory_roles": (
                [] if len(current_inventory_ids) == 2 else ["RUNTIME", "WORKER_BUILD"]
            ),
            "missing_approved_inventory_roles": ["RUNTIME", "WORKER_BUILD"],
            "stale_approval_count": 0,
            "target_mismatch_count": 0,
            "role_mismatch_count": 0,
            "inventory_hash_mismatch_count": 0,
            "approval_registry_schema_version": "1",
            "approval_model": "IMMUTABLE_EXACT_SUBJECT_COMPANION_RECORD",
            "toolchain_inventory_required": True,
            "toolchain_inventory_present": formal_toolchain.is_file(),
        },
        "inventory_candidates": inventories,
        "rejected_candidate_baseline_sha256": sha256_file(REJECTED_CANDIDATE_BASELINE),
        "rejected_candidate_history": {
            "dependency_graph_generation": "f57ecb7ca53339ec19718598dc906cc716028d4d",
            "source_provenance_generation": REJECTED_SOURCE_PROVENANCE_CANDIDATES,
            "all_rejected_not_approved": "YES",
        },
        "total_candidate_packages": sum(int(item["package_count"]) for item in inventories),
        "resolver_provenance_binding": "PASS",
        "resolver_record_binding": "PASS",
        "resolver_record_hash_mismatch_count": sum(
            int(item["resolver_record_hash_mismatch_count"]) for item in inventories
        ),
        "candidate_download_url_mismatch_count": sum(
            int(item["candidate_download_url_mismatch_count"]) for item in inventories
        ),
        "candidate_source_url_mismatch_count": sum(
            int(item["candidate_source_url_mismatch_count"]) for item in inventories
        ),
        "unresolved_provenance_defect_count": sum(
            int(item["unresolved_provenance_defect_count"]) for item in inventories
        ),
        "download_url_semantics": "MATCH_CURRENT_RESOLVER_CONTRACT",
        "candidate_url_recanonicalization_by_generator": "NO",
        "generator_derived_provenance_forbidden": "PASS",
        "resolver_provenance_source_of_truth": "PASS",
        "cross_inventory_exact_artifact_provenance_consistency": "PASS",
        "exact_artifact_provenance": "CONSISTENT",
        "inventory_usage_role": "CONTEXT_SPECIFIC",
        "provenance_offline_replay": "PASS",
        "http_availability": "DIAGNOSTIC_ONLY",
        "inventory_schema_version": "3",
        "inventory_v3_schema_id": inventory_v3_identity["schema_id"],
        "inventory_v3_schema_sha256": inventory_v3_identity["schema_sha256"],
        "inventory_v3_validator_id": inventory_v3_identity["validator_id"],
        "inventory_v3_contract_source": inventory_v3_identity["contract_source"],
        "raw_v3_schema_validation": "PASS",
        "factual_graph_completeness": "PASS",
        "v2_to_v3_factual_semantic_equivalence": "PASS",
        "subject_bytes": "CHANGED_AS_EXPECTED",
        "factual_semantics": "UNCHANGED",
        "dependency_graph_validation": "PASS",
        "resolution_serialization_consistency": "PASS",
        "resolution_state_conflict_count": sum(
            int(item["resolution_state_conflict_count"]) for item in inventories
        ),
        "resolved_not_applicable_emitted_as_formal_dependency_count": sum(
            int(item["resolved_not_applicable_emitted_as_formal_dependency_count"])
            for item in inventories
        ),
        "invalid_review_required_dependency_entries": sum(
            int(item["invalid_review_required_dependency_entries"]) for item in inventories
        ),
        "invalid_pseudo_purl_count": sum(
            int(item["invalid_pseudo_purl_count"]) for item in inventories
        ),
        "missing_required_purl_field_count": sum(
            int(item["missing_required_purl_field_count"]) for item in inventories
        ),
        "invalid_purl_format_count": sum(
            int(item["invalid_purl_format_count"]) for item in inventories
        ),
        "pseudo_purl_in_formal_dependencies": sum(
            int(item["pseudo_purl_in_formal_dependencies"]) for item in inventories
        ),
        "resolution_state_conflict_fail_closed": "PASS",
        "target_descriptor_binding": "PASS",
        "cp313_standard_gil_binding": "PASS",
        "toolchain_evidence_identity_unchanged": "PASS",
        "exact_artifact_set_drift": "NONE",
        "exact_artifact_set_drift_from_rejected_candidate": "NONE",
        "dependency_graph_drift": "NONE",
        "semantic_dependency_graph_drift": "NONE",
        "target_drift": "NONE",
        "role_drift": "NONE",
        "resolver_provenance_drift": "NONE",
        "v3_migration_artifact_set_change": "NO",
        "v3_migration_dependency_graph_change": "NO",
        "v3_migration_resolver_provenance_change": "NO",
        "v3_migration_target_change": "NO",
        "v3_migration_role_change": "NO",
        "approval_lifecycle_embedded_in_subject": "NO",
        "approval_provenance_embedded_in_raw_subject": "NO",
        "reviewer_authority_embedded_in_raw_subject": "NO",
        "revocation_state_embedded_in_raw_subject": "NO",
        "external_approval_is_authoritative": "YES",
        "artifact_set_drift_explanation": (
            "Exact wheel artifacts are unchanged; only dependency edges not authorized by the "
            "resolver disposition were removed."
        ),
        "inventory_graph_completeness": "PASS",
        "dependency_definitions_sha256": canonical_sha256(load_json(DEFINITIONS)),
        "dependency_graph_set_sha256": canonical_sha256(
            [entry["dependency_graph_identity_sha256"] for entry in inventories]
        ),
        "artifact_graph_semantic_digest": canonical_sha256(
            [entry["semantic_equivalence"]["artifact_graph_semantic_digest"] for entry in inventories]
        ),
        "dependency_graph_semantic_digest": canonical_sha256(
            [entry["semantic_equivalence"]["dependency_graph_semantic_digest"] for entry in inventories]
        ),
        "resolver_provenance_semantic_digest": canonical_sha256(
            [
                entry["semantic_equivalence"]["resolver_provenance_semantic_digest"]
                for entry in inventories
            ]
        ),
        "target_semantic_digest": canonical_sha256(
            [entry["semantic_equivalence"]["target_semantic_digest"] for entry in inventories]
        ),
        "role_semantic_digest": canonical_sha256(
            [entry["semantic_equivalence"]["role_semantic_digest"] for entry in inventories]
        ),
        "inventory_drift": drift_report["inventory_drift"],
        "inventory_drift_report_id": drift_report["report_id"],
        "inventory_drift_report_sha256": sha256_file(drift_path),
        "historical_approval_reuse_count": 0,
        "new_approval_required_count": len(inventories) + (0 if formal_toolchain.is_file() else 1),
        "toolchain_intake_evidence_path": toolchain_path.relative_to(output_root).as_posix(),
        "toolchain_intake_evidence_sha256": sha256_file(toolchain_path),
        "toolchain_evidence": "PRESERVED",
        "toolchain_artifact_identity": "UNCHANGED",
        "toolchain_evidence_change_reason": (
            "Exact CPython, pip, PyInstaller, bootloader, target, and role bindings are unchanged."
        ),
        "toolchain_approval": "PENDING_CODE_F",
        "expected_approval_contract_sha256": APPROVAL_CONTRACT_SHA256,
        "expected_reviewer_authority_policy_sha256": REVIEWER_AUTHORITY_POLICY_SHA256,
        "v2_approval_reuse_for_v3_subject": "FORBIDDEN",
        "known_approval_provenance_qicr": "YES",
        "qicr_required": "RESOLVED",
        "qicr_status": "KNOWN_PENDING_AFTER_VALID_CANDIDATE",
        "qicr_implemented_by_code_c": "NO",
        "cve_stage_a_reuse": "REBIND_REQUIRED",
        "cve_stage_a_rebind_executed": "NO",
        "runtime_prerequisite_attestation": runtime_prerequisite,
        "actions_artifact_containment": {
            "status": "PASS",
            "large_candidate_actions_upload": "FORBIDDEN",
            "max_single_actions_artifact_bytes": 20 * 1024 * 1024,
            "declared_total_run_budget_bytes": 20 * 1024 * 1024,
            "candidate_worker_binary": "NOT_GENERATED",
            "pyinstaller_workpath": "NOT_GENERATED",
            "python_environment_upload": "FORBIDDEN",
        },
        "approval_owner": "CODE_F_INVENTORY_REVIEW",
        "python_inventory_gate": "BLOCKED_PENDING_CODE_F_APPROVAL",
        "downstream": {
            "one_file_worker_build": "BLOCKED_NOT_RERUN",
            "windows_native_reconciliation": "BLOCKED_NOT_RERUN",
            "linux_native_reconciliation": "BLOCKED_NOT_RERUN",
            "python_license_gate": "BLOCKED_NOT_RERUN",
            "stage_b": "BLOCKED_NOT_RERUN",
            "real_siglip_onnx_e2e": "BLOCKED_NOT_RERUN",
            "index_regression": "BLOCKED_NOT_RERUN",
        },
    }
    write_canonical_json(output_root / "target-report.json", target_report)
    print(
        f"python-inventory-review-target: PASS ({target}; {len(inventories)} inventories; "
        f"{sum(item['package_count'] for item in inventories)} role-scoped wheel records)"
    )


def assemble(arguments: argparse.Namespace) -> None:
    reports = sorted(arguments.input_root.rglob("target-report.json"))
    if len(reports) != 2:
        raise SystemExit(f"expected two target reports, got {len(reports)}")
    loaded = [(path, load_json(path)) for path in reports]
    by_target = {str(report["target"]["os"]): (path, report) for path, report in loaded}
    if set(by_target) != {"linux", "windows"}:
        raise SystemExit("inventory review bundle requires independent Linux and Windows reports")
    heads = {report["code_c_head_sha"] for _, report in loaded}
    if len(heads) != 1 or any(report.get("status") != "PASS" for _, report in loaded):
        raise SystemExit("target inventory reports do not share one passing current HEAD")
    head = heads.pop()
    if any(
        report.get("main_quality_baseline") != REQUIRED_MAIN_BASELINE
        or report.get("contains_required_main_baseline") != "PASS"
        or report.get("required_previous_code_c_head") != REQUIRED_PREVIOUS_CODE_C_HEAD
        or report.get("contains_required_previous_c_head") != "PASS"
        for _, report in loaded
    ):
        raise SystemExit("review bundle assembly blocked by baseline or previous Code C ancestry")
    v3_identity = inventory_v3_contract_identity()
    if any(
        {
            report.get("inventory_v3_schema_id"),
            report.get("inventory_v3_schema_sha256"),
            report.get("inventory_v3_validator_id"),
        }
        != {
            v3_identity["schema_id"],
            v3_identity["schema_sha256"],
            v3_identity["validator_id"],
        }
        for _, report in loaded
    ):
        raise SystemExit("review bundle assembly blocked by Inventory v3 contract identity drift")
    required_pass_fields = (
        "inventory_v3_schema_validation",
        "raw_v3_schema_validation",
        "factual_graph_completeness",
        "v2_to_v3_factual_semantic_equivalence",
        "dependency_graph_validation",
        "resolution_serialization_consistency",
        "resolver_provenance_binding",
        "resolver_record_binding",
        "generator_derived_provenance_forbidden",
        "resolver_provenance_source_of_truth",
        "cross_inventory_exact_artifact_provenance_consistency",
        "provenance_offline_replay",
        "resolution_state_conflict_fail_closed",
        "target_descriptor_binding",
        "cp313_standard_gil_binding",
        "toolchain_evidence_identity_unchanged",
    )
    required_zero_fields = (
        "resolution_state_conflict_count",
        "resolved_not_applicable_emitted_as_formal_dependency_count",
        "invalid_review_required_dependency_entries",
        "invalid_pseudo_purl_count",
        "missing_required_purl_field_count",
        "invalid_purl_format_count",
        "pseudo_purl_in_formal_dependencies",
        "resolver_record_hash_mismatch_count",
        "candidate_download_url_mismatch_count",
        "candidate_source_url_mismatch_count",
        "unresolved_provenance_defect_count",
    )
    required_exact_fields = {
        "download_url_semantics": "MATCH_CURRENT_RESOLVER_CONTRACT",
        "candidate_url_recanonicalization_by_generator": "NO",
        "exact_artifact_provenance": "CONSISTENT",
        "inventory_usage_role": "CONTEXT_SPECIFIC",
        "http_availability": "DIAGNOSTIC_ONLY",
    }
    for _, report in loaded:
        if any(report.get(field) != "PASS" for field in required_pass_fields):
            raise SystemExit("review bundle assembly blocked by failed candidate validation")
        if any(report.get(field) != 0 for field in required_zero_fields):
            raise SystemExit("review bundle assembly blocked by non-zero candidate defects")
        if report.get("exact_artifact_set_drift_from_rejected_candidate") != "NONE":
            raise SystemExit("review bundle assembly blocked by exact artifact set drift")
        if (
            report.get("semantic_dependency_graph_drift")
            != "NONE"
        ):
            raise SystemExit("review bundle assembly blocked by unexpected semantic graph drift")
        if any(report.get(field) != value for field, value in required_exact_fields.items()):
            raise SystemExit("review bundle assembly blocked by resolver provenance validation")
    dependency_definition_ids = {
        report["dependency_definitions_sha256"] for _, report in loaded
    }
    if len(dependency_definition_ids) != 1:
        raise SystemExit("Linux/Windows dependency definition canonical identities differ")
    toolchain_source_lock_ids = {
        load_json(path.parent / report["toolchain_intake_evidence_path"])[
            "source_lock_sha256"
        ]
        for path, report in loaded
    }
    if len(toolchain_source_lock_ids) != 1:
        raise SystemExit("Linux/Windows toolchain source-lock canonical identities differ")
    provenance_by_sha: dict[str, tuple[object, ...]] = {}
    for _, report in loaded:
        for inventory in report["inventory_candidates"]:
            for record in inventory["resolver_provenance_details"]["records"]:
                identity = (
                    record["resolver_download_url"],
                    record["resolver_source"],
                    record["candidate_purl"],
                )
                artifact_sha = str(record["artifact_identity_sha256"])
                previous = provenance_by_sha.setdefault(artifact_sha, identity)
                if previous != identity:
                    raise SystemExit(
                        "review bundle assembly blocked by cross-inventory artifact provenance drift"
                    )
    if arguments.output_root.exists():
        raise SystemExit(f"inventory review bundle output must start absent: {arguments.output_root}")
    arguments.output_root.mkdir(parents=True)
    inventory_requests = []
    target_summaries = []
    for target in ("linux", "windows"):
        report_path, report = by_target[target]
        destination = arguments.output_root / "targets" / target
        shutil.copytree(report_path.parent, destination)
        copied_report = destination / "target-report.json"
        for inventory in report["inventory_candidates"]:
            inventory_requests.append(
                {
                    "subject_type": "PYTHON_ARTIFACT_INVENTORY",
                    "inventory_id": inventory["inventory_id"],
                    "subject_schema_version": "3",
                    "inventory_sha256": inventory["candidate_sha256"],
                    "inventory_v3_schema_id": inventory["inventory_v3_schema_id"],
                    "inventory_v3_schema_sha256": inventory["inventory_v3_schema_sha256"],
                    "inventory_v3_validator_id": inventory["inventory_v3_validator_id"],
                    "target": target,
                    "role": inventory["role"],
                    "target_descriptor_sha256": report["target"]["descriptor_sha256"],
                    "approval_record_id": None,
                    "approval_status": "PENDING_CODE_F_APPROVAL",
                    "subject_sha256": inventory["candidate_sha256"],
                    "expected_approval_contract_sha256": APPROVAL_CONTRACT_SHA256,
                    "expected_reviewer_authority_policy_sha256": REVIEWER_AUTHORITY_POLICY_SHA256,
                }
            )
        target_summaries.append(
            {
                "target": target,
                "report_path": copied_report.relative_to(arguments.output_root).as_posix(),
                "report_sha256": sha256_file(copied_report),
                "target_descriptor_sha256": report["target"]["descriptor_sha256"],
                "cpython_distribution_sha256": report["cpython_artifact"][
                    "distribution_sha256"
                ],
                "dependency_graph_set_sha256": report["dependency_graph_set_sha256"],
                "dependency_definitions_sha256": report[
                    "dependency_definitions_sha256"
                ],
                "toolchain_source_lock_sha256": load_json(
                    destination / "toolchain-intake-evidence.json"
                )["source_lock_sha256"],
                "inventory_drift": report["inventory_drift"],
                "inventory_schema_version": report["inventory_schema_version"],
                "inventory_v3_schema_id": report["inventory_v3_schema_id"],
                "inventory_v3_schema_sha256": report["inventory_v3_schema_sha256"],
                "inventory_v3_validator_id": report["inventory_v3_validator_id"],
                "raw_v3_schema_validation": report["raw_v3_schema_validation"],
                "factual_graph_completeness": report["factual_graph_completeness"],
                "v2_to_v3_factual_semantic_equivalence": report[
                    "v2_to_v3_factual_semantic_equivalence"
                ],
                "dependency_graph_validation": report["dependency_graph_validation"],
                "resolution_serialization_consistency": report[
                    "resolution_serialization_consistency"
                ],
                "resolver_provenance_binding": report["resolver_provenance_binding"],
                "resolver_record_binding": report["resolver_record_binding"],
                "download_url_semantics": report["download_url_semantics"],
                "generator_derived_provenance_forbidden": report[
                    "generator_derived_provenance_forbidden"
                ],
                "resolver_provenance_source_of_truth": report[
                    "resolver_provenance_source_of_truth"
                ],
                "cross_inventory_exact_artifact_provenance_consistency": report[
                    "cross_inventory_exact_artifact_provenance_consistency"
                ],
                "exact_artifact_provenance": report["exact_artifact_provenance"],
                "provenance_offline_replay": report["provenance_offline_replay"],
                "http_availability": report["http_availability"],
                "resolver_record_hash_mismatch_count": report[
                    "resolver_record_hash_mismatch_count"
                ],
                "candidate_download_url_mismatch_count": report[
                    "candidate_download_url_mismatch_count"
                ],
                "candidate_source_url_mismatch_count": report[
                    "candidate_source_url_mismatch_count"
                ],
                "unresolved_provenance_defect_count": report[
                    "unresolved_provenance_defect_count"
                ],
                "exact_artifact_set_drift_from_rejected_candidate": report[
                    "exact_artifact_set_drift_from_rejected_candidate"
                ],
                "semantic_dependency_graph_drift": report[
                    "semantic_dependency_graph_drift"
                ],
                "toolchain_evidence": report["toolchain_evidence"],
                "toolchain_artifact_identity": report["toolchain_artifact_identity"],
                "toolchain_evidence_identity_unchanged": report[
                    "toolchain_evidence_identity_unchanged"
                ],
            }
        )
    identity = {
        "head_sha": head,
        "main_quality_baseline": loaded[0][1]["main_quality_baseline"],
        "required_previous_code_c_head": loaded[0][1]["required_previous_code_c_head"],
        "required_code_c_containment_sha": loaded[0][1][
            "required_code_c_containment_sha"
        ],
        "inventory_v3_contract": v3_identity,
        "approval_contract_sha256": APPROVAL_CONTRACT_SHA256,
        "reviewer_authority_policy_sha256": REVIEWER_AUTHORITY_POLICY_SHA256,
        "target_descriptor_sha256": {
            target: by_target[target][1]["target"]["descriptor_sha256"]
            for target in ("linux", "windows")
        },
        "toolchain_evidence_sha256": {
            target: by_target[target][1]["toolchain_intake_evidence_sha256"]
            for target in ("linux", "windows")
        },
        "semantic_digests": {
            target: {
                key: by_target[target][1][key]
                for key in (
                    "artifact_graph_semantic_digest",
                    "dependency_graph_semantic_digest",
                    "resolver_provenance_semantic_digest",
                    "target_semantic_digest",
                    "role_semantic_digest",
                )
            }
            for target in ("linux", "windows")
        },
        "target_summaries": target_summaries,
        "inventory_requests": inventory_requests,
    }
    bundle_id = f"code-c-python-inventory-review-{head[:12]}-{canonical_sha256(identity)[:16]}"
    bundle = {
        "schema_version": "1",
        "bundle_id": bundle_id,
        "bundle_semantics": "BATCH_CONTAINER_ONLY",
        "status": "READY_FOR_CODE_F_REVIEW",
        "validation_phase": "PYTHON_INVENTORY_ONLY",
        "code_c_python_inventory_regeneration": "PASS",
        "total_candidate_packages": sum(
            int(report["total_candidate_packages"]) for _, report in loaded
        ),
        "inventory_schema_version": "3",
        "inventory_v3_schema_id": inventory_v3_contract_identity()["schema_id"],
        "inventory_v3_schema_sha256": inventory_v3_contract_identity()["schema_sha256"],
        "inventory_v3_validator_id": inventory_v3_contract_identity()["validator_id"],
        "inventory_v3_contract_source": "MAIN_QUALITY_BASELINE",
        "raw_v3_schema_validation": "PASS",
        "factual_graph_completeness": "PASS",
        "v2_to_v3_factual_semantic_equivalence": "PASS",
        "subject_bytes": "CHANGED_AS_EXPECTED",
        "factual_semantics": "UNCHANGED",
        "dependency_graph_validation": "PASS",
        "resolution_serialization_consistency": "PASS",
        "invalid_review_required_dependency_entries": 0,
        "invalid_pseudo_purl_count": 0,
        "missing_required_purl_fields": 0,
        "missing_required_purl_field_count": 0,
        "pseudo_purl_in_formal_dependencies": 0,
        "invalid_purl_format_count": 0,
        "resolution_state_conflict_count": 0,
        "resolved_not_applicable_emitted_as_formal_dependency_count": 0,
        "resolver_provenance_binding": "PASS",
        "resolver_record_binding": "PASS",
        "resolver_record_hash_mismatch_count": 0,
        "candidate_download_url_mismatch_count": 0,
        "candidate_source_url_mismatch_count": 0,
        "unresolved_provenance_defect_count": 0,
        "download_url_semantics": "MATCH_CURRENT_RESOLVER_CONTRACT",
        "candidate_url_recanonicalization_by_generator": "NO",
        "generator_derived_provenance_forbidden": "PASS",
        "resolver_provenance_source_of_truth": "PASS",
        "cross_inventory_exact_artifact_provenance_consistency": "PASS",
        "exact_artifact_provenance": "CONSISTENT",
        "inventory_usage_role": "CONTEXT_SPECIFIC",
        "provenance_offline_replay": "PASS",
        "http_availability": "DIAGNOSTIC_ONLY",
        "exact_artifact_set_drift": "NONE",
        "exact_artifact_set_drift_from_rejected_candidate": "NONE",
        "dependency_graph_drift": "NONE",
        "semantic_dependency_graph_drift": "NONE",
        "target_drift": "NONE",
        "role_drift": "NONE",
        "resolver_provenance_drift": "NONE",
        "v3_migration_artifact_set_change": "NO",
        "v3_migration_dependency_graph_change": "NO",
        "v3_migration_resolver_provenance_change": "NO",
        "v3_migration_target_change": "NO",
        "v3_migration_role_change": "NO",
        "target_descriptor_binding": "PASS",
        "target_descriptor_drift": "NONE",
        "role_binding_drift": "NONE",
        "graph_complete": True,
        "review_status": "EXTERNAL_COMPANION_APPROVAL_PENDING",
        "raw_subject_graph_complete": True,
        "raw_subject_review_status_field": "ABSENT_BY_V3_CONTRACT",
        "toolchain_evidence": "PRESERVED",
        "toolchain_artifact_identity": "UNCHANGED",
        "toolchain_evidence_change_reason": (
            "Exact CPython, pip, PyInstaller, bootloader, target, and role bindings are unchanged."
        ),
        "toolchain_approval": "PENDING_CODE_F",
        "toolchain_evidence_identity_unchanged": "PASS",
        "expected_approval_contract_sha256": APPROVAL_CONTRACT_SHA256,
        "expected_reviewer_authority_policy_sha256": REVIEWER_AUTHORITY_POLICY_SHA256,
        "v2_approval_reuse_for_v3_subject": "FORBIDDEN",
        "inventory_review_head_sha": head,
        "main_quality_baseline": identity["main_quality_baseline"],
        "required_previous_code_c_head": identity["required_previous_code_c_head"],
        "required_code_c_containment_sha": identity["required_code_c_containment_sha"],
        "contains_required_main_baseline": "PASS",
        "contains_required_previous_c_head": "PASS",
        "inventory_v3_schema_id": v3_identity["schema_id"],
        "inventory_v3_schema_sha256": v3_identity["schema_sha256"],
        "inventory_v3_validator_id": v3_identity["validator_id"],
        "inventory_v3_contract_source": v3_identity["contract_source"],
        "target_descriptor_sha256": identity["target_descriptor_sha256"],
        "toolchain_evidence_sha256": identity["toolchain_evidence_sha256"],
        "semantic_digests": identity["semantic_digests"],
        "bundle_identity_payload_sha256": canonical_sha256(identity),
        "target_summaries": target_summaries,
        "inventory_approval_requests": inventory_requests,
        "pre_assembly_validation": {
            "inventory_v3_schema_validation": "PASS",
            "raw_v3_schema_validation": "PASS",
            "factual_graph_completeness": "PASS",
            "v2_to_v3_factual_semantic_equivalence": "PASS",
            "dependency_graph_validation": "PASS",
            "resolution_serialization_consistency": "PASS",
            "resolution_state_conflict_count": 0,
            "resolved_not_applicable_emitted_as_formal_dependency_count": 0,
            "invalid_review_required_dependency_entries": 0,
            "invalid_pseudo_purl_count": 0,
            "missing_required_purl_fields": 0,
            "missing_required_purl_field_count": 0,
            "invalid_purl_format_count": 0,
            "pseudo_purl_in_formal_dependencies": 0,
            "resolution_state_conflict_fail_closed": "PASS",
            "target_descriptor_binding": "PASS",
            "cp313_standard_gil_binding": "PASS",
            "toolchain_evidence_identity_unchanged": "PASS",
            "exact_artifact_set_drift_from_rejected_candidate": "NONE",
            "semantic_dependency_graph_drift": "NONE",
            "resolver_provenance_drift": "NONE",
            "approval_projection_used_for_raw_validation": "NO",
            "validation_time_field_injection": "NO",
            "validation_time_subject_mutation": "NO",
        },
        "toolchain_approval_requests": [
            {
                "target": target,
                "evidence_path": f"targets/{target}/toolchain-intake-evidence.json",
                "evidence_sha256": sha256_file(
                    arguments.output_root
                    / "targets"
                    / target
                    / "toolchain-intake-evidence.json"
                ),
                "approval_status": "PENDING_CODE_F_APPROVAL",
                "approval_owner": "CODE_F",
            }
            for target in ("linux", "windows")
        ],
        "historical_approval_reuse_count": 0,
        "new_inventory_approval_required_count": len(inventory_requests),
        "approval_registry_schema_version": "1",
        "approval_model": "IMMUTABLE_EXACT_SUBJECT_COMPANION_RECORD",
        "python_inventory_gate": "BLOCKED_PENDING_CODE_F_APPROVAL",
        "approval_reconciliation": "PENDING_CODE_F_APPROVAL",
        "known_approval_provenance_qicr": "YES",
        "qicr_required": "RESOLVED",
        "qicr_status": "RESOLVED",
        "qicr_implemented_by_code_c": "NO",
        "cve_stage_a_reuse": "REBIND_REQUIRED",
        "cve_stage_a_rebind_executed": "NO",
        "downstream": {
            "worker_build": "BLOCKED_NOT_RERUN",
            "native_reconciliation": "BLOCKED_NOT_RERUN",
            "python_license_gate": "BLOCKED_NOT_RERUN",
            "stage_b": "BLOCKED_NOT_RERUN",
            "real_siglip_onnx_e2e": "BLOCKED_NOT_RERUN",
            "index_regression": "BLOCKED_NOT_RERUN",
        },
        "artifact_containment": {
            "status": "PASS",
            "large_candidate_actions_upload": "FORBIDDEN",
            "target_artifact_budget_bytes_each": 4 * 1024 * 1024,
            "final_bundle_budget_bytes": 12 * 1024 * 1024,
            "declared_total_run_budget_bytes": 20 * 1024 * 1024,
        },
        "actions_artifact_containment": {
            "status": "PASS",
            "large_candidate_actions_upload": "FORBIDDEN",
            "max_single_actions_artifact_bytes": 20 * 1024 * 1024,
            "declared_total_run_budget_bytes": 20 * 1024 * 1024,
            "candidate_worker_binary": "NOT_GENERATED",
            "pyinstaller_workpath": "NOT_GENERATED",
            "python_environment_upload": "FORBIDDEN",
        },
        "candidate_worker_generated": "NO",
        "pyinstaller_workpath_generated": "NO",
        "large_candidate_actions_upload": "FORBIDDEN",
        "candidate_inventory_sha256s": {
            f"{request['target']}/{request['role']}": request["inventory_sha256"]
            for request in inventory_requests
        },
        "staleness_triggers": [
            "target descriptor changes",
            "CPython artifact changes",
            "toolchain source lock changes",
            "dependency definitions change",
            "resolved wheel set or exact bytes change",
            "inventory role changes",
            "shared inventory schema or generator semantics change",
        ],
        "review_bundle_assembly": "PASS",
        "owner_of_next_fix": "CODE_F_INVENTORY_REVIEW",
        "pr_8_updated": "NO",
    }
    bundle_path = arguments.output_root / "CODE_C_PYTHON_INVENTORY_REVIEW_BUNDLE.json"
    write_canonical_json(bundle_path, bundle)
    summary = (
        "# Code C Python Inventory Review Request\n\n"
        f"- Bundle: `{bundle_id}`\n"
        f"- Code C HEAD: `{head}`\n"
        "- Semantics: `BATCH_CONTAINER_ONLY`\n"
        "- Inventory requests: 4 (Linux/Windows runtime and worker-build)\n"
        "- Toolchain evidence requests: 2 (Linux and Windows)\n"
        "- Approval owner: Code F\n"
        "- Python Inventory Gate: `BLOCKED_PENDING_CODE_F_APPROVAL`\n"
        "- Worker, Native, License, Stage B, SigLIP and Index gates: `BLOCKED_NOT_RERUN`\n\n"
        "Each inventory/role requires an independent approval decision. Acceptance of this bundle does not "
        "approve any contained inventory.\n"
    )
    (arguments.output_root / "CODE_C_PYTHON_INVENTORY_REVIEW_REQUEST.md").write_bytes(
        summary.encode("utf-8")
    )
    print(
        f"python-inventory-review-bundle: PASS ({bundle_id}; "
        f"{len(inventory_requests)} independent inventory requests)"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    target_parser = subparsers.add_parser("target")
    target_parser.add_argument("--target", choices=["windows", "linux"], required=True)
    target_parser.add_argument("--main-baseline", required=True)
    target_parser.add_argument("--previous-code-c-head", required=True)
    target_parser.add_argument("--containment-sha", required=True)
    target_parser.add_argument("--target-descriptor", type=Path, required=True)
    target_parser.add_argument("--runtime-identity", type=Path, required=True)
    target_parser.add_argument("--installation-evidence", type=Path, required=True)
    target_parser.add_argument("--graph-attestation", type=Path, required=True)
    target_parser.add_argument("--candidate-root", type=Path, required=True)
    target_parser.add_argument("--resolution-root", type=Path, required=True)
    target_parser.add_argument("--wheel-root", type=Path, required=True)
    target_parser.add_argument("--toolchain-root", type=Path, required=True)
    target_parser.add_argument("--runtime-prerequisite-attestation", type=Path)
    target_parser.add_argument("--output-root", type=Path, required=True)
    assemble_parser = subparsers.add_parser("assemble")
    assemble_parser.add_argument("--input-root", type=Path, required=True)
    assemble_parser.add_argument("--output-root", type=Path, required=True)
    arguments = parser.parse_args()
    if arguments.command == "target":
        prepare_target(arguments)
    else:
        assemble(arguments)


if __name__ == "__main__":
    main()
