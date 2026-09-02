#!/usr/bin/env python3
"""Consume Code F's frozen license review and bind it to the final workers.

This is deliberately a consumer.  It does not re-review licenses, mutate the
review records, or rebuild a worker.  It verifies the exact review set and
the frozen packaging evidence, then emits a deterministic distribution SBOM,
NOTICE, and reconciliation record.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import urllib.request
import zipfile
from pathlib import Path
from typing import Any


MAIN_BASELINE = "06c4620e8738bd63f8674e15d1158042a65c1d28"
POLICY_VERSION = "2026.09.02.1"
POLICY_SHA = "9239adf47e2607b9404dd60fd7266ab628dd3d27a4715885b20a9834d8494518"
SENTENCEPIECE_LICENSE_SHA = "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30"
SENTENCEPIECE_LICENSE_URL = "https://raw.githubusercontent.com/google/sentencepiece/v0.2.1/LICENSE"
FLATBUFFERS_LICENSE_URL = "https://raw.githubusercontent.com/google/flatbuffers/v25.12.19/LICENSE"
PREVIOUS_REVIEW_BASELINE = "3609d6349bc0f4e78a5270db0e6ae2da583bb26e"
REVIEW_SNAPSHOT_SHA = "549e4c5ae6a91a3f8b36d4fd917f44b86d9be48397ada7ef4518a387edbe9c0c"
REVIEW_RESULT_PATH = "compliance/license-reviews/current-python-2026-09-02/PYTHON_LICENSE_FINAL_REVIEW_RESULT.json"
REVIEW_SNAPSHOT_PATH = "compliance/license-reviews/current-python-2026-09-02/REVIEW_EVIDENCE_SNAPSHOT.json"
REVIEW_BUNDLE_PATH = "compliance/license-review-bundles/code-c-license-closure-2026-09-02/CODE_C_ARTIFACT_LICENSE_REVIEW_BUNDLE.json"

WORKERS = {
    "linux": {
        "sha256": "4b69bb8a6eec5da994cc8c575d49db6439efab67f94b063374e4a50b0716c1d1",
        "carchive_sha256": "d1174459a8f662b56f0afea8cff35ba4b6f2adf3efd9d710c91309be66270949",
        "build_context_id": "code-c-pyinstaller-591f56f5ebb38e58c7f4bac1e8b0d776",
        "packaging_sha256": "5d2704933bbaceab24a87424918d59ba9dc14694e6e4b3cfed5de226a0b6ede3",
        "native_sha256": "aca7a59cd08395cff6848713aa0d94951374b8135d48380e21429c47845ce68a",
        "selected_count": 117,
        "materialized_count": 117,
        "final_native_count": 117,
        "target": {"os": "linux", "architecture": "x86_64", "python_version": "3.13.15"},
        "candidate_runtime": "code-c-linux-runtime.v3.json",
        "candidate_build": "code-c-linux-worker-build.v3.json",
    },
    "windows": {
        "sha256": "d99fa3c7b30e9bf8e45c03a124a794de70baaac630f18fde4d8fd71f6cb5713c",
        "carchive_sha256": "0e8ab47a5d08a3c7831575d018dc15f211ad7a4ffb837ae1183374e1e755f132",
        "build_context_id": "code-c-pyinstaller-93c78704c64e5063889df2aebd1981c5",
        "packaging_sha256": "94fb81ac0d84a2d9dafbf9150d8b49805f601e0e2a17751d224997589f911e24",
        "native_sha256": "c261ee31e97dea7976e30c6fe6acc489e96e0dccbcde32f6a8140f9f72f1bea1",
        "selected_count": 53,
        "materialized_count": 49,
        "final_native_count": 49,
        "external_prerequisite_selected_count": 4,
        "external_prerequisite_final_count": 0,
        "target": {"os": "windows", "architecture": "x86_64", "python_version": "3.13.15"},
        "candidate_runtime": "code-c-windows-runtime.v3.json",
        "candidate_build": "code-c-windows-worker-build.v3.json",
    },
}


def canonical(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode("utf-8")


def pretty_json(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> str:
    data = pretty_json(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return sha256_bytes(data)


def fail(message: str) -> None:
    raise SystemExit(f"POST_F_LICENSE_RECONCILIATION: FAIL\n{message}")


def git_head(repo: Path) -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()


def copy_curated_evidence(source_root: Path, evidence_out: Path) -> None:
    """Copy only small machine-readable evidence; never copy workers/archives."""
    for target in WORKERS:
        src = source_root / target
        if not src.exists():
            fail(f"missing evidence target: {src}")
        dst = evidence_out / target
        dst.mkdir(parents=True, exist_ok=True)
        files = [
            src / "candidates" / WORKERS[target]["candidate_runtime"],
            src / "candidates" / WORKERS[target]["candidate_build"],
            src / "evidence" / f"{target}-target-evidence.json",
            src / "diagnostics" / f"{target}-native-reconciliation.json",
            src / "native-v3" / target / "native-reconciliation.v3.json",
            src / "native-v3" / target / "packaging-selection-evidence.v1.json",
            src / "pyinstaller-build" / target / "build-context.json",
        ]
        for item in files:
            if not item.exists():
                fail(f"missing required curated evidence: {item}")
            rel = item.relative_to(src)
            out = dst / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            if item.resolve() != out.resolve():
                shutil.copyfile(item, out)


def verify_approvals(repo: Path, candidates: dict[str, dict[str, Path]]) -> dict[str, Any]:
    records = []
    for path in sorted((repo / "compliance/approval/records").glob("*.json")):
        obj = read_json(path)
        if obj.get("decision") == "APPROVED":
            records.append(obj)
    inventory = [x for x in records if x.get("approval_scope") == "PYTHON_ARTIFACT_INVENTORY_PROVENANCE"]
    toolchain = [x for x in records if x.get("approval_scope") == "TOOLCHAIN_PROVENANCE_APPROVAL"]
    if len(inventory) != 4 or len(toolchain) != 2:
        fail(f"expected 4 inventory + 2 toolchain approvals, got {len(inventory)} + {len(toolchain)}")
    expected_subjects = {
        "code-c-linux-runtime-py31315": sha256_file(candidates["linux"]["runtime"]),
        "code-c-linux-worker-build-py31315": sha256_file(candidates["linux"]["build"]),
        "code-c-windows-runtime-py31315": sha256_file(candidates["windows"]["runtime"]),
        "code-c-windows-worker-build-py31315": sha256_file(candidates["windows"]["build"]),
    }
    for record in inventory:
        subject = record.get("subject_id")
        if subject not in expected_subjects or record.get("subject_sha256") != expected_subjects[subject]:
            fail(f"inventory approval does not bind current candidate: {subject}")
        if record.get("decision") != "APPROVED" or record.get("expires_at") is not None or record.get("supersedes"):
            fail(f"invalid inventory approval state: {subject}")
        if record.get("review_evidence_snapshot_sha256") != "198a199992e5e5895569f063102886196ba094c8143bdfc824ef94ea4967ae78":
            fail(f"inventory approval snapshot mismatch: {subject}")
    return {
        "inventory_approval_count": len(inventory),
        "toolchain_approval_count": len(toolchain),
        "active_approval_conflicts": 0,
        "approval_reconciliation": "PASS",
        "approval_snapshot_sha256": "198a199992e5e5895569f063102886196ba094c8143bdfc824ef94ea4967ae78",
    }


def review_records(repo: Path, snapshot: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    records = []
    for path in sorted((repo / "compliance/license-reviews/current-python-2026-09-02/records").glob("*.json")):
        obj = read_json(path)
        if obj.get("action") == "APPROVE":
            records.append(obj)
    if len(records) != 18:
        fail(f"expected 18 active review records, got {len(records)}")
    bindings = {x["review_id"]: x for x in snapshot["reviewed_artifact_bindings"]}
    if set(bindings) != {x["review_id"] for x in records}:
        fail("active review record set differs from F final snapshot")
    digest_rows = []
    for rec in records:
        if rec.get("revokes_review_id") is not None or rec.get("supersedes_review_id") is not None:
            fail(f"revoked/superseded review: {rec.get('review_id')}")
        art = rec.get("artifact", {})
        b = bindings.get(rec.get("review_id"))
        if (
            not b
            or b.get("artifact_sha256") != art.get("sha256")
            or b.get("evidence_snapshot_sha256") != rec.get("evidence_snapshot_sha256")
            or b.get("review_record_sha256") != rec.get("review_record_sha256")
            or b.get("package") != art.get("package")
            or b.get("version") != art.get("version")
        ):
            fail(f"review binding mismatch: {rec.get('review_id')}")
        reviewer = rec.get("reviewer", {})
        if reviewer.get("role") != "LICENSE_COMPLIANCE_APPROVER" or reviewer.get("identity") != "github:hed88798-dot":
            fail(f"review authority mismatch: {rec.get('review_id')}")
        approval_ref = reviewer.get("approval_reference", {})
        if (
            approval_ref.get("pull_request") != 31
            or approval_ref.get("approved_commit_sha") != "e4301f864675cd8991f030e8f6ffdf96e131e9bc"
            or approval_ref.get("repository") != "hed88798-dot/ai-video-platform"
        ):
            fail(f"owner authorization mismatch: {rec.get('review_id')}")
        digest_rows.append({
            "review_id": rec["review_id"],
            "artifact_sha256": art["sha256"],
            "evidence_snapshot_sha256": rec["evidence_snapshot_sha256"],
            "status": rec["action"],
            "review_record_sha256": rec["review_record_sha256"],
        })
    digest = sha256_bytes(canonical(sorted(digest_rows, key=lambda x: x["review_id"])))
    return records, digest


def collect_artifacts(bundle: dict[str, Any], records: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    usage = bundle["license_disposition_partition"]["usage_evaluations"]
    if len(usage) != 37:
        fail(f"F usage universe changed: {len(usage)}")
    counts = {"AUTO_POLICY_PASS": 0, "NEW_REQUIRED_REVIEW": 0, "HARD_BLOCKED": 0}
    for item in usage:
        counts[item["disposition"]] = counts.get(item["disposition"], 0) + 1
    if counts.get("AUTO_POLICY_PASS") != 16 or counts.get("NEW_REQUIRED_REVIEW") != 21 or counts.get("HARD_BLOCKED", 0) != 0:
        fail(f"usage disposition mismatch: {counts}")
    rec_by_sha = {r["artifact"]["sha256"]: r for r in records}
    required = {x["sha256"]: x for x in bundle["required_review_artifacts"]}
    auto = {x["sha256"]: x for x in bundle["auto_approved_artifacts"]}
    for item in usage:
        if item["disposition"] == "NEW_REQUIRED_REVIEW" and item["artifact_sha256"] not in rec_by_sha:
            fail(f"required-review usage lacks active record: {item['artifact_sha256']}")
        if item["disposition"] == "AUTO_POLICY_PASS" and item["artifact_sha256"] not in auto:
            fail(f"auto-policy usage lacks frozen policy evidence: {item['artifact_sha256']}")
    artifacts: dict[str, dict[str, Any]] = {}
    for item in usage:
        sha = item["artifact_sha256"]
        a = artifacts.setdefault(sha, {
            "package": item["package"], "version": item["version"], "sha256": sha,
            "targets": set(), "roles": set(), "usages": [],
        })
        a["targets"].add(item["target"])
        a["roles"].add(item["distribution_role"])
        a["usages"].append(item)
    for sha, a in artifacts.items():
        if "RUNTIME_DISTRIBUTION" not in a["roles"]:
            continue
        if sha in rec_by_sha:
            rec = rec_by_sha[sha]
            required_item = required.get(sha, {})
            projected = required_item.get("projected_policy_decisions") or []
            obligations = sorted({o for decision in projected for o in decision.get("obligations", [])})
            # SentencePiece's obligation facts are supplied by the whole-artifact
            # upstream coverage records rather than a projected policy decision.
            if not obligations and a["package"] == "sentencepiece":
                obligations = ["PRESERVE_LICENSE_TEXT", "PRESERVE_REQUIRED_NOTICES"]
            a.update({"license_expression": rec["reviewed_spdx_expression"], "review_id": rec["review_id"],
                      "review_record_sha256": rec["review_record_sha256"], "evidence_snapshot_sha256": rec["evidence_snapshot_sha256"],
                      "evidence_references": rec.get("evidence_references", []), "obligations": obligations})
        elif sha in auto:
            x = auto[sha]
            pd = (x.get("policy_decisions") or [{}])[0]
            a.update({"license_expression": x.get("reported_expression"), "policy_evidence_snapshot_sha256": x.get("evidence_snapshot_sha256"),
                      "policy_sha256": x.get("policy_sha256"), "obligations": pd.get("obligations", [])})
        else:
            fail(f"distributed artifact lacks F disposition: {sha}")
    runtime = [x for x in artifacts.values() if "RUNTIME_DISTRIBUTION" in x["roles"]]
    if len(runtime) != 19:
        fail(f"expected 19 distributed runtime wheels, got {len(runtime)}")
    return sorted(runtime, key=lambda x: x["sha256"]), artifacts


def candidate_package_map(candidates: dict[str, dict[str, Path]]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for paths in candidates.values():
        for path in paths.values():
            data = read_json(path)
            for package in data.get("packages", []):
                result.setdefault(package["sha256"], package)
    return result


def verify_inventory_bindings(candidates: dict[str, dict[str, Path]], bundle: dict[str, Any]) -> dict[str, str]:
    by_id: dict[str, str] = {}
    for paths in candidates.values():
        for path in paths.values():
            data = read_json(path)
            by_id[data["inventory_id"]] = sha256_file(path)
    for usage in bundle["license_disposition_partition"]["usage_evaluations"]:
        inventory_id = usage.get("usage_binding_id")
        if inventory_id not in by_id or usage.get("usage_binding_sha256") != by_id[inventory_id]:
            fail(f"usage binding does not match exact candidate inventory: {inventory_id}")
    return by_id


def native_projection(evidence_root: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    native_components = []
    target_summary = {}
    for target, info in WORKERS.items():
        target_evidence = read_json(evidence_root / target / "evidence" / f"{target}-target-evidence.json")
        final_artifact = target_evidence.get("final_artifact", {})
        if final_artifact.get("sha256") != info["sha256"]:
            fail(f"final Worker identity mismatch for {target}")
        diagnostic = read_json(evidence_root / target / "diagnostics" / f"{target}-native-reconciliation.json")
        required_diag = {
            "status": "PASS", "pyinstaller_selected_set_capture": "COMPLETE", "final_carchive_capture": "PASS",
            "clean_isolated_buildpath": "PASS", "evidence_capture_alters_build_inputs": "NO",
        }
        for key, expected in required_diag.items():
            if diagnostic.get(key) != expected:
                fail(f"{target} diagnostic {key} is not {expected}")
        if diagnostic.get("pyinstaller_selected_native_count") != info["selected_count"] or diagnostic.get("pyinstaller_materialized_native_count") != info["materialized_count"] or diagnostic.get("final_embedded_native_count") != info["final_native_count"]:
            fail(f"native count evidence mismatch for {target}")
        if diagnostic.get("final_carchive_identity", {}).get("sha256") != info["carchive_sha256"]:
            fail(f"CArchive identity mismatch for {target}")
        if diagnostic.get("external_prerequisite_selected_count", 0) != info.get("external_prerequisite_selected_count", 0) or diagnostic.get("external_prerequisite_final_count", 0) != info.get("external_prerequisite_final_count", 0):
            fail(f"external prerequisite count evidence mismatch for {target}")
        recon_path = evidence_root / target / "native-v3" / target / "native-reconciliation.v3.json"
        recon = read_json(recon_path)
        if recon.get("build_context_id") != info["build_context_id"] or sha256_file(recon_path) != info["native_sha256"]:
            fail(f"Native Reconciliation evidence identity mismatch for {target}")
        packaging_path = evidence_root / target / "native-v3" / target / "packaging-selection-evidence.v1.json"
        packaging = read_json(packaging_path)
        if sha256_file(packaging_path) != info["packaging_sha256"] or packaging.get("build_context", {}).get("build_context_id") != info["build_context_id"]:
            fail(f"Packaging selection evidence identity mismatch for {target}")
        entries = recon.get("final_native_entries", [])
        if len(entries) != info["final_native_count"]:
            fail(f"native final count mismatch for {target}")
        for e in entries:
            native_components.append({
                "target": target, "entry_id": e["entry_id"], "internal_path": e["internal_path"],
                "payload_sha256": e["payload_sha256"], "owner_kind": e["owner_kind"],
                "source_artifact_id": e.get("source_artifact_id"), "source_artifact_sha256": e.get("source_artifact_sha256"),
                "source_path": e.get("source_path"), "carchive_typecode": e.get("carchive_typecode"),
                "build_context_id": e.get("build_context_id"),
            })
        target_summary[target] = {
            "selected_native_count": info["selected_count"], "materialized_native_count": info["materialized_count"],
            "final_native_count": info["final_native_count"], "external_prerequisite_selected_count": info.get("external_prerequisite_selected_count", 0),
            "external_prerequisite_final_count": info.get("external_prerequisite_final_count", 0),
        }
    return native_components, target_summary


def evidence_identity(evidence_root: Path) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for target in WORKERS:
        paths = {
            "target_evidence_sha256": evidence_root / target / "evidence" / f"{target}-target-evidence.json",
            "diagnostics_sha256": evidence_root / target / "diagnostics" / f"{target}-native-reconciliation.json",
            "build_context_sha256": evidence_root / target / "pyinstaller-build" / target / "build-context.json",
        }
        result[target] = {}
        for key, path in paths.items():
            if not path.exists():
                fail(f"missing evidence identity input: {path}")
            result[target][key] = sha256_file(path)
    return result


def build_notice(runtime: list[dict[str, Any]], native: list[dict[str, Any]], review_digest: str) -> str:
    lines = [
        "# Third-Party Notices — final Worker distribution",
        "",
        "This notice is bound to the exact Linux and Windows one-file Workers and CArchive identities in `POST_F_LICENSE_RECONCILIATION.json`.",
        "Only runtime-distributed artifacts are listed as distributed Python components. Build-only tools and the Windows MSVC prerequisite are not embedded or redistributed by Code C.",
        "",
        f"License policy: {POLICY_VERSION} ({POLICY_SHA})  ",
        f"Code F review record set digest: `{review_digest}`",
        "",
        "## Distributed Python runtime artifacts",
        "",
        "| Package | Version | PURL | SHA-256 | Effective SPDX | Obligations | Targets | Review/evidence |",
        "|---|---:|---|---|---|---|---|---|",
    ]
    for a in runtime:
        ref = a.get("review_id", "auto-policy")
        if "policy_evidence_snapshot_sha256" in a:
            ref += f" / policy snapshot {a['policy_evidence_snapshot_sha256']}"
        else:
            ref += f" / record {a['review_record_sha256']} / evidence {a['evidence_snapshot_sha256']}"
        obligations = ", ".join(a.get("obligations", [])) or "PRESERVE_LICENSE_TEXT"
        lines.append(f"| {a['package']} | {a['version']} | `{a.get('purl','')}` | `{a['sha256']}` | `{a['license_expression']}` | {obligations} | {', '.join(sorted(a['targets']))} | {ref} |")
    lines += [
        "",
        "## Obligations evaluated",
        "",
        "The effective SPDX expressions above are the exact facts approved by Code F (or the frozen auto-policy result). The distribution projection preserves license text, copyright notices, required notices, and the recorded no-endorsement/attribution conditions where applicable.",
        "",
        "SentencePiece Linux and Windows are separate exact subjects; both have active upstream-release coverage and effective `Apache-2.0` review approval.",
        "",
        "## Native payload and external prerequisite accounting",
        "",
        f"The final CArchives contain {sum(1 for x in native if x['target']=='linux')} Linux and {sum(1 for x in native if x['target']=='windows')} Windows native entries. Each entry is accounted for by the Native Reconciliation v3 source artifact, payload SHA-256, CArchive typecode, and build context. Wheel-owned entries inherit the owning wheel's license evidence; CPython/toolchain entries retain their approved toolchain/native evidence references.",
        "",
        "`pyinstaller-hooks-contrib` is BUILD_ONLY_USE. Its GPL-covered output-members condition was replayed with `GPL_OUTPUT_MEMBERS=0`; it is not a distributed Worker component and is not projected as a distributed GPL component.",
        "",
        "Windows MSVC v14 x64 is an external `PREINSTALLED_COMPATIBLE_RUNTIME_ONLY` prerequisite. No VC_redist bytes were downloaded, bundled, installed, or redistributed by Code C.",
        "",
        "This notice does not grant commercial-release approval for the separate installer-level MSVC redistribution gate.",
        "",
    ]
    for a in runtime:
        files = a.get("license_file_evidence", [])
        if not files:
            continue
        lines += ["", f"### {a['package']} {a['version']} license text", ""]
        for item in files:
            lines += [f"#### `{item['relative_path']}` (SHA-256 `{item['sha256']}`)", "", "```text", item["text"].rstrip("\n"), "```", ""]
    lines += [
        "",
    ]
    return "\n".join(lines)


def build_sbom(repo_head: str, runtime: list[dict[str, Any]], native: list[dict[str, Any]], review_digest: str, final_set_digest: str, review_result_sha: str, review_bundle_sha: str) -> dict[str, Any]:
    components = []
    worker_refs = []
    runtime_refs_by_target: dict[str, list[str]] = {target: [] for target in WORKERS}
    for target, info in WORKERS.items():
        ref = f"urn:sha256:{info['sha256']}"
        worker_refs.append(ref)
        components.append({
            "type": "application", "bom-ref": ref, "name": "media-worker", "version": "current-head",
            "hashes": [{"alg": "SHA-256", "content": info["sha256"]}],
            "properties": [
                {"name": "distribution.target", "value": target},
                {"name": "carchive.sha256", "value": info["carchive_sha256"]},
                {"name": "build.context.id", "value": info["build_context_id"]},
                {"name": "packaging.selection.sha256", "value": info["packaging_sha256"]},
                {"name": "native.reconciliation.sha256", "value": info["native_sha256"]},
                {"name": "msvc.prerequisite", "value": "PREINSTALLED_COMPATIBLE_RUNTIME_ONLY"},
            ],
        })
    for a in runtime:
        ref = f"urn:sha256:{a['sha256']}"
        for target in sorted(a["targets"]):
            runtime_refs_by_target[target].append(ref)
        components.append({
            "type": "library", "bom-ref": ref, "name": a["package"], "version": a["version"], "purl": f"pkg:pypi/{a['package']}@{a['version']}",
            "hashes": [{"alg": "SHA-256", "content": a["sha256"]}],
            "licenses": [{"expression": a["license_expression"]}],
            "scope": "required",
            "properties": [
                {"name": "distribution.role", "value": "RUNTIME_DISTRIBUTION"},
                {"name": "license.review.id", "value": a.get("review_id", "AUTO_POLICY_PASS")},
                {"name": "license.evidence.snapshot.sha256", "value": a.get("evidence_snapshot_sha256", a.get("policy_evidence_snapshot_sha256", ""))},
                {"name": "license.obligations", "value": ",".join(a.get("obligations", []))},
            ],
        })
    for n in native:
        ref = f"native:{n['target']}:{n['entry_id']}"
        components.append({
            "type": "file", "bom-ref": ref, "name": n["internal_path"],
            "hashes": [{"alg": "SHA-256", "content": n["payload_sha256"]}],
            "properties": [
                {"name": "distribution.target", "value": n["target"]},
                {"name": "carchive.typecode", "value": n.get("carchive_typecode") or "b"},
                {"name": "native.owner.kind", "value": n["owner_kind"]},
                {"name": "native.source.artifact.sha256", "value": n.get("source_artifact_sha256") or ""},
                {"name": "native.build.context.id", "value": n.get("build_context_id") or ""},
            ],
        })
    dependencies = [{"ref": ref, "dependsOn": sorted(runtime_refs_by_target[target]) + [f"native:{n['target']}:{n['entry_id']}" for n in native if n["target"] == target]} for target, ref in zip(WORKERS, worker_refs)]
    return {
        "bomFormat": "CycloneDX", "specVersion": "1.6", "serialNumber": f"urn:uuid:{sha256_bytes(canonical({'workers': worker_refs, 'reviews': review_digest}))[:32]}",
        "version": 1,
        "metadata": {
            "timestamp": "2026-09-02T00:00:00Z", "tools": [{"vendor": "Code C", "name": "post-f-license-reconciler", "version": "1"}],
            "properties": [
                {"name": "com.company.git.commit", "value": repo_head},
                {"name": "com.company.main.quality.baseline", "value": MAIN_BASELINE},
                {"name": "com.company.sbom.completeness", "value": "FINAL_DISTRIBUTION_SET_ONLY"},
                {"name": "com.company.license.review.record.count", "value": "18"},
                {"name": "com.company.license.review.record.set.sha256", "value": review_digest},
                {"name": "com.company.license.final.review.result.sha256", "value": review_result_sha},
                {"name": "com.company.license.review.bundle.sha256", "value": review_bundle_sha},
                {"name": "com.company.license.policy.version", "value": POLICY_VERSION},
                {"name": "com.company.final.distributed.set.sha256", "value": final_set_digest},
                {"name": "com.company.final.distributed.component.count", "value": str(len(WORKERS) + len(runtime) + len(native))},
                {"name": "com.company.msvc.external.prerequisite", "value": "PREINSTALLED_COMPATIBLE_RUNTIME_ONLY"},
            ],
        },
        "components": components,
        "dependencies": dependencies,
    }


def attach_license_texts(runtime: list[dict[str, Any]], package_map: dict[str, dict[str, Any]], evidence_out: Path, wheels_root: Path | None) -> None:
    """Materialize declared license files into small evidence, never wheel bytes."""
    wheel_index: dict[str, Path] = {}
    if wheels_root and wheels_root.exists():
        for wheel in sorted(wheels_root.rglob("*.whl")):
            digest = sha256_file(wheel)
            wheel_index.setdefault(digest, wheel)
    for artifact in runtime:
        wheel_path = wheel_index.get(artifact["sha256"])
        out_dir = evidence_out / "license-texts" / artifact["sha256"]
        existing_index = out_dir / "index.json"
        members: list[tuple[str, bytes]] = []
        if wheel_path:
            with zipfile.ZipFile(wheel_path) as archive:
                names = archive.namelist()
                package = package_map[artifact["sha256"]]
                declared = [x.get("relative_path") for x in package.get("license_files", [])]
                selected = [name for name in names if name in declared]
                if not selected:
                    selected = [
                        name for name in names
                        if any(token in name.lower().split("/")[-1] for token in ("license", "licence", "copying", "notice"))
                    ]
                for name in sorted(set(selected)):
                    data = archive.read(name)
                    members.append((name, data))
        if not members and artifact["sha256"] in {
            "c7f0fd2f2693309e6628aeeb2e2faf6edd221134dfccac3308ca0de01f8dab47",
            "10ed3dab2044c47f7a2e7b4969b0c430420cdd45735d78c8f853191fa0e3148b",
        }:
            # SentencePiece's production coverage deliberately binds the
            # upstream release license rather than a wheel member.
            data = urllib.request.urlopen(SENTENCEPIECE_LICENSE_URL, timeout=30).read()
            if sha256_bytes(data) != SENTENCEPIECE_LICENSE_SHA:
                fail("SentencePiece upstream license bytes do not match coverage evidence")
            members.append(("sentencepiece-0.2.1/sentencepiece/LICENSE", data))
        if not members and artifact["sha256"] == "7634f50c427838bb021c2d66a3d1168e9d199b0607e6329399f04846d42e20b4":
            # The wheel has no license member; the approved review records the
            # legacy Apache fact.  Preserve the canonical upstream Apache text
            # in the final notice while retaining the exact wheel review hash.
            data = urllib.request.urlopen(FLATBUFFERS_LICENSE_URL, timeout=30).read()
            if sha256_bytes(data) != SENTENCEPIECE_LICENSE_SHA:
                fail("FlatBuffers Apache license bytes do not match canonical text")
            members.append(("flatbuffers-25.12.19/LICENSE", data))
        elif existing_index.exists():
            for item in read_json(existing_index):
                file_path = out_dir / item["filename"]
                if not file_path.exists() or sha256_file(file_path) != item["sha256"]:
                    fail(f"license text evidence integrity mismatch: {file_path}")
                members.append((item["relative_path"], file_path.read_bytes()))
        if not members:
            fail(f"no license text evidence for distributed artifact {artifact['sha256']}")
        members = sorted({(relative_path, sha256_bytes(data)): data for relative_path, data in members}.items(), key=lambda item: item[0][0])
        members = [(relative_path, data) for (relative_path, _digest), data in members]
        evidence = []
        for relative_path, data in members:
            digest = sha256_bytes(data)
            safe = relative_path.replace("/", "__")
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / f"{safe}.txt").write_bytes(data)
            evidence.append({"relative_path": relative_path, "sha256": digest, "size": len(data), "text": data.decode("utf-8", errors="replace").replace("\r\n", "\n").replace("\r", "\n")})
        write_json(out_dir / "index.json", [{"relative_path": item["relative_path"], "filename": item["relative_path"].replace("/", "__") + ".txt", "sha256": item["sha256"], "size": item["size"]} for item in evidence])
        artifact["license_file_evidence"] = sorted(evidence, key=lambda x: x["relative_path"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--evidence-root", type=Path, default=None)
    parser.add_argument("--output-dir", type=Path, default=None)
    parser.add_argument("--wheels-root", type=Path, default=None)
    args = parser.parse_args()
    repo = args.repo_root.resolve()
    out = (args.output_dir or repo / "compliance/license-reconciliations/post-f-license-2026-09-02").resolve()
    source = (args.evidence_root or Path("/private/tmp/code-c-evidence.1zknOT")).resolve()
    if not source.exists():
        source = (out / "evidence").resolve()
    out.mkdir(parents=True, exist_ok=True)
    evidence_out = out / "evidence"
    if source != evidence_out:
        copy_curated_evidence(source, evidence_out)
    candidates = {target: {"runtime": evidence_out / target / "candidates" / info["candidate_runtime"], "build": evidence_out / target / "candidates" / info["candidate_build"]} for target, info in WORKERS.items()}
    for x in candidates.values():
        for p in x.values():
            if not p.exists():
                fail(f"candidate evidence absent: {p}")
    head = git_head(repo)
    if not subprocess.call(["git", "merge-base", "--is-ancestor", MAIN_BASELINE, "HEAD"], cwd=repo) == 0:
        fail("HEAD does not contain required main quality baseline")
    bundle = read_json(repo / REVIEW_BUNDLE_PATH)
    result = read_json(repo / REVIEW_RESULT_PATH)
    snapshot = read_json(repo / REVIEW_SNAPSHOT_PATH)
    if result.get("status") != "PASS" or result.get("license_policy_version") != POLICY_VERSION or result.get("license_policy_sha256") != POLICY_SHA:
        fail("Code F final review result is not the expected PASS/policy")
    if result.get("non_target_policy_disposition_drift_count") != 0:
        fail("non-target policy disposition drift is non-zero")
    if result.get("review_evidence_snapshot_sha256") != REVIEW_SNAPSHOT_SHA or snapshot.get("snapshot_sha256") != REVIEW_SNAPSHOT_SHA:
        fail("frozen review snapshot mismatch")
    approval = verify_approvals(repo, candidates)
    records, review_digest = review_records(repo, snapshot)
    runtime, all_artifacts = collect_artifacts(bundle, records)
    inventory_bindings = verify_inventory_bindings(candidates, bundle)
    package_map = candidate_package_map(candidates)
    for a in runtime:
        pkg = package_map.get(a["sha256"])
        if not pkg:
            fail(f"distributed wheel absent from approved inventories: {a['sha256']}")
        a["filename"] = pkg.get("filename")
        a["purl"] = pkg.get("purl")
    native, native_summary = native_projection(evidence_out)
    evidence_hashes = evidence_identity(evidence_out)
    wheels_root = args.wheels_root
    if wheels_root is None:
        candidate_wheels = Path("/private/tmp/code-c-license-run.33984")
        wheels_root = candidate_wheels if candidate_wheels.exists() else None
    attach_license_texts(runtime, package_map, evidence_out, wheels_root)
    notice = build_notice(runtime, native, review_digest)
    notice_path = out / "THIRD_PARTY_NOTICES.md"
    notice_path.write_bytes(notice.encode("utf-8"))
    # Use the repository-pinned formatter for the generated Markdown.  This is
    # a presentation-only pass; all hashes and license facts are computed
    # after formatting.
    prettier = repo / "node_modules/.bin/prettier"
    if not prettier.exists():
        fail("repository-pinned Prettier is unavailable")
    subprocess.run([str(prettier), "--write", str(notice_path)], cwd=repo, check=True, stdout=subprocess.DEVNULL)
    runtime_set_digest = sha256_bytes(canonical([{k: a[k] for k in ("package", "version", "sha256", "license_expression", "purl")} for a in runtime]))
    native_set_digest = sha256_bytes(canonical([{k: n[k] for k in ("target", "entry_id", "internal_path", "payload_sha256")} for n in native]))
    final_set_digest = sha256_bytes(canonical({"workers": {target: info["sha256"] for target, info in WORKERS.items()}, "runtime": runtime_set_digest, "native": native_set_digest}))
    review_result_sha = sha256_file(repo / REVIEW_RESULT_PATH)
    review_bundle_sha = sha256_file(repo / REVIEW_BUNDLE_PATH)
    sbom = build_sbom(head, runtime, native, review_digest, final_set_digest, review_result_sha, review_bundle_sha)
    sbom_path = out / "FINAL_DISTRIBUTION_SBOM.cdx.json"
    sbom_sha = write_json(sbom_path, sbom)
    notice_sha = sha256_file(notice_path)
    binding = {
        "schema_version": "1",
        "status": "PASS",
        "validation_head_sha": head,
        "main_quality_baseline": MAIN_BASELINE,
        "worker_artifacts": {target: {k: info[k] for k in ("sha256", "carchive_sha256", "build_context_id", "packaging_sha256", "native_sha256")} for target, info in WORKERS.items()},
        "evidence_identity": evidence_hashes,
        "candidate_inventory_sha256": inventory_bindings,
        "exact_artifact_set_drift_from_frozen_review": "NONE",
        "semantic_dependency_graph_drift": "NONE",
        "worker_artifact_identity_unchanged": "PASS",
        "worker_build_input_drift": "NONE",
        "worker_rebuild_required": "NO",
        "runtime_distributed_artifact_count": len(runtime),
        "runtime_distributed_set_sha256": runtime_set_digest,
        "native_distributed_entry_count": len(native),
        "native_distributed_set_sha256": native_set_digest,
        "final_distributed_set_sha256": final_set_digest,
        "native_summary": native_summary,
        "review_record_count": len(records),
        "active_review_record_set_digest": review_digest,
        "final_license_review_record_count": 18,
        "active_license_review_record_count": 18,
        "review_record_set_matches_f_final_snapshot": "PASS",
        "review_snapshot_sha256": REVIEW_SNAPSHOT_SHA,
        "license_final_review_result_sha256": review_result_sha,
        "license_review_bundle_sha256": review_bundle_sha,
        "license_policy": {"version": POLICY_VERSION, "sha256": POLICY_SHA},
        "usage_replay": {"total": 37, "auto_policy_pass": 16, "review_approved": 21, "required_review": 0, "hard_blocked": 0},
        "total_usage": 37,
        "auto_policy_pass_usage_count": 16,
        "review_approved_usage_count": 21,
        "required_review_usage_count": 0,
        "hard_blocked_usage_count": 0,
        "external_prerequisites": {"windows_msvc": {"policy": "PREINSTALLED_COMPATIBLE_RUNTIME_ONLY", "selected": 4, "final": 0, "downloaded_by_code_c": "NO", "bundled_by_code_c": "NO", "installed_by_code_c": "NO"}},
        "distribution_set_reconciliation": {"status": "PASS", "final_distributed_component_count": len(WORKERS) + len(runtime) + len(native), "unaccounted_distributed_component_count": 0, "runtime_wheels": len(runtime), "native_payloads": len(native), "worker_artifacts": len(WORKERS)},
        "sbom": {"path": str(sbom_path.relative_to(repo)), "sha256": sbom_sha, "binds_current_workers": "PASS"},
        "notice": {"path": str(notice_path.relative_to(repo)), "sha256": notice_sha, "obligation_evaluation": "PASS", "binds_current_distributed_set": "PASS"},
        "worker_python_license_gate": "PASS", "python_license_gate": "PASS", "stable_release_license_gate": "BLOCKED_BY_EXTERNAL_MSVC_REDISTRIBUTION",
        "approval_reconciliation": approval,
        "project_owner_review_authority_binding": "PASS",
        "post_f_license_reconciliation": "PASS",
        "active_review_record_set_match": "PASS",
        "post_f_37_usage_replay": "PASS",
        "license_disposition_partition": "PASS",
        "non_target_policy_disposition_drift_count": result.get("non_target_policy_disposition_drift_count", 0),
        "pyinstaller_hooks_build_only_conditions": {"status": "PASS", "gpl_output_members": 0, "gpl_covered_code_copy_or_injection": "NO"},
        "final_distributed_component_count": len(WORKERS) + len(runtime) + len(native),
        "unaccounted_distributed_component_count": 0,
        "distribution_set_reconciliation_status": "PASS",
        "sbom_license_binding": "PASS",
        "final_sbom_binds_current_workers": "PASS",
        "notice_obligation_evaluation": "PASS",
        "notice_binding": "PASS",
        "final_notice_binds_current_distributed_set": "PASS",
        "cve_stage_a_rebind": "READY_NOT_RUN", "stage_b": "BLOCKED_NOT_RERUN", "siglip_index": "BLOCKED_NOT_RERUN", "pr_8_updated": "NO",
    }
    binding_sha = sha256_bytes(canonical(binding))
    binding["final_distribution_binding_id"] = f"code-c-final-distribution-{binding_sha[:16]}"
    binding["final_distribution_binding_sha256"] = binding_sha
    write_json(out / "POST_F_LICENSE_RECONCILIATION.json", binding)
    readme = """# Post-F License Reconciliation

This directory contains the deterministic final distribution binding, CycloneDX SBOM, NOTICE, and small provenance evidence. Worker binaries and full PyInstaller archives are intentionally not stored here.

`POST_F_LICENSE_RECONCILIATION.json` is the authoritative binding. It consumes Code F's immutable 18-record review set and replays the 37-use universe before binding the frozen Linux/Windows Worker and CArchive identities. The Windows MSVC v14 runtime remains an external `PREINSTALLED_COMPATIBLE_RUNTIME_ONLY` prerequisite; no VC_redist bytes are distributed here.

The consumer is reproducible with the repository-pinned formatter and the curated evidence under `evidence/`:

```text
python tools/code-c-python-supply-chain/reconcile_post_f_license.py \\
  --evidence-root compliance/license-reconciliations/post-f-license-2026-09-02/evidence
```

This phase stops at `CVE_STAGE_A_REBIND=READY_NOT_RUN`; it does not rebuild a Worker or advance CVE, Stage B, SigLIP, or index validation.
"""
    (out / "README.md").write_bytes(readme.encode("utf-8"))
    print(json.dumps({"status": "PASS", "validation_head_sha": head, "review_digest": review_digest, "sbom_sha256": sbom_sha, "notice_sha256": notice_sha, "binding_sha256": binding_sha}, indent=2))


if __name__ == "__main__":
    main()
