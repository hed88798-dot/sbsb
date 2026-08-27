from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest


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


if __name__ == "__main__":
    unittest.main()
