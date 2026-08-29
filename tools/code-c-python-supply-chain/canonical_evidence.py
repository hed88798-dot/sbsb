from __future__ import annotations

import hashlib
import json
import os
import stat
import tempfile
from dataclasses import dataclass
from pathlib import Path


CANONICALIZATION_VERSION = "json-utf8-lf-v1"
CANONICAL_ENCODING = "utf-8"


class CanonicalEvidenceError(RuntimeError):
    pass


@dataclass(frozen=True)
class CanonicalWriteResult:
    canonical_payload_sha256: str
    canonical_file_sha256: str
    canonical_payload_file_hash_equal: bool
    in_memory_file_byte_identity: bool
    temp_file_same_directory: bool
    atomic_replace: bool


def canonical_json(value: object) -> str:
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ": "),
            allow_nan=False,
            indent=2,
        )
        + "\n"
    )


def canonical_json_bytes(value: object) -> bytes:
    return canonical_json(value).encode(CANONICAL_ENCODING)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_sha256(value: object) -> str:
    return sha256_bytes(canonical_json_bytes(value))


def verify_canonical_file(path: Path, canonical_bytes: bytes) -> CanonicalWriteResult:
    actual_bytes = path.read_bytes()
    payload_sha256 = sha256_bytes(canonical_bytes)
    file_sha256 = sha256_bytes(actual_bytes)
    bytes_match = actual_bytes == canonical_bytes
    hash_match = file_sha256 == payload_sha256
    if not bytes_match or not hash_match:
        raise CanonicalEvidenceError(
            f"canonical evidence byte drift: {path} "
            f"(payload_sha256={payload_sha256}; file_sha256={file_sha256})"
        )
    return CanonicalWriteResult(
        canonical_payload_sha256=payload_sha256,
        canonical_file_sha256=file_sha256,
        canonical_payload_file_hash_equal=hash_match,
        in_memory_file_byte_identity=bytes_match,
        temp_file_same_directory=False,
        atomic_replace=False,
    )


def write_canonical_json(path: Path, value: object) -> CanonicalWriteResult:
    canonical_bytes = canonical_json_bytes(value)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    temp_same_directory = temporary_path.parent.resolve() == path.parent.resolve()
    replaced = False
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(canonical_bytes)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary_path, stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o644)
        verify_canonical_file(temporary_path, canonical_bytes)
        os.replace(temporary_path, path)
        replaced = True
        result = verify_canonical_file(path, canonical_bytes)
        return CanonicalWriteResult(
            canonical_payload_sha256=result.canonical_payload_sha256,
            canonical_file_sha256=result.canonical_file_sha256,
            canonical_payload_file_hash_equal=result.canonical_payload_file_hash_equal,
            in_memory_file_byte_identity=result.in_memory_file_byte_identity,
            temp_file_same_directory=temp_same_directory,
            atomic_replace=replaced,
        )
    finally:
        if not replaced:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass
