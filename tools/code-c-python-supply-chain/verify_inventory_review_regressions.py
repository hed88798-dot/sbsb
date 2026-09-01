from __future__ import annotations

import argparse
import contextlib
import io
import json
import tempfile
from pathlib import Path

from canonical_evidence import write_canonical_json
from prepare_inventory_review import assemble, safe_archive_member


HEAD = "a" * 40
BASELINE = "b" * 40
CONTAINMENT = "c" * 40


def target_report(target: str) -> dict[str, object]:
    return {
        "schema_version": "1",
        "status": "PASS",
        "code_c_head_sha": HEAD,
        "main_quality_baseline": BASELINE,
        "required_code_c_containment_sha": CONTAINMENT,
        "target": {
            "os": target,
            "descriptor_sha256": ("1" if target == "linux" else "2") * 64,
        },
        "cpython_artifact": {
            "distribution_sha256": ("3" if target == "linux" else "4") * 64,
        },
        "dependency_graph_set_sha256": ("5" if target == "linux" else "6") * 64,
        "inventory_drift": "PRESENT",
        "inventory_candidates": [
            {
                "inventory_id": f"code-c-{target}-{scope}-py31315",
                "candidate_sha256": character * 64,
                "role": role,
                "dependency_graph_identity_sha256": graph_character * 64,
            }
            for scope, role, character, graph_character in (
                ("runtime", "RUNTIME", "7", "8"),
                ("worker-build", "WORKER_BUILD", "9", "d"),
            )
        ],
    }


def write_target(root: Path, target: str) -> None:
    target_root = root / f"artifact-{target}" / target
    target_root.mkdir(parents=True)
    write_canonical_json(target_root / "target-report.json", target_report(target))
    write_canonical_json(
        target_root / "toolchain-intake-evidence.json",
        {"schema_version": "1", "target": target},
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
        if any(item["approval_status"] != "PENDING_CODE_F_REVIEW" for item in requests):
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
                "UNSAFE_ARCHIVE_MEMBER_FAIL_CLOSED": "PASS",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
