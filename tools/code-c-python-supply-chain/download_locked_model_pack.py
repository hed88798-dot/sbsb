from __future__ import annotations

import argparse
import hashlib
import json
import os
import urllib.request
from pathlib import Path
from urllib.parse import urlparse


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
MANIFEST = (
    REPOSITORY_ROOT
    / "sidecars"
    / "media-worker"
    / "model-manifests"
    / "siglip2-base-patch32-256.onnx-fp32.manifest.json"
)
TAG = "model-pack-siglip2-9e7ee685-opset18-fp32"
RUNTIME_ARTIFACTS = (
    "image_encoder",
    "text_encoder",
    "tokenizer_config",
    "tokenizer_model",
)


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def approved_url(value: str) -> bool:
    parsed = urlparse(value)
    expected_prefix = f"/hed88798-dot/ai-video-platform/raw/refs/tags/{TAG}/"
    return parsed.scheme == "https" and parsed.hostname == "github.com" and parsed.path.startswith(
        expected_prefix
    )


def download(entry: dict[str, object], output: Path) -> None:
    source = str(entry["storage_reference"])
    if not approved_url(source):
        raise SystemExit(f"unapproved model artifact source: {source}")
    output.parent.mkdir(parents=True, exist_ok=True)
    expected_hash = str(entry["sha256"])
    expected_size = int(entry["size"])
    if output.is_file() and output.stat().st_size == expected_size and sha256_file(output) == expected_hash:
        return
    temporary = output.with_name(f".{output.name}.{os.getpid()}.partial")
    digest = hashlib.sha256()
    size = 0
    try:
        request = urllib.request.Request(source, headers={"Accept": "application/octet-stream"})
        with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as target:
            for chunk in iter(lambda: response.read(1024 * 1024), b""):
                target.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        if size != expected_size or digest.hexdigest() != expected_hash:
            raise SystemExit(f"model artifact identity mismatch: {output.name}")
        os.replace(temporary, output)
    finally:
        temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    arguments = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    artifacts = []
    for name in RUNTIME_ARTIFACTS:
        entry = manifest["artifacts"][name]
        output = arguments.output_root / str(entry["path"])
        download(entry, output)
        artifacts.append(
            {
                "role": name,
                "filename": output.name,
                "sha256": sha256_file(output),
                "size": output.stat().st_size,
                "source": entry["storage_reference"],
            }
        )
    runtime_manifest = {
        key: value
        for key, value in manifest.items()
        if key not in {"artifact_storage_base_reference", "artifacts", "correctness"}
    }
    runtime_manifest["artifacts"] = {
        key: {
            field: value
            for field, value in manifest["artifacts"][key].items()
            if field in {"logical_id", "path", "sha256", "size"}
        }
        for key in RUNTIME_ARTIFACTS
    }
    (arguments.output_root / "MODEL_MANIFEST.json").write_text(
        canonical_json(runtime_manifest), encoding="utf-8"
    )
    evidence = {
        "report_kind": "CODE_C_LOCKED_SIGLIP_RUNTIME_MODEL_PACK",
        "schema_version": "1",
        "status": "PASS",
        "source_manifest": MANIFEST.relative_to(REPOSITORY_ROOT).as_posix(),
        "source_manifest_sha256": sha256_file(MANIFEST),
        "tag": TAG,
        "artifacts": artifacts,
        "runtime_manifest_sha256": sha256_file(arguments.output_root / "MODEL_MANIFEST.json"),
    }
    arguments.evidence.parent.mkdir(parents=True, exist_ok=True)
    arguments.evidence.write_text(canonical_json(evidence), encoding="utf-8")
    print(f"locked-model-pack: PASS ({len(artifacts)} exact runtime artifacts)")


if __name__ == "__main__":
    main()
