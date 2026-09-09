from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

from canonical_evidence import write_canonical_json


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_NOTICE_TOOL = REPOSITORY_ROOT / "tools" / "license-policy" / "notices.mjs"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized(value: str) -> str:
    return value.lower().replace("_", "-")


def load(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def exact_zip_member(archive_path: Path, relative_path: str, expected_hash: str) -> bytes:
    requested = PurePosixPath(relative_path)
    if requested.is_absolute() or ".." in requested.parts or "\\" in relative_path:
        raise SystemExit(f"unsafe license evidence path: {relative_path}")
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise SystemExit(f"duplicate archive paths in {archive_path.name}")
        matches = [name for name in names if PurePosixPath(name) == requested]
        if len(matches) != 1:
            raise SystemExit(
                f"{archive_path.name}: expected one exact license file {relative_path}, "
                f"got {len(matches)}"
            )
        value = archive.read(matches[0])
    if sha256_bytes(value) != expected_hash:
        raise SystemExit(f"{archive_path.name}: license evidence hash mismatch: {relative_path}")
    return value


def text(value: bytes, label: str) -> str:
    try:
        return value.decode("utf-8").replace("\r\n", "\n")
    except UnicodeDecodeError as error:
        raise SystemExit(f"license evidence is not UTF-8 text: {label}") from error


def decisions(report: dict[str, object]) -> list[dict[str, object]]:
    return list(report.get("decisions") or report.get("components") or [])


def require_pass_decision(
    candidates: list[dict[str, object]],
    artifact_hash: str,
    expression: str,
    artifact_role: str | None = None,
) -> dict[str, object]:
    matches = [
        decision
        for decision in candidates
        if decision.get("artifact_sha256") == artifact_hash
        and decision.get("detected_license_expression") == expression
        and (artifact_role is None or decision.get("artifact_role") == artifact_role)
    ]
    if len(matches) != 1 or matches[0].get("policy_result") != "PASS":
        raise SystemExit(f"exact PASS license decision is missing: {artifact_hash}")
    return matches[0]


def render_entry(
    heading: str,
    artifact_hash: str,
    expression: str,
    source: str,
    obligations: list[str],
    files: list[tuple[str, str, bytes]],
) -> tuple[str, dict[str, object]]:
    if not files:
        raise SystemExit(f"notice-required component has no materialized evidence: {heading}")
    lines = [
        f"### {heading}",
        "",
        f"- Artifact SHA-256: `{artifact_hash}`",
        f"- License expression: `{expression}`",
        f"- Source: {source}",
        f"- Obligations: {', '.join(obligations)}",
    ]
    materialized = []
    for relative_path, raw_hash, value in files:
        normalized_text = text(value, relative_path)
        materialized_hash = sha256_bytes(normalized_text.encode("utf-8"))
        lines.extend(
            [
                "",
                f"#### `{relative_path}`",
                "",
                f"Raw evidence SHA-256: `{raw_hash}`  ",
                f"Materialized text SHA-256: `{materialized_hash}`",
                "",
                normalized_text.rstrip("\n"),
                "",
            ]
        )
        materialized.append(
            {
                "relative_path": relative_path,
                "raw_sha256": raw_hash,
                "materialized_text_sha256": materialized_hash,
            }
        )
    return "\n".join(lines), {
        "component": heading,
        "artifact_sha256": artifact_hash,
        "license_expression": expression,
        "notice_required": True,
        "materialized_files": materialized,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=["windows", "linux"], required=True)
    parser.add_argument("--artifact-root", type=Path, required=True)
    parser.add_argument("--toolchain-artifact-root", type=Path, required=True)
    parser.add_argument("--wheel-license-report", type=Path, required=True)
    parser.add_argument("--toolchain-license-report", type=Path, required=True)
    parser.add_argument("--usage-evaluation", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    arguments = parser.parse_args()

    runtime_path = (
        REPOSITORY_ROOT
        / "compliance"
        / "python-artifacts"
        / arguments.target
        / "runtime.v2.json"
    )
    toolchain_path = (
        REPOSITORY_ROOT
        / "compliance"
        / "python-toolchain"
        / f"{arguments.target}.v1.json"
    )
    runtime = load(runtime_path)
    toolchain = load(toolchain_path)
    wheel_decisions = decisions(load(arguments.wheel_license_report))
    toolchain_decisions = decisions(load(arguments.toolchain_license_report))
    usage = load(arguments.usage_evaluation)
    if (
        usage.get("policy_result") != "PASS"
        or usage.get("functional_role") != "PYINSTALLER_BUILD_TOOL"
        or usage.get("distribution_role") != "BUILD_ONLY"
        or usage.get("reachability", {}).get("customer_notice") != "EXCLUDED_BUILD_ONLY"
    ):
        raise SystemExit("PyInstaller build-only customer-notice reachability is not approved")

    sections: list[str] = []
    reconciled: list[dict[str, object]] = []
    pillow = next(
        (
            package
            for package in runtime["packages"]
            if normalized(str(package["package_name"])) == "pillow"
        ),
        None,
    )
    if pillow is None:
        raise SystemExit("production runtime inventory omits Pillow")

    for package in runtime["packages"]:
        artifact_hash = str(package["sha256"])
        decision = require_pass_decision(
            wheel_decisions,
            artifact_hash,
            str(package["license_expression"]),
            "RUNTIME_WHEEL",
        )
        if not decision.get("notice_required"):
            continue
        if normalized(str(package["package_name"])) == "pillow":
            continue
        wheel = arguments.artifact_root / str(package["artifact_path"])
        if wheel.name != package["filename"] or sha256_file(wheel) != artifact_hash:
            raise SystemExit(f"runtime wheel identity drift: {package['purl']}")
        files = [
            (
                str(entry["relative_path"]),
                str(entry["sha256"]),
                exact_zip_member(wheel, str(entry["relative_path"]), str(entry["sha256"])),
            )
            for entry in package["license_files"]
        ]
        rendered, record = render_entry(
            f"{package['package_name']} {package['version']}",
            artifact_hash,
            str(package["license_expression"]),
            str(package["provenance"]["download_url"]),
            [str(value) for value in decision["obligations"]],
            files,
        )
        sections.append(rendered)
        reconciled.append(record)

    by_kind = {component["component_kind"]: component for component in toolchain["components"]}
    pyinstaller = by_kind["PYINSTALLER"]
    pyinstaller_wheel = arguments.toolchain_artifact_root / str(
        pyinstaller["artifact"]["artifact_path"]
    )
    for kind in ("CPYTHON_DISTRIBUTION", "PYINSTALLER_BOOTLOADER"):
        component = by_kind[kind]
        artifact_hash = str(component["artifact"]["sha256"])
        decision = require_pass_decision(
            toolchain_decisions, artifact_hash, str(component["license"]["expression"])
        )
        if not decision.get("notice_required"):
            continue
        if kind == "CPYTHON_DISTRIBUTION":
            files = []
            for entry in component["license"]["files"]:
                evidence_path = REPOSITORY_ROOT / str(entry["relative_path"])
                if sha256_file(evidence_path) != entry["sha256"]:
                    raise SystemExit("CPython materialized license evidence hash drift")
                files.append(
                    (
                        str(entry["relative_path"]),
                        str(entry["sha256"]),
                        evidence_path.read_bytes(),
                    )
                )
        else:
            if sha256_file(pyinstaller_wheel) != pyinstaller["artifact"]["sha256"]:
                raise SystemExit("PyInstaller toolchain wheel identity drift")
            files = [
                (
                    str(entry["relative_path"]),
                    str(entry["sha256"]),
                    exact_zip_member(
                        pyinstaller_wheel,
                        str(entry["relative_path"]),
                        str(entry["sha256"]),
                    ),
                )
                for entry in component["license"]["files"]
            ]
        rendered, record = render_entry(
            f"{component['name']} {component['version']}",
            artifact_hash,
            str(component["license"]["expression"]),
            str(component["artifact"]["canonical_reference"]),
            [str(value) for value in decision["obligations"]],
            files,
        )
        sections.append(rendered)
        reconciled.append(record)

    pillow_scan = (
        REPOSITORY_ROOT
        / "compliance"
        / "license-evidence"
        / "pillow-12.3.0"
        / f"{arguments.target}-cp313.scan.json"
    )
    pillow_text = pillow_scan.with_name(f"{arguments.target}-cp313.LICENSE.txt")
    scan = load(pillow_scan)
    if scan["artifact"]["sha256"] != pillow["sha256"]:
        raise SystemExit("Pillow public evidence differs from the production runtime wheel")
    pillow_decision = require_pass_decision(
        wheel_decisions,
        str(pillow["sha256"]),
        str(pillow["license_expression"]),
        "RUNTIME_WHEEL",
    )
    if not pillow_decision.get("notice_required"):
        raise SystemExit("Pillow exact decision unexpectedly omits notice materialization")
    with tempfile.TemporaryDirectory(prefix="code-c-pillow-notice-") as directory:
        pillow_output = Path(directory) / "THIRD_PARTY_NOTICES.md"
        result = subprocess.run(
            [
                "node",
                str(PUBLIC_NOTICE_TOOL),
                "--scan",
                str(pillow_scan),
                "--license-text",
                str(pillow_text),
                "--output",
                str(pillow_output),
            ],
            cwd=REPOSITORY_ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            raise SystemExit(result.stderr.strip() or result.stdout.strip())
        pillow_notice = pillow_output.read_text(encoding="utf-8")
    sections.append("## Pillow bundled third-party evidence\n\n" + pillow_notice)
    reconciled.append(
        {
            "component": f"{pillow['package_name']} {pillow['version']}",
            "artifact_sha256": pillow["sha256"],
            "license_expression": pillow["license_expression"],
            "notice_required": True,
            "public_bundled_evidence_identity_sha256": scan["evidence_identity_sha256"],
            "materialized_notice_sha256": sha256_bytes(pillow_notice.encode("utf-8")),
        }
    )

    rendered = (
        "# THIRD_PARTY_NOTICES\n\n"
        f"Release target: `{arguments.target}/x86_64`, CPython `3.13.15` standard GIL / `cp313`\n\n"
        + "\n\n".join(sections)
        + "\n"
    )
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(rendered, encoding="utf-8")
    report = {
        "report_kind": "CODE_C_RELEASE_NOTICE_RECONCILIATION",
        "status": "PASS",
        "target": arguments.target,
        "runtime_inventory_id": runtime["inventory_id"],
        "toolchain_inventory_id": toolchain["inventory_id"],
        "license_policy_version": load(arguments.wheel_license_report)[
            "license_policy_version"
        ],
        "pyinstaller_usage_binding_id": usage["usage_binding_id"],
        "pyinstaller_customer_notice_reachability": usage["reachability"][
            "customer_notice"
        ],
        "components": reconciled,
        "notice_sha256": sha256_bytes(rendered.encode("utf-8")),
    }
    arguments.report.parent.mkdir(parents=True, exist_ok=True)
    write_canonical_json(arguments.report, report)
    print(
        f"code-c-release-notices: PASS ({arguments.target}; "
        f"{len(reconciled)} exact notice components; {report['notice_sha256']})"
    )


if __name__ == "__main__":
    main()
