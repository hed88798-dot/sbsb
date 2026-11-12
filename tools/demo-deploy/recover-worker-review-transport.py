"""Restore only the exact retained Worker for isolated review, never approve it."""

from __future__ import annotations

import hashlib
import json
import os
import struct
import urllib.request
import zipfile
from pathlib import Path

REPOSITORY = "hed88798-dot/sbsb"
TITLE = "INTERNAL REVIEW ONLY - exact Windows Worker recovery ba6b81f4"
TRANSPORT = "de1f947ce66d0eb3758c7dfb5fbb778c75a040c05c0d0e83219090dc227651f9"
WORKER = "ba6b81f433beef8ee95615a45248251918a18a602b53f8db9ec02e35cf76d8b1"
ROOT = Path("artifacts/worker-recovery")


def request_json(path: str, token: str):
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    token = os.environ["GITHUB_TOKEN"]
    releases = request_json("releases?per_page=100", token)
    matches = [
        (release, asset)
        for release in releases
        if release.get("name") == TITLE and release.get("draft") is True
        for asset in release.get("assets", [])
        if asset.get("name") == "worker-recovery-review-transport.zip"
        and asset.get("state") == "uploaded"
        and asset.get("size") == 78742260
    ]
    if len(matches) != 1:
        raise SystemExit(f"EXACT_REVIEW_TRANSPORT_NOT_UNIQUE_OR_UNAVAILABLE:{len(matches)}")
    release, asset = matches[0]
    if asset.get("digest") not in (None, f"sha256:{TRANSPORT}"):
        raise SystemExit("TRANSPORT_METADATA_HASH_MISMATCH")
    request = urllib.request.Request(
        f"https://api.github.com/repos/{REPOSITORY}/releases/assets/{asset['id']}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/octet-stream"},
    )
    archive = ROOT / "review-transport.zip"
    size = 0
    digest = hashlib.sha256()
    with urllib.request.urlopen(request, timeout=120) as response, archive.open("xb") as output:
        for chunk in iter(lambda: response.read(1024 * 1024), b""):
            size += len(chunk)
            if size > 78742260:
                raise SystemExit("TRANSPORT_SIZE_EXCEEDED")
            digest.update(chunk)
            output.write(chunk)
    if size != 78742260 or digest.hexdigest() != TRANSPORT:
        raise SystemExit("TRANSPORT_BYTES_MISMATCH")
    expected = {
        "media-worker.exe",
        "original-candidate-transfer-manifest.json",
        "EXACT_WORKER_RECOVERY.json",
    }
    with zipfile.ZipFile(archive) as packed:
        if len(packed.namelist()) != len(expected) or set(packed.namelist()) != expected:
            raise SystemExit("TRANSPORT_ENTRY_SET_MISMATCH")
        if packed.getinfo("media-worker.exe").file_size != 79230657:
            raise SystemExit("WORKER_SIZE_MISMATCH")
        data = packed.read("media-worker.exe")
        if hashlib.sha256(data).hexdigest() != WORKER:
            raise SystemExit("WORKER_HASH_MISMATCH")
        pe = struct.unpack_from("<I", data, 0x3C)[0]
        if data[:2] != b"MZ" or data[pe : pe + 4] != b"PE\0\0" or struct.unpack_from("<H", data, pe + 4)[0] != 0x8664:
            raise SystemExit("WORKER_NOT_WINDOWS_AMD64")
        manifest = json.loads(packed.read("original-candidate-transfer-manifest.json"))
        if manifest["worker"]["sha256"] != WORKER:
            raise SystemExit("ORIGINAL_MANIFEST_WORKER_MISMATCH")
        (ROOT / "media-worker.exe").write_bytes(data)
    evidence = {
        "status": "EXACT_RECOVERY_FOR_REVIEW_ONLY",
        "release_id": release["id"],
        "asset_id": asset["id"],
        "draft": True,
        "transport_sha256": TRANSPORT,
        "worker_sha256": WORKER,
        "worker_source_head": "76529014f47945fc2916d0488115822bc28d16c7",
        "evaluation_head": os.environ.get("REVIEWED_HEAD"),
        "workflow_run_id": os.environ.get("GITHUB_RUN_ID"),
        "release_approved": False,
        "dependencies_changed": False,
        "paid_provider_requests": 0,
    }
    (ROOT / "transport-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print("EXACT_REVIEW_TRANSPORT:PASS; RELEASE_APPROVAL:PENDING")


if __name__ == "__main__":
    main()
