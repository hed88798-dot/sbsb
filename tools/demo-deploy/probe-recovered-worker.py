"""Execute the unchanged retained Worker in a temporary Windows review runner."""

from __future__ import annotations

import hashlib
import json
import platform
import subprocess
from pathlib import Path

ROOT = Path("artifacts/worker-recovery")
WORKER_HASH = "ba6b81f433beef8ee95615a45248251918a18a602b53f8db9ec02e35cf76d8b1"


def main() -> None:
    if platform.system() != "Windows" or platform.machine().lower() not in {"amd64", "x86_64"}:
        raise SystemExit("WINDOWS_X64_REQUIRED")
    worker = (ROOT / "media-worker.exe").resolve(strict=True)
    if hashlib.sha256(worker.read_bytes()).hexdigest() != WORKER_HASH:
        raise SystemExit("WORKER_IDENTITY_CHANGED")
    result = subprocess.run([str(worker), "--runtime-smoke"], capture_output=True, timeout=120, check=False)
    (ROOT / "runtime-smoke.stdout.txt").write_bytes(result.stdout)
    (ROOT / "runtime-smoke.stderr.txt").write_bytes(result.stderr)
    if result.returncode != 0:
        raise SystemExit(f"WORKER_RUNTIME_SMOKE_EXIT:{result.returncode}")
    smoke = json.loads(result.stdout.decode("utf-8", errors="strict"))
    if smoke.get("status") != "PASS" or smoke.get("python") != "3.13.15" or smoke.get("onnxruntime") != "1.29.0" or smoke.get("contains_torch") or smoke.get("contains_transformers") or "CPUExecutionProvider" not in smoke.get("providers", []):
        raise SystemExit("WORKER_RUNTIME_SMOKE_IDENTITY_FAILED")
    request = {"type": "request", "protocol_version": "1.0", "request_id": "recovered_worker_hello", "method": "hello", "payload": {}}
    hello = subprocess.run([str(worker)], input=(json.dumps(request) + "\n").encode(), capture_output=True, timeout=120, check=False)
    (ROOT / "hello.stdout.txt").write_bytes(hello.stdout)
    (ROOT / "hello.stderr.txt").write_bytes(hello.stderr)
    if hello.returncode != 0:
        raise SystemExit(f"WORKER_HELLO_EXIT:{hello.returncode}")
    response = json.loads(hello.stdout.decode("utf-8", errors="strict"))
    if response.get("type") != "hello" or response.get("protocol_version") != "1.0":
        raise SystemExit("WORKER_HELLO_PROTOCOL_FAILED")
    report = {"status": "PASS", "worker_sha256": WORKER_HASH, "runtime_smoke": smoke, "hello": response, "rebuild": False, "release_approved": False, "paid_provider_requests": 0}
    (ROOT / "fresh-runtime-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("RECOVERED_WORKER_RUNTIME:PASS; RELEASE_APPROVAL:PENDING")


if __name__ == "__main__":
    main()
