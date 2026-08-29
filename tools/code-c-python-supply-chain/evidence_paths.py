from __future__ import annotations

import os
from enum import Enum
from pathlib import Path, PurePosixPath, PureWindowsPath


class EvidencePathError(RuntimeError):
    pass


class EvidencePathAnchor(str, Enum):
    REPOSITORY_ROOT = "REPOSITORY_ROOT"
    EVIDENCE_OUTPUT_ROOT = "EVIDENCE_OUTPUT_ROOT"
    ABSOLUTE_RUNTIME_PROVENANCE = "ABSOLUTE_RUNTIME_PROVENANCE"


# These are the path-bearing fields emitted by the current Code C Build Context,
# Build Environment Manifest, and PyInstaller build-evidence producers. Relative
# identities are deliberately classified per field instead of acquiring a global
# "relative means repository-relative" interpretation.
FORMAL_PATH_ANCHORS = {
    "build_context.inputs.wheel_inventories[].path": EvidencePathAnchor.REPOSITORY_ROOT,
    "build_context.inputs.runtime_identity.path": EvidencePathAnchor.REPOSITORY_ROOT,
    "build_context.inputs.specification.path": EvidencePathAnchor.REPOSITORY_ROOT,
    "build_context.inputs.build_environment_manifest.path": EvidencePathAnchor.REPOSITORY_ROOT,
    "build_context.inputs.build_settings.workpath": EvidencePathAnchor.REPOSITORY_ROOT,
    "build_context.inputs.build_settings.distpath": EvidencePathAnchor.REPOSITORY_ROOT,
    "build_environment.runtime_anchors.repository_root": (
        EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
    ),
    "build_environment.packaging_approved_source_roots[].realpath": (
        EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
    ),
    "build_environment.approved_source_file_manifest[].resolved_path": (
        EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
    ),
    "build_environment.pyinstaller.pathex[]": EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE,
    "build_environment.pyinstaller.hook_search_roots[]": (
        EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
    ),
    "build_environment.pyinstaller.workpath": EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE,
    "build_environment.pyinstaller.distpath": EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE,
    "build_environment.pyinstaller.cache_config_root": (
        EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
    ),
    "build_environment.pyinstaller.spec": EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE,
    "build_environment.pyinstaller.selected_evidence": (
        EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
    ),
    "build_environment.pyinstaller.build_context": (
        EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
    ),
    "build_environment.pyinstaller.msvc_runtime_evidence": (
        EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
    ),
    "build_environment.pyinstaller.msvc_runtime_approval_request": (
        EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
    ),
    "pyinstaller_build_evidence.raw_evidence.*.source_path": (
        EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE
    ),
    "pyinstaller_build_evidence.raw_evidence.*.preserved_path": (
        EvidencePathAnchor.EVIDENCE_OUTPUT_ROOT
    ),
    "pyinstaller_build_evidence.selected_native_set.path": (
        EvidencePathAnchor.EVIDENCE_OUTPUT_ROOT
    ),
    "pyinstaller_build_evidence.materialized_native_set.path": (
        EvidencePathAnchor.EVIDENCE_OUTPUT_ROOT
    ),
    "pyinstaller_build_evidence.workpath": EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE,
    "pyinstaller_build_evidence.distpath": EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE,
}


def declared_anchor(field: str) -> EvidencePathAnchor:
    try:
        return FORMAL_PATH_ANCHORS[field]
    except KeyError as error:
        raise EvidencePathError(f"formal evidence path has no declared anchor: {field}") from error


def _path_key(path: Path | str) -> str:
    value = os.path.normcase(os.path.normpath(str(path)))
    if os.name == "nt" and value.startswith("\\\\?\\unc\\"):
        value = "\\\\" + value[8:]
    elif os.name == "nt" and value.startswith("\\\\?\\"):
        value = value[4:]
    return value


def _absolute_anchor(value: Path | str, label: str, *, must_exist: bool = True) -> Path:
    anchor = Path(value)
    if not anchor.is_absolute():
        raise EvidencePathError(f"{label} must be an explicit absolute runtime anchor")
    try:
        return anchor.resolve(strict=must_exist)
    except OSError as error:
        raise EvidencePathError(f"{label} is unavailable: {anchor}") from error


def _relative_parts(value: object, field: str) -> tuple[str, ...]:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise EvidencePathError(f"formal evidence path is empty or unreadable: {field}")
    if "\\" in value:
        raise EvidencePathError(f"formal relative evidence path is not canonical POSIX form: {field}")
    windows = PureWindowsPath(value)
    posix = PurePosixPath(value)
    if windows.drive or windows.root or windows.is_absolute() or posix.is_absolute():
        raise EvidencePathError(f"absolute, drive, or UNC injection in formal evidence path: {field}")
    raw_parts = value.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        raise EvidencePathError(f"lexically unsafe formal evidence path: {field}")
    if tuple(raw_parts) != posix.parts:
        raise EvidencePathError(f"formal evidence path cannot be normalized safely: {field}")
    return tuple(raw_parts)


def _within(candidate: Path | str, scope: Path | str) -> bool:
    try:
        return os.path.commonpath([_path_key(candidate), _path_key(scope)]) == _path_key(scope)
    except ValueError:
        return False


def resolve_evidence_path(
    declared_path: object,
    *,
    field: str,
    trusted_runtime_anchors: dict[str, Path | str],
    expected_scope: Path | str | None = None,
    filesystem_identity: bool,
) -> Path:
    anchor_type = declared_anchor(field)
    if anchor_type == EvidencePathAnchor.ABSOLUTE_RUNTIME_PROVENANCE:
        candidate = _absolute_anchor(
            str(declared_path), field, must_exist=filesystem_identity
        )
        if expected_scope is not None:
            scope = _absolute_anchor(expected_scope, f"{field} expected scope")
            if not _within(candidate, scope):
                raise EvidencePathError(f"formal absolute evidence path escapes its scope: {field}")
        return candidate

    anchor_name = {
        EvidencePathAnchor.REPOSITORY_ROOT: "repository_root",
        EvidencePathAnchor.EVIDENCE_OUTPUT_ROOT: "evidence_output_root",
    }.get(anchor_type)
    if not anchor_name or anchor_name not in trusted_runtime_anchors:
        raise EvidencePathError(f"trusted runtime anchor is missing for formal evidence path: {field}")
    anchor = _absolute_anchor(
        trusted_runtime_anchors[anchor_name], f"{field} {anchor_name}"
    )
    scope = _absolute_anchor(
        expected_scope if expected_scope is not None else anchor,
        f"{field} expected scope",
    )
    parts = _relative_parts(declared_path, field)
    candidate = Path(os.path.normpath(str(anchor.joinpath(*parts))))
    if not candidate.is_absolute() or not _within(candidate, scope):
        raise EvidencePathError(f"lexical evidence path escape: {field}")
    if not filesystem_identity:
        return candidate
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise EvidencePathError(f"formal evidence path is unavailable: {field}") from error
    resolved_scope = scope.resolve(strict=True)
    if not _within(resolved, resolved_scope):
        raise EvidencePathError(f"filesystem identity escapes approved scope: {field}")
    return resolved


def repository_relative_identity(
    source: Path | str,
    *,
    repository_root: Path | str,
    field: str,
    filesystem_identity: bool = True,
) -> str:
    root = _absolute_anchor(repository_root, "repository_root")
    value = Path(source)
    if value.is_absolute():
        try:
            resolved = value.resolve(strict=filesystem_identity)
        except OSError as error:
            raise EvidencePathError(f"formal evidence source is unavailable: {field}") from error
        if not _within(resolved, root):
            raise EvidencePathError(f"formal evidence source escapes repository root: {field}")
        return resolved.relative_to(root).as_posix()
    candidate = resolve_evidence_path(
        value.as_posix(),
        field=field,
        trusted_runtime_anchors={"repository_root": root},
        expected_scope=root,
        filesystem_identity=filesystem_identity,
    )
    return candidate.relative_to(root).as_posix()


def resolve_repository_cli_path(
    source: Path | str,
    *,
    repository_root: Path | str,
    label: str,
    filesystem_identity: bool,
) -> Path:
    """Resolve a producer CLI path from its explicitly supplied repository anchor.

    CLI paths are not themselves evidence fields, so this helper does not assign
    them a contract anchor. It prevents an evidence producer from acquiring CWD
    semantics before it serializes a formally classified path.
    """

    root = _absolute_anchor(repository_root, "repository_root")
    value = Path(source)
    if value.is_absolute():
        try:
            candidate = value.resolve(strict=filesystem_identity)
        except OSError as error:
            raise EvidencePathError(f"producer CLI path is unavailable: {label}") from error
        if not _within(candidate, root):
            raise EvidencePathError(f"producer CLI path escapes repository root: {label}")
        return candidate
    parts = _relative_parts(value.as_posix(), label)
    candidate = Path(os.path.normpath(str(root.joinpath(*parts))))
    if not _within(candidate, root):
        raise EvidencePathError(f"producer CLI path escapes repository root: {label}")
    if not filesystem_identity:
        return candidate
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise EvidencePathError(f"producer CLI path is unavailable: {label}") from error
    if not _within(resolved, root):
        raise EvidencePathError(f"producer CLI path filesystem escape: {label}")
    return resolved


def verify_repository_future_path(
    path: Path | str, *, repository_root: Path | str, label: str
) -> Path:
    root = _absolute_anchor(repository_root, "repository_root")
    candidate = Path(path)
    if not candidate.is_absolute() or not _within(candidate, root):
        raise EvidencePathError(f"future producer path is not lexically repository-scoped: {label}")
    candidate.parent.mkdir(parents=True, exist_ok=True)
    try:
        resolved_parent = candidate.parent.resolve(strict=True)
    except OSError as error:
        raise EvidencePathError(f"future producer path parent is unavailable: {label}") from error
    if not _within(resolved_parent, root):
        raise EvidencePathError(f"future producer path parent escapes repository root: {label}")
    return resolved_parent / candidate.name


def runtime_repository_root(
    manifest: dict[str, object], *, explicit_repository_root: Path | str | None = None
) -> Path:
    try:
        declared = manifest["runtime_anchors"]["repository_root"]
    except (KeyError, TypeError) as error:
        raise EvidencePathError("Build Environment Manifest lacks an explicit repository root") from error
    root = resolve_evidence_path(
        declared,
        field="build_environment.runtime_anchors.repository_root",
        trusted_runtime_anchors={},
        filesystem_identity=True,
    )
    if explicit_repository_root is not None:
        explicit = _absolute_anchor(explicit_repository_root, "explicit repository_root")
        if _path_key(explicit) != _path_key(root):
            raise EvidencePathError("explicit repository root does not match frozen runtime anchor")
    return root


def same_filesystem_identity(left: Path | str, right: Path | str) -> bool:
    try:
        left_path = _absolute_anchor(left, "left filesystem identity")
        right_path = _absolute_anchor(right, "right filesystem identity")
    except EvidencePathError:
        return False
    return _path_key(left_path) == _path_key(right_path)
