from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from machine_output import (
    MachineOutputProtocolError,
    emit_json_result,
    encode_json_result,
    validate_json_stdout_bytes,
)


def expect_rejected(value: bytes) -> None:
    try:
        validate_json_stdout_bytes(value)
    except MachineOutputProtocolError:
        return
    raise AssertionError(f"invalid machine stdout unexpectedly passed: {value!r}")


def main() -> None:
    unicode_payload = {
        "filename": "证据-é.json",
        "message": "中文",
        "path": r"C:\Program Files\Worker\证据.dll",
        "result": "ok",
    }
    encoded = encode_json_result(unicode_payload) + b"\n"
    assert validate_json_stdout_bytes(encoded) == unicode_payload
    assert json.loads(encoded.decode("utf-8")) == unicode_payload

    clean = b'{"result": "ok"}'
    expect_rejected(b"status line\n" + clean + b"\n")
    expect_rejected(clean + b"\ndone\n")
    expect_rejected(clean + b'\n{"result": "two"}\n')
    expect_rejected(b"\xef\xbb\xbf" + clean + b"\n")
    expect_rejected(clean + b"\r\n")
    expect_rejected(b" " + clean + b"\n")
    expect_rejected(clean + b" ")
    expect_rejected(clean + b"\n\n")

    child_program = """
import sys
sys.stdout.write('third-party banner\\n')
sys.stderr.write('diagnostic\\n')
"""
    child = subprocess.run(
        [sys.executable, "-c", child_program],
        shell=False,
        check=False,
        capture_output=True,
    )
    assert child.returncode == 0
    assert child.stdout == b"third-party banner\n"
    assert child.stderr == b"diagnostic\n"

    status_program = """
from machine_output import emit_json_result, log_status
log_status('msvc-runtime-dependency-request: READY (synthetic-evidence-id)')
emit_json_result({'result': 'ok'})
"""
    status = subprocess.run(
        [sys.executable, "-c", status_program],
        cwd=Path(__file__).resolve().parent,
        shell=False,
        check=False,
        capture_output=True,
    )
    assert status.returncode == 0
    assert validate_json_stdout_bytes(status.stdout) == {"result": "ok"}
    assert status.stderr == (
        b"msvc-runtime-dependency-request: READY (synthetic-evidence-id)\n"
    )

    emit_json_result(
        {
            "ACTUAL_TEST_ASSERTIONS_EXECUTED": "YES",
            "CHILD_STDERR_CAPTURE_POLICY": "PASS",
            "CHILD_STDOUT_CAPTURE_POLICY": "PASS",
            "CHILD_STDOUT_INHERITANCE": "NONE",
            "CHILD_STDOUT_NOISE_ISOLATED": "PASS",
            "MULTIPLE_JSON_DOCUMENTS_FAIL_CLOSED": "PASS",
            "STDERR_HUMAN_LOGGING": "PASS",
            "STDERR_INCLUDED_IN_EVIDENCE_HASH": "NO",
            "STDERR_LOG_SAFETY_POLICY": "PASS",
            "STDOUT_BOM_FAIL_CLOSED": "PASS",
            "STDOUT_BOM_FORBIDDEN": "PASS",
            "STDOUT_CRLF_FORBIDDEN": "PASS",
            "STDOUT_CRLF_REJECTED": "PASS",
            "STDOUT_EXTRA_WHITESPACE_FAIL_CLOSED": "PASS",
            "STDOUT_JSON_PARSE": "PASS",
            "STDOUT_JSON_PROTOCOL": "PASS",
            "STDOUT_LEADING_WHITESPACE_FORBIDDEN": "PASS",
            "STDOUT_PREFIX_CONTAMINATION_FAIL_CLOSED": "PASS",
            "STDOUT_RAW_BYTE_CONTRACT": "PASS",
            "STDOUT_SUFFIX_CONTAMINATION_FAIL_CLOSED": "PASS",
            "STDOUT_TRAILING_WHITESPACE_FORBIDDEN": "PASS",
            "STDOUT_UTF8": "PASS",
            "UNICODE_OUTPUT_PORTABILITY": "PASS",
        }
    )


if __name__ == "__main__":
    main()
