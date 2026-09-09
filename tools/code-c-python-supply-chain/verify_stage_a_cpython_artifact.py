from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path, PurePosixPath

from canonical_evidence import write_canonical_json
from policy import sha256_file


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
SOURCE_LOCK = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "supply-chain"
    / "toolchain-source-lock.json"
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--distribution", type=Path, required=True)
    parser.add_argument("--stage-a-review", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()

    lock = json.loads(SOURCE_LOCK.read_text(encoding="utf-8"))
    distribution_lock = lock["targets"]["windows"]["cpython_distribution"]
    review = json.loads(arguments.stage_a_review.read_text(encoding="utf-8"))
    target = review.get("target", {})
    failures: list[str] = []
    if (
        review.get("stage") != "STAGE_A"
        or review.get("validation_build_authorization") != "ALLOW_VALIDATION_BUILD_ONLY"
    ):
        failures.append("Stage A review does not authorize a validation build")
    if (
        target.get("python_version") != lock["python_version"]
        or target.get("abi") != lock["python_abi"]
        or target.get("gil") != "STANDARD"
        or target.get("os") != "windows"
        or target.get("architecture") != "x86_64"
    ):
        failures.append("Stage A target differs from the locked standard-GIL Windows target")
    if (
        arguments.distribution.name != distribution_lock["filename"]
        or arguments.distribution.stat().st_size != distribution_lock["size"]
        or sha256_file(arguments.distribution) != distribution_lock["sha256"]
    ):
        failures.append("actions/python-versions distribution wrapper differs from source lock")

    payload_path = str(distribution_lock["interpreter_payload"])
    payload = b""
    with zipfile.ZipFile(arguments.distribution) as archive:
        names: set[str] = set()
        for member in archive.infolist():
            normalized = PurePosixPath(member.filename.replace("\\", "/"))
            if normalized.is_absolute() or ".." in normalized.parts:
                failures.append(f"unsafe CPython distribution member: {member.filename}")
                continue
            name = normalized.as_posix()
            if name in names:
                failures.append(f"duplicate CPython distribution member: {name}")
            names.add(name)
        if payload_path not in names:
            failures.append(f"CPython installer payload is missing: {payload_path}")
        else:
            payload = archive.read(payload_path)

    actual_sha256 = hashlib.sha256(payload).hexdigest()
    expected_sha256 = str(target.get("distribution_sha256", ""))
    if payload_path != target.get("distribution_filename"):
        failures.append("actual installer filename differs from Stage A")
    if actual_sha256 != distribution_lock["interpreter_payload_sha256"]:
        failures.append("actual installer payload differs from source lock")
    if actual_sha256 != expected_sha256:
        failures.append("actual build CPython artifact differs from Stage A")

    evidence = {
        "report_kind": "CODE_C_STAGE_A_CPYTHON_ARTIFACT_BINDING",
        "schema_version": "1",
        "status": "PASS" if not failures else "FAIL",
        "stage_a_review_id": review.get("review_id"),
        "validation_build_authorization": review.get("validation_build_authorization"),
        "actual_build_cpython": {
            "source": target.get("distribution_source"),
            "filename": payload_path,
            "version": lock["python_version"],
            "platform": "windows",
            "architecture": "x86_64",
            "python_abi": lock["python_abi"],
            "python_free_threaded": lock["free_threaded"],
            "sha256": actual_sha256,
            "provenance": {
                "acquisition_wrapper_filename": arguments.distribution.name,
                "acquisition_wrapper_sha256": sha256_file(arguments.distribution),
                "acquisition_wrapper_source": distribution_lock["download_url"],
                "acquisition_wrapper_canonical_source": distribution_lock["canonical_source"],
                "installer_member_path": payload_path,
            },
        },
        "stage_a_cpython_sha256": expected_sha256,
        "stage_a_cpython_artifact_match": actual_sha256 == expected_sha256,
        "failures": failures,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    write_canonical_json(arguments.output, evidence)
    if failures:
        raise SystemExit("Stage A CPython artifact binding failed:\n" + "\n".join(failures))
    print(
        "stage-a-cpython-artifact: PASS "
        f"({payload_path}; {actual_sha256}; standard GIL; cp313)"
    )


if __name__ == "__main__":
    main()
