from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import unittest
from unittest.mock import patch

from media_worker import worker
from media_worker.contracts import WorkerError


class WorkerContractTests(unittest.TestCase):
    def call(self, method: str) -> list[dict[str, object]]:
        request = {
            "type": "request",
            "protocol_version": "1.0",
            "request_id": f"worker_{method}",
            "method": method,
            "payload": {},
        }
        completed = subprocess.run(
            [sys.executable, "-m", "media_worker"],
            input=(json.dumps(request) + "\n").encode(),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
            shell=False,
            timeout=10,
            env=os.environ.copy(),
        )
        return [json.loads(line) for line in completed.stdout.decode().splitlines()]

    def test_hello_advertises_only_owned_capabilities(self) -> None:
        events = self.call("hello")
        self.assertEqual(events[-1]["type"], "hello")
        self.assertEqual(events[-1]["protocol_version"], "1.0")
        self.assertEqual(
            events[-1]["payload"]["capabilities"],
            ["media.index.asset.v1", "media.search.exact.v1"],
        )

    def test_unknown_method_fails_with_stable_code(self) -> None:
        events = self.call("not-owned.v1")
        self.assertEqual(events[-1]["type"], "error")
        self.assertEqual(events[-1]["error"]["code"], "METHOD_NOT_SUPPORTED")

    def test_unexpected_value_error_is_not_misreported_as_request_invalid(self) -> None:
        request = {
            "type": "request",
            "protocol_version": "1.0",
            "request_id": "runtime_error",
            "method": "media.search.exact.v1",
            "payload": {},
        }
        output = io.StringIO()
        with patch.object(worker, "handle", side_effect=ValueError("text model failure")), patch.object(
            worker.sys, "stdin", io.StringIO(json.dumps(request) + "\n")
        ), patch.object(worker.sys, "stdout", output):
            worker.main()
        event = json.loads(output.getvalue())
        self.assertEqual(event["error"]["code"], "WORKER_INTERNAL")
        self.assertIn("ValueError", event["error"]["message"])

    def test_search_rejects_explicit_non_positive_dimension(self) -> None:
        with self.assertRaises(WorkerError) as context:
            worker._search_payload(
                {
                    "cache_root": "/tmp/cache",
                    "signature_hash": "a" * 64,
                    "model_root": "/tmp/model",
                    "query_text": "猪场",
                    "dimension": 0,
                }
            )
        self.assertEqual(context.exception.code, "REQUEST_INVALID")


if __name__ == "__main__":
    unittest.main()
