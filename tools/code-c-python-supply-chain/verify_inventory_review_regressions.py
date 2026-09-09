from __future__ import annotations

import argparse
import contextlib
import io
import json
import tempfile
from pathlib import Path

from canonical_evidence import write_canonical_json
from inventory_candidate_serialization import (
    CandidateSerializationError,
    serialize_candidate_from_resolution,
    validate_resolution_serialization,
)
from prepare_inventory_review import (
    REQUIRED_MAIN_BASELINE,
    REQUIRED_PREVIOUS_CODE_C_HEAD,
    assemble,
    inventory_v3_contract_identity,
    safe_archive_member,
)


HEAD = "a" * 40
CONTAINMENT = "c" * 40


def target_report(target: str) -> dict[str, object]:
    v3 = inventory_v3_contract_identity()
    return {
        "schema_version": "1",
        "status": "PASS",
        "code_c_head_sha": HEAD,
        "main_quality_baseline": REQUIRED_MAIN_BASELINE,
        "contains_required_main_baseline": "PASS",
        "required_previous_code_c_head": REQUIRED_PREVIOUS_CODE_C_HEAD,
        "contains_required_previous_c_head": "PASS",
        "required_code_c_containment_sha": CONTAINMENT,
        "contains_required_containment_sha": "PASS",
        "target": {
            "os": target,
            "descriptor_sha256": ("1" if target == "linux" else "2") * 64,
        },
        "cpython_artifact": {
            "distribution_sha256": ("3" if target == "linux" else "4") * 64,
        },
        "dependency_graph_set_sha256": ("5" if target == "linux" else "6") * 64,
        "dependency_definitions_sha256": "e" * 64,
        "inventory_drift": "PRESENT",
        "total_candidate_packages": 2,
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
        "inventory_schema_version": "3",
        "inventory_v3_schema_id": v3["schema_id"],
        "inventory_v3_schema_sha256": v3["schema_sha256"],
        "inventory_v3_validator_id": v3["validator_id"],
        "inventory_v3_contract_source": v3["contract_source"],
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
        "missing_required_purl_field_count": 0,
        "invalid_purl_format_count": 0,
        "pseudo_purl_in_formal_dependencies": 0,
        "resolution_state_conflict_fail_closed": "PASS",
        "target_descriptor_binding": "PASS",
        "cp313_standard_gil_binding": "PASS",
        "exact_artifact_set_drift_from_rejected_candidate": "NONE",
        "semantic_dependency_graph_drift": "NONE",
        "toolchain_evidence": "PRESERVED",
        "toolchain_artifact_identity": "UNCHANGED",
        "toolchain_evidence_identity_unchanged": "PASS",
        "toolchain_intake_evidence_sha256": "a" * 64,
        "artifact_graph_semantic_digest": "b" * 64,
        "dependency_graph_semantic_digest": "c" * 64,
        "resolver_provenance_semantic_digest": "d" * 64,
        "target_semantic_digest": "e" * 64,
        "role_semantic_digest": "f" * 64,
        "inventory_candidates": [
            {
                "inventory_id": f"code-c-{target}-{scope}-py31315",
                "candidate_sha256": character * 64,
                "role": role,
                "dependency_graph_identity_sha256": graph_character * 64,
                "inventory_v3_schema_id": v3["schema_id"],
                "inventory_v3_schema_sha256": v3["schema_sha256"],
                "inventory_v3_validator_id": v3["validator_id"],
                "resolver_provenance_details": {
                    "records": [
                        {
                            "artifact_identity_sha256": "a" * 64,
                            "resolver_download_url": "https://files.example.test/fixture.whl",
                            "resolver_source": "https://example.test/fixture/1.0.0/",
                            "candidate_purl": "pkg:pypi/fixture@1.0.0",
                        }
                    ]
                },
            }
            for scope, role, character, graph_character in (
                ("runtime", "RUNTIME", "7", "8"),
                ("worker-build", "WORKER_BUILD", "9", "d"),
            )
        ],
        "toolchain_intake_evidence_path": "toolchain-intake-evidence.json",
    }


def write_target(root: Path, target: str) -> None:
    target_root = root / f"artifact-{target}" / target
    target_root.mkdir(parents=True)
    write_canonical_json(target_root / "target-report.json", target_report(target))
    write_canonical_json(
        target_root / "toolchain-intake-evidence.json",
        {"schema_version": "1", "target": target, "source_lock_sha256": "f" * 64},
    )


def main() -> None:
    assertions = 0
    safe_archive_member("PyInstaller/bootloader/Linux-64bit-intel/run")
    assertions += 1
    try:
        safe_archive_member("../run")
    except SystemExit:
        assertions += 1
    else:
        raise SystemExit("unsafe archive member was accepted")

    resolution = {
        "packages": [
            {
                "name": "Root_Package",
                "version": "1.0.0",
                "dependencies": ["included-package"],
                "dependency_declarations": [
                    {
                        "requirement": "included-package==2.0.0",
                        "package_name": "included-package",
                        "disposition": "INCLUDED",
                        "dependency": "included-package",
                        "reason": "",
                    },
                    {
                        "requirement": "optional-package; sys_platform == 'never'",
                        "package_name": "optional-package",
                        "disposition": "NOT_APPLICABLE",
                        "dependency": None,
                        "reason": "Marker evaluated false for the approved target.",
                    },
                ],
            },
            {
                "name": "included-package",
                "version": "2.0.0",
                "dependencies": [],
                "dependency_declarations": [],
            },
        ]
    }
    candidate = {
        "packages": [
            {
                "package_name": "Root_Package",
                "version": "1.0.0",
                "dependencies": ["REVIEW_REQUIRED:optional-package"],
                "dependency_declarations": [],
            },
            {
                "package_name": "included-package",
                "version": "2.0.0",
                "dependencies": [],
                "dependency_declarations": [],
            },
        ]
    }
    serialized = serialize_candidate_from_resolution(candidate, resolution)
    root_package = serialized["packages"][0]
    if root_package["dependencies"] != ["pkg:pypi/included-package@2.0.0"]:
        raise SystemExit("resolved dependency was not serialized as a formal purl")
    assertions += 1
    not_applicable = root_package["dependency_declarations"][1]
    if not_applicable["purl"] is not None or not_applicable["disposition"] != "NOT_APPLICABLE":
        raise SystemExit("not-applicable resolution evidence was serialized incorrectly")
    assertions += 1
    validate_resolution_serialization(serialized, resolution)
    assertions += 1

    provenance_resolution = {
        "approved_index": "https://pypi.org/simple",
        "packages": [
            {
                "name": "provenance-fixture",
                "version": "3.0.0",
                "dependencies": [],
                "dependency_declarations": [],
                "provenance": {
                    "filename": "provenance_fixture-3.0.0-py3-none-any.whl",
                    "sha256": "a" * 64,
                    "download_url": "https://files.pythonhosted.org/packages/aa/bb/provenance_fixture-3.0.0-py3-none-any.whl",
                    "source": "https://pypi.org/project/provenance-fixture/3.0.0/",
                    "source_index": "https://pypi.org/simple",
                },
            }
        ],
    }
    provenance_candidate = {
        "packages": [
            {
                "package_name": "provenance-fixture",
                "version": "3.0.0",
                "filename": "provenance_fixture-3.0.0-py3-none-any.whl",
                "sha256": "a" * 64,
                "source": "https://pypi.org/project/provenance-fixture/",
                "source_index": "https://pypi.org/simple",
                "provenance": {
                    "download_url": "https://files.pythonhosted.org/packages/provenance_fixture-3.0.0-py3-none-any.whl"
                },
                "dependencies": [],
                "dependency_declarations": [],
            }
        ]
    }
    bound_provenance = serialize_candidate_from_resolution(
        provenance_candidate, provenance_resolution
    )
    bound_package = bound_provenance["packages"][0]
    if (
        bound_package["source"] != "https://pypi.org/project/provenance-fixture/3.0.0/"
        or bound_package["provenance"]["download_url"]
        != provenance_resolution["packages"][0]["provenance"]["download_url"]
    ):
        raise SystemExit("candidate provenance was not copied from resolver evidence")
    assertions += 1

    for pseudo_value in (
        "REVIEW_REQUIRED:forbidden",
        "NOT_APPLICABLE:forbidden",
        "UNKNOWN:forbidden",
        "UNRESOLVED:forbidden",
    ):
        pseudo = json.loads(json.dumps(serialized))
        pseudo["packages"][0]["dependencies"].append(pseudo_value)
        try:
            validate_resolution_serialization(pseudo, resolution)
        except CandidateSerializationError:
            assertions += 1
        else:
            raise SystemExit(f"pseudo purl was accepted in formal dependencies: {pseudo_value}")

    missing_purl = json.loads(json.dumps(serialized))
    del missing_purl["packages"][0]["dependency_declarations"][1]["purl"]
    try:
        validate_resolution_serialization(missing_purl, resolution)
    except CandidateSerializationError:
        assertions += 1
    else:
        raise SystemExit("missing required purl:null was accepted")

    conflict = json.loads(json.dumps(serialized))
    conflict["packages"][0]["dependency_declarations"][1]["disposition"] = "INCLUDED"
    try:
        validate_resolution_serialization(conflict, resolution)
    except CandidateSerializationError:
        assertions += 1
    else:
        raise SystemExit("resolver/serializer disposition conflict was accepted")

    for disposition in ("REVIEW_REQUIRED", "UNKNOWN", "UNRESOLVED", "INVALID_INTERNAL_STATE"):
        unsupported_resolution = json.loads(json.dumps(resolution))
        unsupported_resolution["packages"][0]["dependency_declarations"][1][
            "disposition"
        ] = disposition
        try:
            serialize_candidate_from_resolution(candidate, unsupported_resolution)
        except CandidateSerializationError:
            assertions += 1
        else:
            raise SystemExit(f"unsupported resolver disposition was serialized: {disposition}")

    with tempfile.TemporaryDirectory(prefix="code-c-inventory-review-regression-") as directory:
        root = Path(directory)
        inputs = root / "inputs"
        write_target(inputs, "linux")
        write_target(inputs, "windows")
        output = root / "output"
        with contextlib.redirect_stdout(io.StringIO()):
            assemble(argparse.Namespace(input_root=inputs, output_root=output))
        bundle = json.loads(
            (output / "CODE_C_PYTHON_INVENTORY_REVIEW_BUNDLE.json").read_text(
                encoding="utf-8"
            )
        )
        if bundle["bundle_semantics"] != "BATCH_CONTAINER_ONLY":
            raise SystemExit("bundle semantics drift")
        assertions += 1
        requests = bundle["inventory_approval_requests"]
        if len(requests) != 4 or len({item["inventory_id"] for item in requests}) != 4:
            raise SystemExit("bundle did not preserve four independent inventory approvals")
        assertions += 1
        if any(item["approval_status"] != "PENDING_CODE_F_APPROVAL" for item in requests):
            raise SystemExit("Code C self-approved a candidate inventory")
        assertions += 1
        if bundle["artifact_containment"]["declared_total_run_budget_bytes"] > 25 * 1024 * 1024:
            raise SystemExit("inventory review workflow exceeds the declared Actions budget")
        assertions += 1

        mismatched = inputs / "artifact-windows" / "windows" / "target-report.json"
        value = json.loads(mismatched.read_text(encoding="utf-8"))
        value["code_c_head_sha"] = "f" * 40
        write_canonical_json(mismatched, value)
        try:
            assemble(
                argparse.Namespace(
                    input_root=inputs,
                    output_root=root / "mismatched-output",
                )
            )
        except SystemExit:
            assertions += 1
        else:
            raise SystemExit("cross-HEAD target reports were accepted")

    print(
        json.dumps(
            {
                "ACTUAL_TEST_ASSERTIONS_EXECUTED": "YES",
                "ASSERTION_COUNT": assertions,
                "BATCH_CONTAINER_ONLY": "PASS",
                "CROSS_HEAD_MISMATCH_FAIL_CLOSED": "PASS",
                "FOUR_ROLE_SCOPED_APPROVALS": "PASS",
                "INVENTORY_ONLY_ARTIFACT_BUDGET": "PASS",
                "NO_CODE_C_SELF_APPROVAL": "PASS",
                "RESOLVED_DEPENDENCY_PURL_SERIALIZATION": "PASS",
                "NOT_APPLICABLE_PURL_NULL": "PASS",
                "PSEUDO_PURL_FAIL_CLOSED": "PASS",
                "MISSING_PURL_FIELD_FAIL_CLOSED": "PASS",
                "RESOLUTION_STATE_CONFLICT_FAIL_CLOSED": "PASS",
                "UNKNOWN_DISPOSITION_FAIL_CLOSED": "PASS",
                "UNSAFE_ARCHIVE_MEMBER_FAIL_CLOSED": "PASS",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
