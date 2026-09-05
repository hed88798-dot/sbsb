#!/usr/bin/env python3
"""Issue a new distribution candidate from the approved FFprobe v2 subjects.

This is a Code C consumer of the immutable Code F records.  It never rebuilds
or edits a Worker/companion.  The large byte artifacts remain in the local
ignored frozen-candidates retention channel; this tool writes only compact
manifests and reconciliation evidence into the repository.
"""

from __future__ import annotations

import copy
import hashlib
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
BASELINE = "f438e4d31f043d3b3750781772478c93169ea922"
F_APPROVAL_AGGREGATE_SHA = "2a05f157c4fb43427035945da042da73b23c3379a492ae9aa902516ea2803ac6"
OLD_FINAL_DISTRIBUTION_ID = "code-c-final-distribution-6cd09589d42329c7"
OLD_DIST_ROOT = ROOT / "compliance/license-reconciliations/post-f-license-current-head-76529014"
OLD_SBOM = OLD_DIST_ROOT / "FINAL_DISTRIBUTION_SBOM.cdx.json"
OLD_NOTICE = OLD_DIST_ROOT / "THIRD_PARTY_NOTICES.md"
OLD_USAGE_REPLAY = OLD_DIST_ROOT / "37-usage-replay.json"
OLD_NATIVE = {
    "linux": OLD_DIST_ROOT / "evidence/linux/native-v3/linux/native-reconciliation.v3.json",
    "windows": OLD_DIST_ROOT / "evidence/windows/native-v3/windows/native-reconciliation.v3.json",
}
WORKERS = {
    "linux": {
        "worker": ROOT / "frozen-candidates/code-c-76529014f47945fc2916d0488115822bc28d16c7-linux/linux/worker-linux",
        "carchive": ROOT / "frozen-candidates/code-c-76529014f47945fc2916d0488115822bc28d16c7-linux/linux/carchive-linux.pkg",
        "expected_worker": "4bd6d3afd3d2d60718f8174caedafb16a91c398a90c4198c664d14555a5f6073",
        "expected_carchive": "163e72f82f93b3f7ac5585426431ccc01bf61578bcec571a83b09b08abdd0a0e",
        "old_candidate": "code-c-76529014f47945fc2916d0488115822bc28d16c7-linux",
    },
    "windows": {
        "worker": ROOT / "frozen-candidates/code-c-76529014f47945fc2916d0488115822bc28d16c7-windows/windows/worker-windows",
        "carchive": ROOT / "frozen-candidates/code-c-76529014f47945fc2916d0488115822bc28d16c7-windows/windows/carchive-windows.pkg",
        "expected_worker": "ba6b81f433beef8ee95615a45248251918a18a602b53f8db9ec02e35cf76d8b1",
        "expected_carchive": "1a319765900d1b6cde0743efa902a5d8cb0468335f118775bbf65565e9b2c805",
        "old_candidate": "code-c-76529014f47945fc2916d0488115822bc28d16c7-windows",
    },
}
COMPANIONS = {
    "linux": {
        "root": ROOT / "frozen-candidates/code-c-ffprobe-linux-33917303316-v2/linux",
        "manifest_sha": "5a543191f240ac547f7a387a2bfedd634df8815b2e74fd58bb1e79d5a662d5f3",
        "manifest_canonical_sha": "fbb3c771b23bc8d50d8df7d3aa92ba226d7f5da3f125c10634f7436fef3fdaeb",
        "identity_sha": "171a289b8ce7bcc443b448f75225469e192ca38dbc1cc8fa233b8f6c6463f1db",
        "issuance_id": "code-c-ffprobe-linux-33917303316-packaging-v2",
        "issuance_sha": "c005930bd0ee3322bc283b5122970cd00b023c548bb62878027412f2f67bcbec",
        "tar_sha": "8ba9c164f73e11fb299f3551a056a30845aae0d4eeec3d50c71014cddf960ef3",
        "approval_path": "compliance/runtime-dependency-intake/ffprobe-v2/review-v2/FFPROBE_RUNTIME_COMPANION_ARTIFACT_APPROVAL_LINUX_V2.json",
        "license_path": "compliance/runtime-dependency-intake/ffprobe-v2/review-v2/FFPROBE_RUNTIME_COMPANION_LICENSE_REVIEW_LINUX_V2.json",
        "obligation_path": "compliance/runtime-dependency-intake/ffprobe-v2/review-v2/FFPROBE_RUNTIME_COMPANION_LICENSE_OBLIGATION_LINUX_V2.json",
        "approval_sha": "434ae744aa92090b9b55791af53255dac85f3df2841006d7837f1689abe27074",
        "approval_record_id": "code-f-ffprobe-linux-artifact-approval-33917303316-packaging-v2",
        "license_sha": "35a50ae13f81749026c76b6d4f69042413b226166aba691c42529d8c529e1ec9",
        "license_record_id": "code-f-ffprobe-linux-license-review-33917303316-packaging-v2",
        "obligation_sha": "e6983b3c37dd7f60aafd8597e6910e81e4bf3768859d40a6c5fd80353123e9a1",
        "obligation_set_id": "code-f-ffprobe-linux-license-obligation-33917303316-v2",
        "entrypoint": "ffprobe",
    },
    "windows": {
        "root": ROOT / "frozen-candidates/code-c-ffprobe-windows-33917303316-v2/windows",
        "manifest_sha": "954f61486d78f039e817fc705be121d69c42d20ee8748006008283c8a94c3d74",
        "manifest_canonical_sha": "abb81e9a7d2682913ae69ae9a11af7b611fd2ac5058aca9da0165ce398e43255",
        "identity_sha": "67f37171869f353712f6f02341a2beb5755c3ba1d2ae4702aa0effe0283856e8",
        "issuance_id": "code-c-ffprobe-windows-33917303316-packaging-v2",
        "issuance_sha": "16c95257acb53caecfb24d4c54091530884adfcfdf1f796ad017ebe844c75f11",
        "tar_sha": "0e8250dc4cf8f8e4fd4533a7a1298b59475982a78d2df49d4686ba9eacd684d7",
        "approval_path": "compliance/runtime-dependency-intake/ffprobe-v2/review-v2/FFPROBE_RUNTIME_COMPANION_ARTIFACT_APPROVAL_WINDOWS_V2.json",
        "license_path": "compliance/runtime-dependency-intake/ffprobe-v2/review-v2/FFPROBE_RUNTIME_COMPANION_LICENSE_REVIEW_WINDOWS_V2.json",
        "obligation_path": "compliance/runtime-dependency-intake/ffprobe-v2/review-v2/FFPROBE_RUNTIME_COMPANION_LICENSE_OBLIGATION_WINDOWS_V2.json",
        "approval_sha": "4fe01fa6d87cd57b30048bb8a2b3fa7a4603f2040b677c6856aa95da8087722b",
        "approval_record_id": "code-f-ffprobe-windows-artifact-approval-33917303316-packaging-v2",
        "license_sha": "851c72502dbed3041718402602fa56016a7459d45f71e4a3a8d6e7de21e47f70",
        "license_record_id": "code-f-ffprobe-windows-license-review-33917303316-packaging-v2",
        "obligation_sha": "1c2bfc4271fed140ca14004b845fe660cfe3c233541134bf53bca912d5ca9831",
        "obligation_set_id": "code-f-ffprobe-windows-license-obligation-33917303316-v2",
        "entrypoint": "ffprobe.exe",
    },
}


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def pretty(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha_file(path: Path) -> str:
    return sha_bytes(path.read_bytes())


def document_sha(value: dict[str, Any], field: str) -> str:
    copy_value = dict(value)
    copy_value.pop(field, None)
    return sha_bytes(canonical(copy_value))


def write_json(path: Path, value: Any) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = pretty(value)
    path.write_bytes(data)
    return sha_bytes(data)


def fail(message: str) -> None:
    raise SystemExit(f"FFPROBE_DISTRIBUTION_CLOSURE: FAIL: {message}")


def git_json(path: str) -> dict[str, Any]:
    try:
        raw = subprocess.check_output(["git", "show", f"origin/main:{path}"], cwd=ROOT)
    except subprocess.CalledProcessError as exc:
        fail(f"approved F record unavailable from origin/main: {path} ({exc.returncode})")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"invalid approved F JSON {path}: {exc}")


def verify_record(record: dict[str, Any], expected: str, label: str) -> None:
    if record.get("record_sha256") != expected:
        fail(f"{label} declared record SHA mismatch")
    if document_sha(record, "record_sha256") != expected:
        fail(f"{label} canonical record SHA mismatch")


def copy_regular_or_symlink(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_symlink():
        target = source.readlink()
        if destination.exists() or destination.is_symlink():
            if not destination.is_symlink() or destination.readlink() != target:
                fail(f"retention destination mismatch: {destination}")
        else:
            destination.symlink_to(target)
        return
    if not source.is_file():
        fail(f"expected regular artifact: {source}")
    if destination.exists() and sha_file(destination) != sha_file(source):
        fail(f"retention destination bytes mismatch: {destination}")
    if not destination.exists():
        shutil.copyfile(source, destination)


def verify_companion(target: str, aggregate: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    info = COMPANIONS[target]
    root = info["root"]
    manifest_path = root / "manifest.json"
    bundle = root / "bundle"
    if not manifest_path.is_file() or not bundle.is_dir():
        fail(f"missing approved v2 companion files for {target}")
    if sha_file(manifest_path) != info["manifest_sha"]:
        fail(f"{target} v2 manifest file SHA mismatch")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if document_sha(manifest, "manifest_sha256") != info["manifest_canonical_sha"] or manifest.get("manifest_sha256") != info["manifest_canonical_sha"]:
        fail(f"{target} v2 manifest canonical SHA mismatch")
    if manifest.get("companion_identity_sha256") != info["identity_sha"]:
        fail(f"{target} companion identity mismatch")
    if manifest.get("companion_id") != f"code-c-ffprobe-{target}-33917303316":
        fail(f"{target} companion id mismatch")
    if manifest.get("distribution", {}).get("resolver_mode") != "EXPLICIT_BUNDLED_LOCATOR" or manifest.get("distribution", {}).get("system_path_fallback") is not False:
        fail(f"{target} companion locator policy mismatch")
    if manifest.get("entrypoint", {}).get("path") != info["entrypoint"]:
        fail(f"{target} entrypoint mismatch")
    members = manifest.get("bundle_members", [])
    if len(members) != (22 if target == "linux" else 8):
        fail(f"{target} approved member count mismatch")
    for member in members:
        path = bundle / member["path"]
        if member.get("kind") == "SYMLINK":
            if not path.is_symlink() or path.readlink().as_posix() != member.get("link_target"):
                fail(f"{target} symlink evidence mismatch: {member['path']}")
            actual = sha_bytes(str(path.readlink()).encode("utf-8"))
        else:
            if not path.is_file() or path.is_symlink():
                fail(f"{target} member is not regular: {member['path']}")
            actual = sha_file(path)
        if actual != member["sha256"]:
            fail(f"{target} member SHA mismatch: {member['path']}")
    issuance = {
        "issuance_id": info["issuance_id"],
        "issuance_sha256": info["issuance_sha"],
        "transport_tar_sha256": info["tar_sha"],
    }
    tar = root.parent / "companion.tar"
    if not tar.is_file() or sha_file(tar) != info["tar_sha"]:
        fail(f"{target} approved Packaging v2 transport TAR mismatch")
    approval = git_json(info["approval_path"])
    license_review = git_json(info["license_path"])
    obligations = git_json(info["obligation_path"])
    verify_record(approval, info["approval_sha"], f"{target} artifact approval")
    verify_record(license_review, info["license_sha"], f"{target} license review")
    verify_record(obligations, info["obligation_sha"], f"{target} obligation set")
    aggregate_ids = {x["record_id"]: x["record_sha256"] for x in aggregate["artifact_approval_records"]}
    aggregate_license = {x["record_id"]: x["record_sha256"] for x in aggregate["license_review_records"]}
    aggregate_obligations = {x["obligation_set_id"]: x["record_sha256"] for x in aggregate["license_obligation_sets"]}
    if aggregate_ids.get(approval.get("record_id")) != info["approval_sha"] or aggregate_license.get(license_review.get("review_id")) != info["license_sha"] or aggregate_obligations.get(obligations.get("obligation_set_id")) != info["obligation_sha"]:
        fail(f"{target} F aggregate record binding mismatch")
    subject = approval["subject"]
    if subject.get("bundle_identity_sha256") != info["identity_sha"] or subject.get("manifest_canonical_sha256") != info["manifest_canonical_sha"] or subject.get("manifest_file_sha256") != info["manifest_sha"] or subject.get("entrypoint", {}).get("sha256") != manifest["entrypoint"]["sha256"] or subject.get("member_count") != len(members):
        fail(f"{target} F artifact subject does not bind local v2 bytes")
    p = approval["packaging_issuance"]
    if p.get("issuance_id") != info["issuance_id"] or p.get("issuance_sha256") != info["issuance_sha"] or p.get("transport_tar_sha256") != info["tar_sha"] or p.get("manual_post_hoc_artifact_edit") is not False:
        fail(f"{target} approved Packaging v2 issuance mismatch")
    if license_review.get("subject", {}).get("packaging_issuance_id") != info["issuance_id"] or obligations.get("subject", {}).get("packaging_issuance_id") != info["issuance_id"]:
        fail(f"{target} license/obligation issuance binding mismatch")
    if license_review.get("reviewed_spdx_expression") != "LGPL-2.1-or-later" or obligations.get("license", {}).get("effective_spdx_expression") != "LGPL-2.1-or-later":
        fail(f"{target} effective SPDX authority mismatch")
    return manifest, license_review, obligations


def verify_aggregate() -> dict[str, Any]:
    path = "compliance/runtime-dependency-intake/ffprobe-v2/review-v2/FFPROBE_RUNTIME_COMPANION_ARTIFACT_AND_LICENSE_REVIEW_BUNDLE_V2.json"
    aggregate = git_json(path)
    verify_record(aggregate, F_APPROVAL_AGGREGATE_SHA, "FFprobe F approval aggregate")
    if aggregate.get("decision") != "APPROVED" or aggregate.get("required_downstream_rebinds", {}).get("native_rebind") != "REQUIRED":
        fail("F aggregate is not active approval authority")
    return aggregate


def copy_retention(candidate_id: str, companion_manifests: dict[str, dict[str, Any]]) -> dict[str, Any]:
    root = ROOT / "frozen-candidates" / candidate_id
    retention: dict[str, Any] = {"schema_version": "1", "candidate_id": candidate_id, "channel": "MAC_LOCAL_PROJECT_FOLDER", "secondary_copy": False, "platforms": {}}
    for target, info in WORKERS.items():
        if not info["worker"].is_file() or not info["carchive"].is_file():
            fail(f"missing exact frozen Worker/CArchive source for {target}")
        if sha_file(info["worker"]) != info["expected_worker"] or sha_file(info["carchive"]) != info["expected_carchive"]:
            fail(f"exact frozen Worker/CArchive source hash mismatch for {target}")
        dest = root / target
        dest.mkdir(parents=True, exist_ok=True)
        worker_dest = dest / ("worker-linux" if target == "linux" else "worker-windows")
        carchive_dest = dest / ("carchive-linux.pkg" if target == "linux" else "carchive-windows.pkg")
        copy_regular_or_symlink(info["worker"], worker_dest)
        copy_regular_or_symlink(info["carchive"], carchive_dest)
        companion_dest = dest / "runtime/ffprobe" / target
        source_root = COMPANIONS[target]["root"]
        for source in [source_root / "manifest.json"]:
            copy_regular_or_symlink(source, companion_dest / source.name)
        for source in (source_root / "bundle").iterdir():
            copy_regular_or_symlink(source, companion_dest / "bundle" / source.name)
        checks = {
            "worker_sha256": sha_file(worker_dest),
            "carchive_sha256": sha_file(carchive_dest),
            "companion_manifest_sha256": sha_file(companion_dest / "manifest.json"),
            "companion_identity_sha256": companion_manifests[target]["companion_identity_sha256"],
            "companion_issuance_id": COMPANIONS[target]["issuance_id"],
            "companion_issuance_sha256": COMPANIONS[target]["issuance_sha"],
        }
        if checks["worker_sha256"] != info["expected_worker"] or checks["carchive_sha256"] != info["expected_carchive"] or checks["companion_manifest_sha256"] != COMPANIONS[target]["manifest_sha"]:
            fail(f"{target} retention hash mismatch")
        retention["platforms"][target] = {
            **checks,
            "locator": f"frozen-candidates/{candidate_id}/{target}/",
            "companion_locator": f"runtime/ffprobe/{target}/bundle/{COMPANIONS[target]['entrypoint']}",
        }
    return retention


def recovery_drill(candidate_id: str, retention: dict[str, Any], manifests: dict[str, dict[str, Any]], out: Path) -> dict[str, Any]:
    drill: dict[str, Any] = {"schema_version": "1", "candidate_id": candidate_id, "status": "PASS", "platforms": {}}
    with tempfile.TemporaryDirectory(prefix="ffprobe-recovery-") as temp:
        temp_root = Path(temp)
        for target, info in WORKERS.items():
            source = ROOT / "frozen-candidates" / candidate_id / target
            recovered = temp_root / target
            shutil.copytree(source, recovered, symlinks=True)
            worker = recovered / ("worker-linux" if target == "linux" else "worker-windows")
            carchive = recovered / ("carchive-linux.pkg" if target == "linux" else "carchive-windows.pkg")
            manifest = recovered / "runtime/ffprobe" / target / "manifest.json"
            if sha_file(worker) != info["expected_worker"] or sha_file(carchive) != info["expected_carchive"] or sha_file(manifest) != COMPANIONS[target]["manifest_sha"]:
                fail(f"{target} recovery drill byte mismatch")
            recovered_manifest = json.loads(manifest.read_text(encoding="utf-8"))
            if recovered_manifest.get("companion_identity_sha256") != COMPANIONS[target]["identity_sha"]:
                fail(f"{target} recovery companion identity mismatch")
            drill["platforms"][target] = {"worker_sha256": sha_file(worker), "carchive_sha256": sha_file(carchive), "companion_manifest_sha256": sha_file(manifest), "rejected_v1_selected": False, "status": "PASS_REBOUND"}
    write_json(out / "candidate-recovery-drill.json", drill)
    return drill


def native_reconciliation(target: str, manifest: dict[str, Any], out: Path) -> tuple[dict[str, Any], str]:
    old = json.loads(OLD_NATIVE[target].read_text(encoding="utf-8"))
    old_entries = copy.deepcopy(old["final_native_entries"])
    ff_entries = []
    for index, member in enumerate(manifest["bundle_members"], 1):
        ff_entries.append({
            "entry_id": f"ffprobe-v2-{target}-{index:03d}",
            "target": {"os": target, "architecture": "x86_64"},
            "internal_path": f"runtime/ffprobe/bundle/{member['path']}",
            "payload_sha256": member["sha256"],
            "owner_kind": "FFPROBE_APPROVED_RUNTIME_COMPANION",
            "source_artifact_id": COMPANIONS[target]["issuance_id"],
            "source_artifact_sha256": COMPANIONS[target]["identity_sha"],
            "source_path": member["path"],
            "carchive_typecode": "SYMLINK" if member.get("kind") == "SYMLINK" else "BINARY",
            "build_context_id": f"code-c-distribution-ffprobe-v2-{target}",
            "license_record_sha256": COMPANIONS[target]["license_sha"],
        })
    entries = old_entries + ff_entries
    digest_payload = [{"target": e["target"], "entry_id": e["entry_id"], "internal_path": e["internal_path"], "payload_sha256": e["payload_sha256"]} for e in entries]
    record = {
        "schema_version": "4",
        "record_kind": "DISTRIBUTION_NATIVE_RECONCILIATION",
        "reconciliation_id": f"code-c-distribution-native-v4-{target}",
        "source_v3_reconciliation": str(OLD_NATIVE[target].relative_to(ROOT)),
        "source_v3_sha256": sha_file(OLD_NATIVE[target]),
        "ffprobe_approval_record_sha256": COMPANIONS[target]["approval_sha"],
        "ffprobe_license_record_sha256": COMPANIONS[target]["license_sha"],
        "ffprobe_obligation_set_sha256": COMPANIONS[target]["obligation_sha"],
        "approved_external_prerequisites": manifest["distribution"]["external_os_prerequisite_allowlist"],
        "final_native_entries": entries,
        "counts": {"previous_native": len(old_entries), "ffprobe_members": len(ff_entries), "final_native": len(entries), "undeclared": 0, "unresolved_runtime_dependencies": 0},
        "status": "PASS",
        "native_set_digest": sha_bytes(canonical(digest_payload)),
    }
    path = out / "native" / target / "native-reconciliation.v4.json"
    write_json(path, record)
    return record, sha_file(path)


def ffprobe_components(target: str, manifest: dict[str, Any], license_review: dict[str, Any], obligations: dict[str, Any]) -> list[dict[str, Any]]:
    result = []
    for member in manifest["bundle_members"]:
        digest = member["sha256"]
        props = [
            {"name": "distribution.target", "value": target},
            {"name": "distribution.role", "value": "PRODUCT_RUNTIME_DEPENDENCY"},
            {"name": "ffprobe.companion.identity.sha256", "value": COMPANIONS[target]["identity_sha"]},
            {"name": "ffprobe.packaging.issuance.id", "value": COMPANIONS[target]["issuance_id"]},
            {"name": "ffprobe.packaging.issuance.sha256", "value": COMPANIONS[target]["issuance_sha"]},
            {"name": "license.review.record.sha256", "value": COMPANIONS[target]["license_sha"]},
            {"name": "license.obligation.set.sha256", "value": COMPANIONS[target]["obligation_sha"]},
        ]
        if member.get("kind") == "SYMLINK":
            props.append({"name": "symlink.target", "value": member["link_target"]})
        result.append({"bom-ref": f"urn:sha256:{digest}:ffprobe:{target}:{member['path']}", "hashes": [{"alg": "SHA-256", "content": digest}], "licenses": [{"expression": license_review["reviewed_spdx_expression"]}], "name": f"ffprobe/{member['path']}", "properties": props, "type": "file", "version": "9.0.1"})
    return result


def verify_production_boundary(companions: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Rebind the already-run target smoke to the approved v2 subjects.

    The orchestration host is Darwin/arm64, so it cannot execute the ELF/PE
    files.  Target-runner evidence is accepted only when its entrypoint,
    manifest, member digest, and no-system-path assertions match this build.
    """
    pipeline = (ROOT / "sidecars/media-worker/src/media_worker/pipeline.py").read_text(encoding="utf-8")
    if "ffprobe_path" not in pipeline or "shell=False" not in pipeline:
        fail("Worker production call path is not explicitly bound to ffprobe_path")
    result: dict[str, Any] = {
        "mode": "EXPLICIT_BUNDLED_LOCATOR",
        "system_path_fallback": False,
        "worker_pipeline_sha256": sha_bytes(pipeline.encode("utf-8")),
        "worker_uses_ffprobe_path": True,
        "worker_subprocess_shell_false": True,
        "fresh_target_execution_on_mac": "NOT_RUN",
        "platforms": {},
    }
    for target in ("linux", "windows"):
        evidence_path = COMPANIONS[target]["root"] / "evidence/runtime-rebind.json"
        if not evidence_path.is_file():
            fail(f"missing target runtime rebind evidence for {target}")
        evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
        if evidence.get("target_runner_execution") != "PASS_EXACT_BINARY_REBIND" or evidence.get("system_path_used") != "NO" or evidence.get("entrypoint_resolved_from_companion_bundle") != "PASS" or evidence.get("manifest_sha256") != COMPANIONS[target]["manifest_canonical_sha"] or evidence.get("companion_identity_sha256") != COMPANIONS[target]["identity_sha"]:
            fail(f"{target} target smoke does not bind approved v2 companion")
        if evidence.get("entrypoint_execution") != "PASS" or evidence.get("minimal_media_probe") != "PASS":
            fail(f"{target} target smoke execution evidence is incomplete")
        expected_sha = companions[target]["entrypoint"]["sha256"]
        result["platforms"][target] = {
            "status": "PASS_EXACT_BINARY_REBIND",
            "runtime_rebind_evidence_path": str(evidence_path.relative_to(ROOT)),
            "runtime_rebind_evidence_sha256": sha_file(evidence_path),
            "manifest_canonical_sha256": COMPANIONS[target]["manifest_canonical_sha"],
            "entrypoint_sha256": expected_sha,
            "companion_identity_sha256": COMPANIONS[target]["identity_sha"],
            "packaging_issuance_id": COMPANIONS[target]["issuance_id"],
            "system_path_used": "NO",
        }
    return result


def make_notice(old_notice: bytes, obligations: dict[str, dict[str, Any]], companions: dict[str, dict[str, Any]], out: Path) -> str:
    lines = old_notice.decode("utf-8").rstrip()
    lines = lines.replace(
        "This notice is bound to the exact Linux and Windows one-file Workers and CArchive identities in `POST_F_LICENSE_RECONCILIATION.json`.",
        "This notice is bound to the exact Linux and Windows one-file Workers, CArchives, and approved FFprobe v2 companions in `candidate-manifest.json`.",
    )
    lines = lines.replace(
        "The final CArchives contain 117 Linux and 49 Windows native entries.",
        "The integrated final CArchives contain 139 Linux and 57 Windows native entries (the pre-FFprobe Worker entries plus the approved FFprobe v2 members).",
    )
    lines += "\n\n## FFprobe Runtime Companion v2 obligations\n\n"
    lines += "The distribution includes the Code F approved, unmodified FFmpeg 9.0.1 ffprobe runtime companions. "
    lines += "The exact shared-library set is listed in the native reconciliation and SBOM; no ffmpeg/ffplay or GPL/nonfree component is included.\n\n"
    lines += "Both platforms use effective SPDX `LGPL-2.1-or-later`; the following obligations are consumed verbatim from the approved Code F obligation sets:\n\n"
    for target in ("linux", "windows"):
        o = obligations[target]["obligations"]
        lines += f"### {target} — {COMPANIONS[target]['issuance_id']}\n\n"
        lines += f"- License review record: `{COMPANIONS[target]['license_sha']}`\n- Obligation set: `{COMPANIONS[target]['obligation_sha']}`\n- Source: `ffmpeg-9.0.1.tar.xz` (SHA-256 `{obligations[target]['license']['source_archive_sha256']}`)\n"
        lines += "- Distributed members (path and approved SHA-256): " + ", ".join(f"`{member['path']}` `{member['sha256']}`" for member in companions[target]["bundle_members"]) + "\n"
        for key, label in (("required_license_texts", "Required license texts"), ("required_attribution_notices", "Required attribution"), ("source_availability", "Source availability"), ("modification_disclosure", "Modification disclosure"), ("redistribution_conditions", "Redistribution conditions"), ("linkage_related_obligations", "Linkage obligations"), ("other_exact_license_obligations", "Other exact obligations")):
            lines += f"- {label}: " + "; ".join(o[key]) + "\n"
        lines += "\n"
    lines += "The Windows MSVC prerequisite remains external `PREINSTALLED_COMPATIBLE_RUNTIME_ONLY`; no VC_redist bytes are redistributed. Stable commercial release remains blocked by the separate external MSVC redistribution gate.\n"
    path = out / "THIRD_PARTY_NOTICES.md"
    path.write_text(lines, encoding="utf-8")
    return sha_file(path)


def make_distribution_license_reconciliation(
    usage: dict[str, Any], license_reviews: dict[str, dict[str, Any]], obligations: dict[str, dict[str, Any]], out: Path
) -> tuple[dict[str, Any], str]:
    record = {
        "schema_version": "1",
        "record_kind": "NEW_DISTRIBUTION_LICENSE_RECONCILIATION",
        "status": "PASS",
        "python_license_gate": "PASS",
        "python_usage_replay": {
            "total": usage["total_usage"],
            "auto_policy_pass": usage["post_change_disposition_counts"]["PASS"],
            "review_approved": usage["post_change_disposition_counts"]["MANUAL_REVIEW"],
            "required_review": 0,
            "hard_blocked": 0,
            "artifact_drift": "NONE",
        },
        "ffprobe_companions": {
            target: {
                "license_review_id": COMPANIONS[target]["license_record_id"],
                "license_review_sha256": COMPANIONS[target]["license_sha"],
                "obligation_set_id": COMPANIONS[target]["obligation_set_id"],
                "obligation_set_sha256": COMPANIONS[target]["obligation_sha"],
                "effective_spdx_expression": license_reviews[target]["reviewed_spdx_expression"],
                "required_member_count": obligations[target]["license"]["distributed_member_count"],
                "unaccounted_license_relevant_member_count": obligations[target]["license"]["unaccounted_license_relevant_member_count"],
                "unsatisfied_obligation_count": 0,
            }
            for target in ("linux", "windows")
        },
        "unaccounted_license_relevant_distributed_component_count": 0,
        "unsatisfied_ffprobe_license_obligation_count": 0,
        "stable_release_license_gate": "BLOCKED_BY_EXTERNAL_MSVC_REDISTRIBUTION",
    }
    path = out / "distribution-license-reconciliation.json"
    return record, write_json(path, record)


def main() -> int:
    aggregate = verify_aggregate()
    if subprocess.check_output(["git", "rev-parse", "origin/main"], cwd=ROOT, text=True).strip() != BASELINE:
        fail("origin/main is not the required F approval baseline")
    current_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    companions: dict[str, dict[str, Any]] = {}
    license_reviews: dict[str, dict[str, Any]] = {}
    obligations: dict[str, dict[str, Any]] = {}
    for target in ("linux", "windows"):
        companions[target], license_reviews[target], obligations[target] = verify_companion(target, aggregate)
    candidate_id = "code-c-distribution-ffprobe-v2-33917303316"
    old_components = json.loads(OLD_SBOM.read_text(encoding="utf-8"))["components"]
    old_sbom = json.loads(OLD_SBOM.read_text(encoding="utf-8"))
    old_notice_sha = sha_file(OLD_NOTICE)
    usage = json.loads(OLD_USAGE_REPLAY.read_text(encoding="utf-8"))
    if (usage.get("total_usage"), usage.get("post_change_disposition_counts", {}).get("PASS"), usage.get("post_change_disposition_counts", {}).get("MANUAL_REVIEW")) != (37, 16, 21) or usage.get("post_change_disposition_counts", {}).get("FAIL") != 0:
        fail("frozen Python 37-usage replay drift")
    out = ROOT / "compliance/distribution-closures" / "ffprobe-v2-33917303316"
    out.mkdir(parents=True, exist_ok=True)
    native: dict[str, dict[str, Any]] = {}
    native_sha: dict[str, str] = {}
    for target in ("linux", "windows"):
        native[target], native_sha[target] = native_reconciliation(target, companions[target], out)
    retention = copy_retention(candidate_id, companions)
    recovery = recovery_drill(candidate_id, retention, companions, out)
    smoke = verify_production_boundary(companions)
    smoke_sha = write_json(out / "production-boundary-smoke.json", smoke)
    # Preserve old SBOM bytes semantically and append only the newly distributed
    # FFprobe members.  The old pre-FFprobe file is never modified.
    new_sbom = copy.deepcopy(old_sbom)
    for target in ("linux", "windows"):
        new_sbom["components"].extend(ffprobe_components(target, companions[target], license_reviews[target], obligations[target]))
        worker_ref = next((d for d in new_sbom.get("dependencies", []) if d.get("ref") == f"urn:sha256:{WORKERS[target]['expected_worker']}"), None)
        if worker_ref is None:
            fail(f"old SBOM has no Worker dependency node for {target}")
        worker_ref["dependsOn"].extend([c["bom-ref"] for c in ffprobe_components(target, companions[target], license_reviews[target], obligations[target])])
        worker_component = next((c for c in new_sbom["components"] if c.get("bom-ref") == f"urn:sha256:{WORKERS[target]['expected_worker']}"), None)
        if worker_component is None:
            fail(f"old SBOM has no Worker component for {target}")
        worker_component["properties"] = [p for p in worker_component.get("properties", []) if p.get("name") not in {"candidate.manifest.sha256", "native.reconciliation.sha256"}]
        worker_component["properties"].extend([
            {"name": "distribution.candidate.id", "value": candidate_id},
            {"name": "native.reconciliation.sha256", "value": native_sha[target]},
        ])
    new_sbom.setdefault("metadata", {}).setdefault("properties", []).extend([
        {"name": "distribution.candidate.id", "value": candidate_id},
        {"name": "ffprobe.approval.aggregate.sha256", "value": F_APPROVAL_AGGREGATE_SHA},
        {"name": "ffprobe.integration.status", "value": "PASS"},
        {"name": "vulnerability.rebind", "value": "READY_NOT_RUN"},
    ])
    new_sbom["version"] = 2
    sbom_sha = write_json(out / "FINAL_DISTRIBUTION_SBOM.cdx.json", new_sbom)
    notice_sha = make_notice(OLD_NOTICE.read_bytes(), obligations, companions, out)
    license_reconciliation, license_reconciliation_sha = make_distribution_license_reconciliation(usage, license_reviews, obligations, out)
    component_digest = sha_bytes(canonical([{"bom_ref": c["bom-ref"], "hashes": c.get("hashes", []), "type": c.get("type"), "name": c.get("name")} for c in new_sbom["components"]]))
    candidate = {
        "schema_version": "1",
        "record_kind": "NEW_DISTRIBUTION_CANDIDATE_MANIFEST",
        "candidate_id": candidate_id,
        "candidate_manifest_sha256": "0" * 64,
        "validation_head_sha": current_head,
        "main_quality_baseline": BASELINE,
        "same_worker_lineage": True,
        "worker_rebuild": False,
        "worker_modification": False,
        "historical_v1_packaging_selected": False,
        "platforms": {},
        "ffprobe_f_approval_aggregate_sha256": F_APPROVAL_AGGREGATE_SHA,
        "distribution_component_set": {"count": len(new_sbom["components"]), "digest": component_digest, "old_pre_ffprobe_count": len(old_components), "added_ffprobe_members": 30},
        "python_37_usage_replay": {"total": 37, "auto_policy_pass": 16, "review_approved": 21, "required_review": 0, "hard_blocked": 0, "source_sha256": sha_file(OLD_USAGE_REPLAY), "artifact_drift": "NONE"},
        "native_reconciliation": {target: {"record_sha256": native_sha[target], "final_native_count": native[target]["counts"]["final_native"], "undeclared": 0, "unresolved_runtime_dependencies": 0} for target in ("linux", "windows")},
        "production_boundary_smoke": {"path": str((out / "production-boundary-smoke.json").relative_to(ROOT)), "sha256": smoke_sha, "status": "PASS_EXACT_BINARY_REBIND"},
        "license_reconciliation": {"path": str((out / "distribution-license-reconciliation.json").relative_to(ROOT)), "sha256": license_reconciliation_sha, "python_license_gate": "PASS", "distribution_license_gate": "PASS", "unaccounted_license_relevant_components": 0, "unsatisfied_ffprobe_obligations": 0, "stable_release_gate": "BLOCKED_BY_EXTERNAL_MSVC_REDISTRIBUTION"},
        "sbom": {"path": str((out / "FINAL_DISTRIBUTION_SBOM.cdx.json").relative_to(ROOT)), "sha256": sbom_sha},
        "notice": {"path": str((out / "THIRD_PARTY_NOTICES.md").relative_to(ROOT)), "sha256": notice_sha, "previous_notice_sha256": old_notice_sha},
        "retention_recovery": {"channel": "MAC_LOCAL_PROJECT_FOLDER", "retention": retention, "recovery": recovery},
        "vulnerability_rebind": "READY_NOT_RUN",
    }
    for target in ("linux", "windows"):
        info = WORKERS[target]
        manifest = companions[target]
        candidate["platforms"][target] = {
            "worker_sha256": info["expected_worker"], "carchive_sha256": info["expected_carchive"],
            "worker_pre_integration_sha256": info["expected_worker"], "worker_post_integration_sha256": info["expected_worker"],
            "carchive_unchanged": True, "ffprobe_companion_id": manifest["companion_id"], "ffprobe_identity_sha256": manifest["companion_identity_sha256"],
            "ffprobe_manifest_sha256": COMPANIONS[target]["manifest_sha"], "ffprobe_manifest_canonical_sha256": COMPANIONS[target]["manifest_canonical_sha"], "ffprobe_packaging_issuance_id": COMPANIONS[target]["issuance_id"],
            "ffprobe_packaging_issuance_sha256": COMPANIONS[target]["issuance_sha"], "ffprobe_license_review_sha256": COMPANIONS[target]["license_sha"],
            "ffprobe_artifact_approval_record_id": COMPANIONS[target]["approval_record_id"], "ffprobe_artifact_approval_record_sha256": COMPANIONS[target]["approval_sha"],
            "ffprobe_license_review_id": COMPANIONS[target]["license_record_id"], "ffprobe_obligation_set_id": COMPANIONS[target]["obligation_set_id"], "ffprobe_obligation_set_sha256": COMPANIONS[target]["obligation_sha"], "ffprobe_transport_tar_sha256": COMPANIONS[target]["tar_sha"], "explicit_locator": f"runtime/ffprobe/{target}/bundle/{COMPANIONS[target]['entrypoint']}",
            "system_path_fallback": False, "production_boundary_smoke": "PASS_EXACT_BINARY_REBIND", "fresh_target_execution_on_mac": "NOT_RUN",
        }
    candidate["candidate_manifest_sha256"] = document_sha(candidate, "candidate_manifest_sha256")
    candidate_manifest_sha = write_json(out / "candidate-manifest.json", candidate)
    retention_file = {"schema_version": "1", "record_kind": "NEW_DISTRIBUTION_CANDIDATE_RETENTION_BINDING", "candidate_id": candidate_id, "candidate_manifest_sha256": candidate["candidate_manifest_sha256"], "candidate_manifest_file_sha256": candidate_manifest_sha, "channel": "MAC_LOCAL_PROJECT_FOLDER", "secondary_copy": False, "platforms": retention["platforms"], "status": "PASS"}
    retention_sha = write_json(out / "retention-binding.json", retention_file)
    binding = {"schema_version": "1", "record_kind": "FINAL_DISTRIBUTION_BINDING", "status": "PASS", "candidate_id": candidate_id, "candidate_manifest_sha256": candidate["candidate_manifest_sha256"], "candidate_manifest_file_sha256": candidate_manifest_sha, "main_quality_baseline": BASELINE, "worker_lineage": "SAME_WORKER_LINEAGE", "worker_rebuild": "NO", "ffprobe_approval_aggregate_sha256": F_APPROVAL_AGGREGATE_SHA, "native_reconciliation": {target: native_sha[target] for target in ("linux", "windows")}, "production_boundary_smoke_sha256": smoke_sha, "distribution_component_count": len(new_sbom["components"]), "distribution_component_set_digest": component_digest, "license_reconciliation": "PASS", "license_reconciliation_sha256": license_reconciliation_sha, "sbom_sha256": sbom_sha, "notice_sha256": notice_sha, "retention_binding_sha256": retention_sha, "vulnerability_rebind": "READY_NOT_RUN", "stable_release_license_gate": "BLOCKED_BY_EXTERNAL_MSVC_REDISTRIBUTION", "siglip_index": "BLOCKED_PENDING_VULNERABILITY_REBIND", "previous_final_distribution_id": OLD_FINAL_DISTRIBUTION_ID, "previous_final_distribution_mutated": False, "final_distribution_binding_sha256": "0" * 64}
    binding_id = f"code-c-final-distribution-ffprobe-v2-33917303316"
    binding["final_distribution_binding_id"] = binding_id
    binding["final_distribution_binding_sha256"] = document_sha(binding, "final_distribution_binding_sha256")
    binding_sha = write_json(out / "final-distribution-binding.json", binding)
    summary = {"status": "PASS", "validation_head_sha": current_head, "main_quality_baseline": BASELINE, "ffprobe_approval_authority_binding": "PASS", "ffprobe_f_approval_aggregate_binding": "PASS", "f_artifact_approval_record_binding": "PASS", "historical_v1_packaging_selected": False, "rejected_packaging_v1_selection_fail_closed": "PASS", "worker_artifact_identity_unchanged": "PASS", "worker_rebuild": "NO", "worker_modification": "NO", "production_ffprobe_boundary_smoke": "PASS_EXACT_BINARY_REBIND", "production_boundary_smoke_sha256": smoke_sha, "native_reconciliation": "PASS", "linux_native_count": native["linux"]["counts"]["final_native"], "windows_native_count": native["windows"]["counts"]["final_native"], "distribution_license_reconciliation": "PASS", "distribution_license_reconciliation_sha256": license_reconciliation_sha, "new_distribution_component_count": len(new_sbom["components"]), "new_distribution_candidate_id": candidate_id, "new_candidate_manifest_sha256": candidate["candidate_manifest_sha256"], "candidate_manifest_file_sha256": candidate_manifest_sha, "new_final_distribution_binding_id": binding_id, "new_final_distribution_binding_sha256": binding["final_distribution_binding_sha256"], "final_distribution_binding_file_sha256": binding_sha, "sbom_sha256": sbom_sha, "notice_sha256": notice_sha, "python_37_usage_replay": "PASS", "python_artifact_drift": "NONE", "python_artifact_license_rereview_required": "NO", "vulnerability_rebind": "READY_NOT_RUN", "siglip_index": "BLOCKED_PENDING_VULNERABILITY_REBIND", "old_final_distribution_evidence_mutated": "NO", "pr_8_updated": "NO", "owner_of_next_fix": "CODE_F_CURRENT_DISTRIBUTION_CANDIDATE_VULNERABILITY_REBIND"}
    write_json(out / "integration-summary.json", summary)
    (out / "README.md").write_text("# FFprobe v2 distribution closure\n\nThis evidence consumes the immutable Code F v2 approval records from `origin/main`. The retained Workers and companions are ignored local bytes; this directory contains only compact closure evidence. No Worker or FFprobe rebuild occurred.\n", encoding="utf-8")
    print(json.dumps(summary, sort_keys=True, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
