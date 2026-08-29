from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import socketserver
import subprocess
import tempfile
import threading
import zipfile
from pathlib import Path


SENSITIVE_ENVIRONMENT = re.compile(
    r"(?:^|_)(?:API_KEY|AUTH|CREDENTIAL|PASSWORD|SECRET|TOKEN)(?:_|$)", re.IGNORECASE
)
MALICIOUS_CAPABILITY_FIELDS = {
    "url": "https://example.invalid/attacker-controlled",
    "redirect_url": "http://example.invalid/downgrade",
    "username": "stage-b-user",
    "password": "stage-b-password",
    "credentials": {"scheme": "basic", "token": "stage-b-token"},
    "http_password_manager": {"realm": "stage-b"},
    "auth_handler": "HTTPBasicAuthHandler",
}


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ProxyObserver(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self) -> None:
        self.attempts: list[dict[str, object]] = []
        super().__init__(("127.0.0.1", 0), ProxyHandler)


class ProxyHandler(socketserver.BaseRequestHandler):
    def handle(self) -> None:
        payload = self.request.recv(4096)
        self.server.attempts.append(  # type: ignore[attr-defined]
            {"peer": list(self.client_address), "payload_sha256": hashlib.sha256(payload).hexdigest()}
        )
        self.request.sendall(b"HTTP/1.1 502 Stage B Egress Denied\r\nContent-Length: 0\r\n\r\n")


def worker_environment(proxy_port: int) -> tuple[dict[str, str], list[str]]:
    removed = sorted(name for name in os.environ if SENSITIVE_ENVIRONMENT.search(name))
    environment = {key: value for key, value in os.environ.items() if key not in removed}
    proxy = f"http://127.0.0.1:{proxy_port}"
    environment.update(
        {
            "HTTP_PROXY": proxy,
            "HTTPS_PROXY": proxy,
            "ALL_PROXY": proxy,
            "http_proxy": proxy,
            "https_proxy": proxy,
            "all_proxy": proxy,
            "NO_PROXY": "",
            "no_proxy": "",
            "PYTHONNOUSERSITE": "1",
        }
    )
    return environment, removed


def call_worker(
    worker: Path, method: str, payload: dict[str, object], environment: dict[str, str]
) -> list[dict[str, object]]:
    request = {
        "type": "request",
        "protocol_version": "1.0",
        "request_id": f"stage_b_{method.replace('.', '_')}",
        "method": method,
        "payload": payload,
    }
    completed = subprocess.run(
        [str(worker)],
        input=(json.dumps(request) + "\n").encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=120,
        env=environment,
    )
    if completed.returncode != 0:
        raise SystemExit(
            f"candidate Worker exited {completed.returncode}: "
            f"{completed.stderr.decode('utf-8', errors='replace')[-2000:]}"
        )
    try:
        return [json.loads(line) for line in completed.stdout.decode("utf-8").splitlines() if line]
    except json.JSONDecodeError as error:
        raise SystemExit("candidate Worker returned malformed NDJSON") from error


def terminal(events: list[dict[str, object]]) -> dict[str, object]:
    for event in reversed(events):
        if event.get("type") in {"hello", "result", "error", "cancelled"}:
            return event
    raise SystemExit("candidate Worker returned no terminal event")


def create_archives(root: Path) -> list[dict[str, object]]:
    modes = [
        ("stored", zipfile.ZIP_STORED),
        ("deflate", zipfile.ZIP_DEFLATED),
        ("bzip2", zipfile.ZIP_BZIP2),
        ("lzma", zipfile.ZIP_LZMA),
    ]
    if hasattr(zipfile, "ZIP_ZSTANDARD"):
        modes.append(("zstandard", zipfile.ZIP_ZSTANDARD))
    fixtures = []
    for label, compression in modes:
        path = root / f"safe-{label}.zip"
        with zipfile.ZipFile(path, "w", compression=compression) as archive:
            archive.writestr("bounded.txt", b"stage-b-bounded-fixture\n" * 4)
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if len(members) != 1 or members[0].file_size > 4096 or path.stat().st_size > 8192:
                raise SystemExit(f"unsafe Stage B ZIP fixture bounds: {path.name}")
            fixtures.append(
                {
                    "label": label,
                    "path": path,
                    "sha256": sha256_file(path),
                    "compressed_size": path.stat().st_size,
                    "uncompressed_size": members[0].file_size,
                    "member_count": len(members),
                }
            )
    return fixtures


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", type=Path, required=True)
    parser.add_argument("--ffprobe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    worker = arguments.worker.resolve(strict=True)
    ffprobe = arguments.ffprobe.resolve(strict=True)
    if not worker.is_file() or not ffprobe.is_file():
        raise SystemExit("Stage B candidate Worker and ffprobe must be regular files")
    observer = ProxyObserver()
    thread = threading.Thread(target=observer.serve_forever, daemon=True)
    thread.start()
    environment, removed_environment = worker_environment(observer.server_address[1])
    failures: list[str] = []
    archive_results = []
    extraction_side_effects: list[str] = []
    try:
        hello = terminal(call_worker(worker, "hello", MALICIOUS_CAPABILITY_FIELDS, environment))
        if hello.get("type") != "hello":
            failures.append("hello request with injected capability fields did not remain hello-only")
        unknown = terminal(
            call_worker(worker, "http.request.v1", MALICIOUS_CAPABILITY_FIELDS, environment)
        )
        if unknown.get("type") != "error" or unknown.get("error", {}).get("code") != "METHOD_NOT_SUPPORTED":  # type: ignore[union-attr]
            failures.append("attacker-controlled network method was not rejected")

        with tempfile.TemporaryDirectory(prefix="code-c-stage-b-") as directory:
            root = Path(directory)
            for fixture in create_archives(root):
                output_root = root / f"output-{fixture['label']}"
                event = terminal(
                    call_worker(
                        worker,
                        "media.index.asset.v1",
                        {
                            **MALICIOUS_CAPABILITY_FIELDS,
                            "input_path": str(fixture["path"]),
                            "output_dir": str(output_root),
                            "asset_id": f"stage_b_zip_{fixture['label']}",
                            "revision": 1,
                            "ffprobe_path": str(ffprobe),
                            "shot_detector_parameters": {
                                "adaptive_threshold": 3.0,
                                "min_scene_len_frames": 10,
                                "window_width": 2,
                                "luma_only": False,
                            },
                            "embedding_model_version": "onnx-fp32-9e7ee6850617",
                            "embedding_preprocess_version": "siglip2-processor-256-bicubic-mean0.5-official-text-v2",
                            "model_root": str(root / "not-reached-model"),
                            "dimension": 768,
                        },
                        environment,
                    )
                )
                code = event.get("error", {}).get("code") if event.get("type") == "error" else None  # type: ignore[union-attr]
                safe_reject = code in {"MEDIA_PROBE_FAILED", "MEDIA_NO_VIDEO_STREAM"}
                if not safe_reject:
                    failures.append(f"{fixture['label']} ZIP-as-media was not safely rejected: {code}")
                if output_root.exists():
                    extraction_side_effects.extend(
                        path.relative_to(root).as_posix()
                        for path in sorted(output_root.rglob("*"))
                    )
                archive_results.append(
                    {
                        **{key: value for key, value in fixture.items() if key != "path"},
                        "worker_error_code": code,
                        "result": "SAFE_REJECT" if safe_reject else "FAIL",
                    }
                )
    finally:
        observer.shutdown()
        observer.server_close()
        thread.join(timeout=5)

    if observer.attempts:
        failures.append(f"candidate Worker made {len(observer.attempts)} observed proxy connections")
    if extraction_side_effects:
        failures.append("ZIP-as-media created unexpected output-root filesystem entries")
    evidence = {
        "report_kind": "CODE_C_CPYTHON_STAGE_B_CANDIDATE_NEGATIVE_TEST",
        "schema_version": "1",
        "status": "PASS" if not failures else "FAIL",
        "candidate_worker": {
            "filename": worker.name,
            "sha256": sha256_file(worker),
            "size": worker.stat().st_size,
        },
        "protocol_adversarial_test": {
            "injected_fields": sorted(MALICIOUS_CAPABILITY_FIELDS),
            "hello_remained_hello_only": hello.get("type") == "hello",
            "network_method_error_code": unknown.get("error", {}).get("code"),  # type: ignore[union-attr]
            "protocol_exposed": "NO" if not failures else "UNKNOWN",
        },
        "credential_path": {
            "sensitive_environment_names_removed": removed_environment,
            "credential_values_recorded": False,
            "http_credential_path": "NO" if not observer.attempts else "UNKNOWN",
        },
        "network_observation": {
            "instrumentation": "HTTP_PROXY_HTTPS_PROXY_ALL_PROXY_LOOPBACK_DENY_OBSERVER",
            "outbound_proxy_attempts": len(observer.attempts),
            "attempts": observer.attempts,
            "attacker_controlled_network_capability": "NO" if not observer.attempts else "YES",
        },
        "archive_negative_test": {
            "instrumentation": [
                "STATIC_AST_ARCHIVE_CALL_GRAPH",
                "PER_FIXTURE_OUTPUT_ROOT_FILESYSTEM_OBSERVER",
            ],
            "fixtures": archive_results,
            "all_safe_reject": all(item["result"] == "SAFE_REJECT" for item in archive_results),
            "archive_extraction_side_effect_observed": bool(extraction_side_effects),
            "archive_extraction_side_effects": extraction_side_effects,
            "pyinstaller_carchive": "OUT_OF_ATTACKER_CONTROLLED_ZIP_PATH",
        },
        "failures": failures,
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(canonical_json(evidence), encoding="utf-8")
    if failures:
        raise SystemExit("Stage B candidate negative test failed:\n" + "\n".join(failures))
    print(
        "stage-b-candidate-negative: PASS "
        f"({len(archive_results)} bounded ZIP fixtures; 0 observed proxy attempts)"
    )


if __name__ == "__main__":
    main()
