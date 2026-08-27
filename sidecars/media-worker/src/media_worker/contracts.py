from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any


class WorkerError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_json(path: Path, value: Any) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = canonical_json(value).encode("utf-8")
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    try:
        with temporary.open("wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return sha256_bytes(payload)


def require_contained_file(root: Path, relative_path: str) -> Path:
    if Path(relative_path).is_absolute():
        raise WorkerError("ARTIFACT_PATH_INVALID", "Artifact path must be relative")
    resolved_root = root.resolve(strict=True)
    resolved = (resolved_root / relative_path).resolve(strict=True)
    try:
        resolved.relative_to(resolved_root)
    except ValueError as error:
        raise WorkerError("ARTIFACT_PATH_ESCAPE", "Artifact escaped its job directory") from error
    if not resolved.is_file() or resolved.is_symlink():
        raise WorkerError("ARTIFACT_PATH_INVALID", "Artifact is not a regular file")
    return resolved


def map_os_error(error: OSError) -> WorkerError:
    if error.errno == 28:
        return WorkerError("DISK_FULL", "Job output storage is full", True)
    if error.errno in {1, 13}:
        return WorkerError("OUTPUT_PERMISSION_DENIED", "Job output is not writable", False)
    return WorkerError("FILESYSTEM_ERROR", "Media job filesystem operation failed", True)
