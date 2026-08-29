from __future__ import annotations

import json
import sys
from typing import BinaryIO


class MachineOutputProtocolError(ValueError):
    pass


def encode_json_result(payload: object) -> bytes:
    """Encode the existing regression result format without changing its JSON shape."""
    return json.dumps(payload, sort_keys=True).encode("utf-8")


def emit_json_result(payload: object, stream: BinaryIO | None = None) -> None:
    output = stream if stream is not None else sys.stdout.buffer
    output.write(encode_json_result(payload) + b"\n")
    output.flush()


def log_status(message: str) -> None:
    if not isinstance(message, str) or not message or "\n" in message or "\r" in message:
        raise ValueError("status messages must be non-empty single lines")
    print(message, file=sys.stderr, flush=True)


def validate_json_stdout_bytes(value: bytes) -> object:
    if value.startswith(b"\xef\xbb\xbf"):
        raise MachineOutputProtocolError("UTF-8 BOM is forbidden")
    if b"\r" in value:
        raise MachineOutputProtocolError("carriage returns are forbidden")
    if not value:
        raise MachineOutputProtocolError("machine stdout is empty")
    if value[:1].isspace():
        raise MachineOutputProtocolError("leading whitespace is forbidden")
    if value.endswith(b"\n\n"):
        raise MachineOutputProtocolError("more than one trailing LF is forbidden")

    document = value[:-1] if value.endswith(b"\n") else value
    if not document:
        raise MachineOutputProtocolError("JSON document is empty")
    if document[-1:] in {b" ", b"\t", b"\n"}:
        raise MachineOutputProtocolError("trailing whitespace is forbidden")
    try:
        text = document.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise MachineOutputProtocolError("stdout is not strict UTF-8") from error

    decoder = json.JSONDecoder()
    try:
        parsed, end = decoder.raw_decode(text)
    except json.JSONDecodeError as error:
        raise MachineOutputProtocolError("stdout is not a JSON document") from error
    if end != len(text):
        raise MachineOutputProtocolError(
            "stdout contains a suffix or more than one JSON document"
        )
    return parsed
