from __future__ import annotations

import hashlib
import os
from pathlib import Path

from canonical_evidence import canonical_sha256


NATIVE_SUFFIXES = (".dll", ".pyd", ".dylib", ".so")


class HermeticBuildError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def is_native_path(path: Path | str) -> bool:
    name = str(path).replace("\\", "/").rsplit("/", 1)[-1].lower()
    return name.endswith(NATIVE_SUFFIXES) or ".so." in name


def normalized_realpath(path: Path | str, *, strict: bool = True) -> str:
    resolved = Path(path).resolve(strict=strict)
    value = os.path.normcase(os.path.normpath(str(resolved)))
    if os.name == "nt" and value.startswith("\\\\?\\unc\\"):
        value = "\\\\" + value[8:]
    elif os.name == "nt" and value.startswith("\\\\?\\"):
        value = value[4:]
    return value


def environment_manifest_identity(manifest: dict[str, object]) -> dict[str, object]:
    excluded = {
        "build_environment_manifest_id",
        "build_environment_identity_sha256",
        "created_at",
        "summary",
    }
    return {key: value for key, value in manifest.items() if key not in excluded}


def verify_environment_manifest_identity(manifest: dict[str, object]) -> None:
    identity_sha256 = canonical_sha256(environment_manifest_identity(manifest))
    expected_id = f"code-c-build-environment-{identity_sha256[:32]}"
    if (
        manifest.get("build_environment_identity_sha256") != identity_sha256
        or manifest.get("build_environment_manifest_id") != expected_id
    ):
        raise HermeticBuildError("Build Environment Manifest identity verification failed")


def path_is_within(path: Path | str, root: Path | str) -> bool:
    candidate = normalized_realpath(path)
    approved_root = normalized_realpath(root)
    try:
        return os.path.commonpath([candidate, approved_root]) == approved_root
    except ValueError:
        return False


def attest_python_search_path(
    path: Path | str,
    *,
    worker_root: Path | str,
    base_root: Path | str,
    optional_standard_library_zip_name: str,
) -> dict[str, object]:
    candidate = Path(path)
    try:
        candidate.lstat()
    except FileNotFoundError:
        expected = Path(base_root) / optional_standard_library_zip_name
        candidate_key = os.path.normcase(os.path.abspath(os.path.normpath(str(candidate))))
        expected_key = os.path.normcase(os.path.abspath(os.path.normpath(str(expected))))
        if candidate_key != expected_key:
            raise HermeticBuildError(f"Python search root does not exist: {candidate}")
        if normalized_realpath(candidate.parent) != normalized_realpath(base_root):
            raise HermeticBuildError(
                f"optional standard-library zip parent is not the locked CPython root: {candidate}"
            )
        return {
            "path": str(candidate),
            "status": "NOT_PRESENT_OPTIONAL_STANDARD_LIBRARY_ZIP",
            "realpath": None,
        }
    except OSError as error:
        raise HermeticBuildError(f"Python search root is unreadable: {candidate}") from error

    resolved = normalized_realpath(candidate)
    if not any(path_is_within(resolved, root) for root in (worker_root, base_root)):
        raise HermeticBuildError(
            f"Python search root resolves outside approved interpreter roots: {candidate} -> {resolved}"
        )
    return {
        "path": str(candidate),
        "status": "PRESENT_APPROVED_INTERPRETER_ROOT",
        "realpath": resolved,
    }


def approved_source_entry(
    source_path: Path | str,
    source_sha256: str,
    manifest: dict[str, object],
) -> dict[str, object]:
    source = Path(source_path)
    if not source.is_file():
        raise HermeticBuildError(f"selected native source is not a file: {source}")
    resolved = normalized_realpath(source)
    roots = [entry["realpath"] for entry in manifest["packaging_approved_source_roots"]]
    if not any(path_is_within(resolved, root) for root in roots):
        raise HermeticBuildError(
            f"selected native source resolves outside packaging-approved roots: {source} -> {resolved}"
        )
    file_entries = manifest["approved_source_file_manifest"]
    path_matches = [entry for entry in file_entries if entry["resolved_path_key"] == resolved]
    if len(path_matches) != 1:
        hash_matches = [entry for entry in file_entries if entry["sha256"] == source_sha256]
        suffix = (
            f"; {len(hash_matches)} approved file(s) have the same bytes at different paths"
            if hash_matches
            else ""
        )
        raise HermeticBuildError(
            f"selected native source has no unique file-level provenance entry: {source}{suffix}"
        )
    entry = path_matches[0]
    if entry["sha256"] != source_sha256:
        raise HermeticBuildError(f"selected native source hash differs from manifest: {source}")
    if not entry.get("source_artifact_identity"):
        raise HermeticBuildError(f"selected native source has no artifact identity: {source}")
    return entry


def environment_value(environment: dict[str, str], name: str) -> str | None:
    for key, value in environment.items():
        if key.upper() == name.upper():
            return value
    return None


def build_child_environment(
    parent: dict[str, str],
    *,
    path_entries: list[str],
    cache_root: Path,
    worker_root: Path,
    manifest_path: Path,
    selected_evidence_path: Path,
    repository_root: Path,
) -> tuple[dict[str, str], dict[str, object]]:
    required_names = (
        "SYSTEMROOT",
        "WINDIR",
        "COMSPEC",
        "TEMP",
        "TMP",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "APPDATA",
        "LOCALAPPDATA",
        "PROGRAMDATA",
        "PATHEXT",
        "OS",
        "PROCESSOR_ARCHITECTURE",
        "NUMBER_OF_PROCESSORS",
        "CI",
        "GITHUB_ACTIONS",
        "GITHUB_WORKSPACE",
        "IMAGEOS",
        "IMAGEVERSION",
        "RUNNER_OS",
        "RUNNER_ARCH",
        "SSL_CERT_FILE",
        "REQUESTS_CA_BUNDLE",
    )
    child: dict[str, str] = {}
    copied = []
    for name in required_names:
        value = environment_value(parent, name)
        if value:
            child[name] = value
            copied.append(name)
    child.update(
        {
            "PATH": os.pathsep.join(path_entries),
            "VIRTUAL_ENV": str(worker_root),
            "PYTHONNOUSERSITE": "1",
            "PYTHONUTF8": "1",
            "PYTHONIOENCODING": "utf-8",
            "PYINSTALLER_CONFIG_DIR": str(cache_root),
            "CODE_C_BUILD_ENVIRONMENT_MANIFEST": str(manifest_path),
            "CODE_C_PREPACKAGE_SELECTED_EVIDENCE": str(selected_evidence_path),
            "CODE_C_REPOSITORY_ROOT": str(repository_root),
        }
    )
    forbidden = ("JAVA_HOME", "MAGICK_HOME", "CONDA_PREFIX", "PYTHONPATH", "PYTHONHOME")
    audit = {
        "required_os_environment_copied": sorted(copied),
        "forbidden_ambient_toolchain_environment": [
            {
                "name": name,
                "present_in_parent": bool(environment_value(parent, name)),
                "present_in_child": bool(environment_value(child, name)),
            }
            for name in forbidden
        ],
        "virtual_environment_binding": {
            "parent_value_present": bool(environment_value(parent, "VIRTUAL_ENV")),
            "child_value": str(worker_root),
            "disposition": "REPLACED_WITH_APPROVED_WORKER_ENVIRONMENT",
        },
    }
    return child, audit
