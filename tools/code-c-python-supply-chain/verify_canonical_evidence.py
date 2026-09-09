from __future__ import annotations

import argparse
import base64
import json
import tempfile
from pathlib import Path

from canonical_evidence import (
    CANONICALIZATION_VERSION,
    CanonicalEvidenceError,
    canonical_json_bytes,
    sha256_bytes,
    verify_canonical_file,
    write_canonical_json,
)


GOLDEN_VALUE = {
    "z_empty_object": {},
    "path": "directory with spaces/证据-é.json",
    "empty_array": [],
    "nested": {"中文": "跨平台", "alpha": "évidence"},
}
EXPECTED_CANONICAL_BYTES = (
    b'{\n'
    b'  "empty_array": [],\n'
    b'  "nested": {\n'
    b'    "alpha": "\xc3\xa9vidence",\n'
    b'    "\xe4\xb8\xad\xe6\x96\x87": "\xe8\xb7\xa8\xe5\xb9\xb3\xe5\x8f\xb0"\n'
    b'  },\n'
    b'  "path": "directory with spaces/\xe8\xaf\x81\xe6\x8d\xae-\xc3\xa9.json",\n'
    b'  "z_empty_object": {}\n'
    b'}\n'
)
EXPECTED_CANONICAL_SHA256 = "fbd6ddd4a49c96d78d365f69b1ea3218ffeb7a9a4756345e93b4678f97a40f54"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    arguments = parser.parse_args()
    actual = canonical_json_bytes(GOLDEN_VALUE)
    actual_sha256 = sha256_bytes(actual)
    if actual != EXPECTED_CANONICAL_BYTES:
        raise SystemExit("canonical golden bytes drift")
    if actual_sha256 != EXPECTED_CANONICAL_SHA256:
        raise SystemExit("canonical golden SHA-256 drift")
    with tempfile.TemporaryDirectory(prefix="code c canonical evidence ") as root:
        output = Path(root) / "path with spaces" / "证据.json"
        result = write_canonical_json(output, GOLDEN_VALUE)
        replacement_result = write_canonical_json(output, GOLDEN_VALUE)
        if b"\r\n" in output.read_bytes():
            raise SystemExit("canonical evidence contains CRLF structure bytes")
        tampered = output.with_name("证据-crlf-tampered.json")
        tampered.write_bytes(output.read_bytes().replace(b"\n", b"\r\n"))
        tamper_failed_closed = False
        try:
            verify_canonical_file(tampered, actual)
        except CanonicalEvidenceError:
            tamper_failed_closed = True
        if not tamper_failed_closed:
            raise SystemExit("CRLF tamper did not fail closed")
        report = {
            "canonicalization_version": CANONICALIZATION_VERSION,
            "canonical_bytes_base64": base64.b64encode(actual).decode("ascii"),
            "canonical_payload_sha256": result.canonical_payload_sha256,
            "canonical_file_sha256": result.canonical_file_sha256,
            "canonical_payload_file_hash_equal": result.canonical_payload_file_hash_equal,
            "in_memory_file_byte_identity": result.in_memory_file_byte_identity,
            "temp_file_same_directory": result.temp_file_same_directory,
            "atomic_replace": result.atomic_replace and replacement_result.atomic_replace,
            "crlf_tamper_fail_closed": tamper_failed_closed,
            "unicode_canonical_hash_portability": True,
            "path_with_spaces_regression": True,
            "canonical_golden_vector": True,
        }
    rendered = json.dumps(report, ensure_ascii=False, sort_keys=True)
    if arguments.output:
        Path(arguments.output).write_bytes((rendered + "\n").encode("utf-8"))
    print(rendered)


if __name__ == "__main__":
    main()
