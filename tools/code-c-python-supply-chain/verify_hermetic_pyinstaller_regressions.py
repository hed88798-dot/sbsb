from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from canonical_evidence import canonical_sha256, write_canonical_json
from hermetic_pyinstaller import (
    HermeticBuildError,
    approved_source_entry,
    build_child_environment,
    normalized_realpath,
    sha256_file,
)
from prepackage_selected_source_gate import validate_selected_sources


def expect_rejected(path: Path, digest: str, manifest: dict[str, object]) -> None:
    try:
        approved_source_entry(path, digest, manifest)
    except HermeticBuildError:
        return
    raise AssertionError(f"unapproved source unexpectedly passed: {path}")


def make_escape(link: Path, target: Path) -> None:
    if os.name == "nt":
        result = subprocess.run(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(target)],
            shell=False,
            check=False,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            raise AssertionError(result.stderr or result.stdout or "junction creation failed")
    else:
        link.symlink_to(target, target_is_directory=True)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="code-c-hermetic-pyinstaller-") as directory:
        root = Path(directory)
        approved = root / "approved worker"
        ambient = root / "ambient toolchain"
        cache = root / "cache"
        approved.mkdir()
        ambient.mkdir()
        cache.mkdir()
        approved_file = approved / "same-name.dll"
        ambient_file = ambient / "same-name.dll"
        approved_file.write_bytes(b"identical native bytes")
        ambient_file.write_bytes(approved_file.read_bytes())
        digest = sha256_file(approved_file)
        manifest = {
            "packaging_approved_source_roots": [
                {"kind": "TEST_APPROVED_ROOT", "realpath": normalized_realpath(approved)}
            ],
            "approved_source_file_manifest": [
                {
                    "resolved_path": str(approved_file.resolve()),
                    "resolved_path_key": normalized_realpath(approved_file),
                    "sha256": digest,
                    "source_kind": "SYNTHETIC_APPROVED_NATIVE",
                    "source_artifact_identity": {"artifact_sha256": "a" * 64},
                }
            ],
        }
        approved_source_entry(approved_file, digest, manifest)
        expect_rejected(ambient_file, digest, manifest)

        identity_sha256 = canonical_sha256(manifest)
        gate_manifest = {
            **manifest,
            "build_environment_manifest_id": (
                f"code-c-build-environment-{identity_sha256[:32]}"
            ),
            "build_environment_identity_sha256": identity_sha256,
        }
        manifest_path = root / "manifest.json"
        selected_path = root / "selected.json"
        write_canonical_json(manifest_path, gate_manifest)
        approved_gate = validate_selected_sources(
            [(approved_file.name, str(approved_file), "BINARY")],
            manifest_path,
            selected_path,
        )
        assert approved_gate["status"] == "PASS"
        try:
            validate_selected_sources(
                [(ambient_file.name, str(ambient_file), "BINARY")],
                manifest_path,
                selected_path,
            )
        except SystemExit:
            assert json.loads(selected_path.read_text(encoding="utf-8"))["status"] == "FAIL"
        else:
            raise AssertionError("same-byte ambient source passed the pre-package gate")

        escape = approved / "escape"
        make_escape(escape, ambient)
        expect_rejected(escape / ambient_file.name, digest, manifest)
        try:
            validate_selected_sources(
                [(ambient_file.name, str(escape / ambient_file.name), "BINARY")],
                manifest_path,
                selected_path,
            )
        except SystemExit:
            assert json.loads(selected_path.read_text(encoding="utf-8"))["status"] == "FAIL"
        else:
            raise AssertionError("realpath escape passed the pre-package gate")

        parent = {
            "PATH": os.pathsep.join([str(ambient), str(approved)]),
            "JAVA_HOME": str(ambient / "jdk"),
            "MAGICK_HOME": str(ambient / "imagemagick"),
            "PYTHONPATH": str(ambient / "bootstrap-python"),
        }
        child, audit = build_child_environment(
            parent,
            path_entries=[str(approved)],
            cache_root=cache,
            worker_root=approved,
            manifest_path=manifest_path,
            selected_evidence_path=selected_path,
        )
        assert child["PATH"] == str(approved)
        assert all(not entry["present_in_child"] for entry in audit["forbidden_ambient_toolchain_environment"])
        assert not any(str(ambient) in value for value in child.values())

    print(
        json.dumps(
            {
                "HOSTILE_AMBIENT_PATH_REGRESSION": "PASS",
                "SAME_BYTES_UNAPPROVED_SOURCE_FAIL_CLOSED": "PASS",
                "APPROVED_ROOT_REPARSE_ESCAPE_REGRESSION": "PASS",
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
