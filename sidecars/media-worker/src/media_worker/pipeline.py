from __future__ import annotations

import json
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import numpy as np

from . import (
    INDEX_SCHEMA_VERSION,
    INDEX_SIGNATURE_VERSION,
    KEYFRAME_POLICY_VERSION,
    WORKER_VERSION,
)
from .contracts import WorkerError, atomic_write_json, canonical_json, map_os_error, sha256_bytes, sha256_file
from .embedding import SiglipOnnx, aggregate_shot_embeddings

Progress = Callable[[str, float, dict[str, Any]], None]


def _run_json(argv: list[str], timeout_seconds: int, max_output_bytes: int) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            shell=False,
            timeout=timeout_seconds,
            cwd=str(Path(argv[0]).resolve().parent),
        )
    except subprocess.TimeoutExpired as error:
        raise WorkerError("MEDIA_TOOL_TIMEOUT", "Media probe timed out", True) from error
    except OSError as error:
        raise WorkerError("MEDIA_TOOL_UNAVAILABLE", "Configured media probe is unavailable") from error
    if len(completed.stdout) > max_output_bytes or len(completed.stderr) > max_output_bytes:
        raise WorkerError("MEDIA_TOOL_OUTPUT_LIMIT", "Media probe output exceeded its limit")
    if completed.returncode != 0:
        raise WorkerError("MEDIA_PROBE_FAILED", "Media container could not be probed")
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise WorkerError("MEDIA_PROBE_INVALID", "Media probe returned invalid JSON") from error


def probe_media(path: Path, ffprobe_path: Path) -> dict[str, Any]:
    document = _run_json(
        [
            str(ffprobe_path),
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
            str(path),
        ],
        timeout_seconds=30,
        max_output_bytes=4 * 1024 * 1024,
    )
    return parse_probe_document(document)


def parse_probe_document(document: dict[str, Any]) -> dict[str, Any]:
    videos = [stream for stream in document.get("streams", []) if stream.get("codec_type") == "video"]
    if not videos:
        raise WorkerError("MEDIA_NO_VIDEO_STREAM", "Input has no video stream")
    stream = videos[0]
    width = int(stream.get("width", 0))
    height = int(stream.get("height", 0))
    if width <= 0 or height <= 0 or width * height > 40_000_000:
        raise WorkerError("MEDIA_DIMENSIONS_UNSUPPORTED", "Video dimensions are invalid or unsafe")
    duration = float(stream.get("duration") or document.get("format", {}).get("duration") or 0)
    if not 0 < duration <= 24 * 60 * 60:
        raise WorkerError("MEDIA_DURATION_UNSUPPORTED", "Video duration is invalid or exceeds 24 hours")
    rate = str(stream.get("avg_frame_rate", "0/1")).split("/")
    fps = float(rate[0]) / max(float(rate[1]), 1.0)
    rotation = 0
    for side_data in stream.get("side_data_list", []):
        if "rotation" in side_data:
            rotation = int(side_data["rotation"])
    return {
        "duration_ms": round(duration * 1000),
        "width": width,
        "height": height,
        "rotation": rotation,
        "fps": fps if fps > 0 else 25.0,
    }


def detect_shots(path: Path, parameters: dict[str, Any], duration_ms: int) -> list[tuple[int, int]]:
    try:
        from scenedetect import AdaptiveDetector, SceneManager, open_video
    except ImportError as error:
        raise WorkerError("SHOT_DETECTOR_MISSING", "PySceneDetect 0.7.1 is unavailable") from error
    try:
        video = open_video(str(path))
        manager = SceneManager()
        manager.add_detector(
            AdaptiveDetector(
                adaptive_threshold=float(parameters["adaptive_threshold"]),
                min_scene_len=int(parameters["min_scene_len_frames"]),
                window_width=int(parameters["window_width"]),
                luma_only=bool(parameters["luma_only"]),
            )
        )
        manager.detect_scenes(video=video, show_progress=False)
        scenes = manager.get_scene_list(start_in_scene=True)
    except Exception as error:
        raise WorkerError("SHOT_DETECTION_FAILED", "Shot detection failed for this file", True) from error
    boundaries = [(round(start.seconds * 1000), round(end.seconds * 1000)) for start, end in scenes]
    valid = [(max(0, start), min(duration_ms, end)) for start, end in boundaries if end > start]
    return valid or [(0, duration_ms)]


def frame_at(path: Path, timestamp_ms: int) -> np.ndarray:
    try:
        import cv2
    except ImportError as error:
        raise WorkerError("IMAGE_RUNTIME_MISSING", "OpenCV is unavailable") from error
    capture = cv2.VideoCapture(str(path))
    try:
        capture.set(cv2.CAP_PROP_POS_MSEC, float(timestamp_ms))
        ok, frame = capture.read()
        if not ok or frame is None:
            raise WorkerError("FRAME_DECODE_FAILED", "A required video frame could not be decoded", True)
        return cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    finally:
        capture.release()


def frame_quality(rgb: np.ndarray) -> dict[str, float]:
    try:
        import cv2
    except ImportError as error:
        raise WorkerError("IMAGE_RUNTIME_MISSING", "OpenCV is unavailable") from error
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    mean = float(np.mean(gray))
    blur = 1.0 - min(float(cv2.Laplacian(gray, cv2.CV_64F).var()) / 800.0, 1.0)
    dark = max(0.0, min(1.0, (45.0 - mean) / 45.0))
    overexposed = float(np.mean(gray >= 245))
    score = max(0.0, min(1.0, 1.0 - 0.55 * blur - 0.25 * dark - 0.2 * overexposed))
    return {"score": score, "blur": blur, "dark": dark, "overexposed": overexposed}


def select_keyframes(path: Path, start_ms: int, end_ms: int) -> list[tuple[str, int, np.ndarray, dict[str, float]]]:
    duration = end_ms - start_ms
    if duration < 600:
        timestamp = start_ms + duration // 2
        rgb = frame_at(path, timestamp)
        return [("MIDPOINT", timestamp, rgb, frame_quality(rgb))]
    safe = start_ms + round(min(max(duration * 0.1, 120), 500))
    midpoint = start_ms + duration // 2
    sample_times = sorted({start_ms + round(duration * ratio) for ratio in (0.1, 0.25, 0.5, 0.75, 0.9)})
    samples = [(timestamp, frame_at(path, timestamp)) for timestamp in sample_times]
    with_quality = [(timestamp, rgb, frame_quality(rgb)) for timestamp, rgb in samples]
    best_timestamp, best_rgb, best_quality = max(with_quality, key=lambda item: item[2]["score"])
    selected = [
        ("SAFE_EARLY", safe, frame_at(path, safe), None),
        ("MIDPOINT", midpoint, frame_at(path, midpoint), None),
        ("BEST_QUALITY", best_timestamp, best_rgb, best_quality),
    ]
    unique: list[tuple[str, int, np.ndarray, dict[str, float]]] = []
    seen: set[int] = set()
    for role, timestamp, rgb, quality in selected:
        if timestamp in seen:
            continue
        seen.add(timestamp)
        unique.append((role, timestamp, rgb, quality or frame_quality(rgb)))
    return unique


def _wait_for_resource_control(payload: dict[str, Any]) -> None:
    cancel_file = payload.get("cancel_file")
    pause_file = payload.get("pause_file")
    if cancel_file and Path(cancel_file).exists():
        raise WorkerError("JOB_CANCELLED", "Index job was cancelled")
    while pause_file and Path(pause_file).exists():
        if cancel_file and Path(cancel_file).exists():
            raise WorkerError("JOB_CANCELLED", "Index job was cancelled")
        time.sleep(0.2)


def _checkpoint_shot_valid(output_root: Path, shot: dict[str, Any]) -> bool:
    try:
        embedding = shot["embedding"]
        embedding_path = output_root / embedding["relative_path"]
        if not embedding_path.is_file() or sha256_file(embedding_path) != embedding["sha256"]:
            return False
        if embedding_path.stat().st_size != int(embedding["dimension"]) * 2:
            return False
        for keyframe in shot["keyframes"]:
            keyframe_path = output_root / keyframe["relative_path"]
            if not keyframe_path.is_file() or sha256_file(keyframe_path) != keyframe["sha256"]:
                return False
        return True
    except (KeyError, OSError, TypeError, ValueError):
        return False


def _load_checkpoint(
    checkpoint_path: Path,
    *,
    file_hash: str,
    parameter_hash: str,
    model_version: str,
    preprocess_version: str,
) -> dict[str, Any] | None:
    try:
        checkpoint = json.loads(checkpoint_path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    expected = {
        "file_hash": file_hash,
        "shot_detector_params_hash": parameter_hash,
        "embedding_model_version": model_version,
        "embedding_preprocess_version": preprocess_version,
        "keyframe_policy_version": KEYFRAME_POLICY_VERSION,
    }
    if any(checkpoint.get(key) != value for key, value in expected.items()):
        return None
    if not isinstance(checkpoint.get("probe"), dict) or not isinstance(checkpoint.get("shots"), list):
        return None
    return checkpoint


def index_asset(payload: dict[str, Any], progress: Progress) -> dict[str, str]:
    raw_input_path = Path(str(payload.get("input_path", "")))
    try:
        if raw_input_path.is_symlink():
            raise WorkerError("MEDIA_PATH_INVALID", "Input must be a regular non-symlink file")
        input_path = raw_input_path.resolve(strict=True)
    except OSError as error:
        raise WorkerError("MEDIA_PATH_INVALID", "Input media path is unavailable") from error
    if not input_path.is_file():
        raise WorkerError("MEDIA_PATH_INVALID", "Input must be a regular non-symlink file")
    raw_output_root = Path(str(payload.get("output_dir", "")))
    if raw_output_root.is_symlink():
        raise WorkerError("OUTPUT_PATH_INVALID", "Job output cannot be a symbolic link")
    output_root = raw_output_root.resolve()
    try:
        output_root.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise map_os_error(error) from error
    asset_id = str(payload.get("asset_id", ""))
    revision = int(payload.get("revision", 0))
    if not asset_id or revision <= 0:
        raise WorkerError("REQUEST_INVALID", "asset_id and positive revision are required")
    try:
        ffprobe_path = Path(str(payload.get("ffprobe_path", ""))).resolve(strict=True)
    except OSError as error:
        raise WorkerError("MEDIA_TOOL_UNAVAILABLE", "Configured media probe is unavailable") from error
    parameters = dict(payload.get("shot_detector_parameters", {}))
    required_parameters = {"adaptive_threshold", "min_scene_len_frames", "window_width", "luma_only"}
    if set(parameters) != required_parameters:
        raise WorkerError("SHOT_PARAMETERS_INVALID", "Shot detector parameters are incomplete")
    parameter_hash = sha256_bytes(canonical_json(parameters).encode("utf-8"))

    try:
        _wait_for_resource_control(payload)
        file_hash = sha256_file(input_path)
        source_stat = input_path.stat()
        model_version = str(payload.get("embedding_model_version", ""))
        preprocess_version = str(payload.get("embedding_preprocess_version", ""))
        checkpoint_path = output_root / "checkpoint.json"
        checkpoint = _load_checkpoint(
            checkpoint_path,
            file_hash=file_hash,
            parameter_hash=parameter_hash,
            model_version=model_version,
            preprocess_version=preprocess_version,
        )
        if checkpoint is None:
            progress("PROBE", 0.05, {})
            probe = probe_media(input_path, ffprobe_path)
            progress("SHOT_DETECTION", 0.15, {})
            shots = detect_shots(input_path, parameters, probe["duration_ms"])
            checkpoint = {
                "schema_version": "1.0",
                "stage": "SHOT_DETECTION",
                "file_hash": file_hash,
                "shot_detector_params_hash": parameter_hash,
                "embedding_model_version": model_version,
                "embedding_preprocess_version": preprocess_version,
                "keyframe_policy_version": KEYFRAME_POLICY_VERSION,
                "probe": probe,
                "shots": shots,
                "completed_shots": [],
            }
            atomic_write_json(checkpoint_path, checkpoint)
        else:
            probe = checkpoint["probe"]
            shots = [(int(item[0]), int(item[1])) for item in checkpoint["shots"]]
            progress("RESUME", 0.15, {"completed_shots": len(checkpoint.get("completed_shots", []))})
        signature = {
            "index_schema_version": INDEX_SCHEMA_VERSION,
            "index_signature_version": INDEX_SIGNATURE_VERSION,
            "embedding_model": "google/siglip2-base-patch32-256",
            "embedding_model_version": model_version,
            "embedding_preprocess_version": preprocess_version,
            "vlm_model": None,
            "vlm_model_version": None,
            "vlm_prompt_version": None,
            "shot_detector": "PySceneDetect.AdaptiveDetector",
            "shot_detector_version": "0.7.1",
            "shot_detector_params_hash": parameter_hash,
            "keyframe_policy_version": KEYFRAME_POLICY_VERSION,
            "file_hash": file_hash,
        }
        signature_hash = sha256_bytes(canonical_json(signature).encode("utf-8"))
        generation_key = {key: value for key, value in signature.items() if key != "file_hash"}
        generation_key_hash = sha256_bytes(canonical_json(generation_key).encode("utf-8"))
        checkpoint_artifacts = {
            shot["shot_id"]: shot
            for shot in checkpoint.get("completed_shots", [])
            if isinstance(shot, dict) and _checkpoint_shot_valid(output_root, shot)
        }
        artifacts: list[dict[str, Any]] = []
        model: SiglipOnnx | None = None
        from PIL import Image

        for index, (start_ms, end_ms) in enumerate(shots):
            _wait_for_resource_control(payload)
            shot_id = f"shot_{uuid.uuid5(uuid.NAMESPACE_URL, f'{asset_id}:{revision}:{start_ms}:{end_ms}')}"
            completed_shot = checkpoint_artifacts.get(shot_id)
            if completed_shot is not None:
                artifacts.append(completed_shot)
                progress(
                    "RESUME",
                    0.2 + 0.75 * ((index + 1) / len(shots)),
                    {"shot": index + 1, "total": len(shots)},
                )
                continue
            if model is None:
                model = SiglipOnnx(
                    Path(str(payload.get("model_root", ""))), int(payload.get("dimension", 768))
                )
            keyframe_records: list[dict[str, Any]] = []
            embeddings: list[np.ndarray] = []
            selected = select_keyframes(input_path, start_ms, end_ms)
            for frame_index, (role, timestamp, rgb, quality) in enumerate(selected):
                relative = Path("keyframes") / shot_id / f"{frame_index}-{role.lower()}.jpg"
                output = output_root / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(rgb, mode="RGB").save(output, format="JPEG", quality=88, optimize=True)
                embeddings.append(model.image_embedding(rgb))
                keyframe_records.append(
                    {
                        "keyframe_id": f"keyframe_{uuid.uuid4()}",
                        "role": role,
                        "timestamp_ms": timestamp,
                        "relative_path": relative.as_posix(),
                        "sha256": sha256_file(output),
                        "quality": quality,
                    }
                )
            aggregated = aggregate_shot_embeddings(embeddings)
            embedding_relative = Path("embeddings") / f"{shot_id}.f16"
            embedding_path = output_root / embedding_relative
            embedding_path.parent.mkdir(parents=True, exist_ok=True)
            aggregated.astype("<f2").tofile(embedding_path)
            embedding_id = f"embedding_{uuid.uuid4()}"
            quality = max((record["quality"] for record in keyframe_records), key=lambda item: item["score"])
            descriptor = {
                "schema_version": INDEX_SCHEMA_VERSION,
                "shot_id": shot_id,
                "species": "unknown",
                "scene": "unknown",
                "action": "unknown",
                "health_state": "unknown",
                "people_present": None,
                "product_present": None,
                "shot_type": "unknown",
                "description": "",
                "quality": quality,
                "embedding_ref": embedding_id,
                "industry_metadata": {"veterinary": {}},
                "confidence": {},
                "provenance": {"rules_version": "visual-descriptor-rules-v1", "vlm": "OFF"},
                "evidence": {
                    "motion_sensitive_guard": {
                        "value": None,
                        "confidence": 0,
                        "provenance": "static-keyframes-only",
                        "temporal_evidence": "INSUFFICIENT",
                    }
                },
            }
            artifacts.append(
                {
                    "shot_id": shot_id,
                    "start_ms": start_ms,
                    "end_ms": end_ms,
                    "keyframes": keyframe_records,
                    "quality": quality,
                    "descriptor": descriptor,
                    "embedding": {
                        "embedding_id": embedding_id,
                        "model_id": "google/siglip2-base-patch32-256",
                        "model_version": model_version,
                        "preprocess_version": preprocess_version,
                        "dimension": int(aggregated.size),
                        "dtype": "float16",
                        "normalized": True,
                        "relative_path": embedding_relative.as_posix(),
                        "sha256": sha256_file(embedding_path),
                    },
                }
            )
            checkpoint["stage"] = "EMBEDDING"
            checkpoint["completed_shots"] = artifacts
            atomic_write_json(checkpoint_path, checkpoint)
            progress("EMBEDDING", 0.2 + 0.75 * ((index + 1) / len(shots)), {"shot": index + 1, "total": len(shots)})
        manifest = {
            "schema_version": INDEX_SCHEMA_VERSION,
            "asset_id": asset_id,
            "revision": revision,
            "source_path": str(input_path),
            "file_hash": file_hash,
            "size_bytes": source_stat.st_size,
            "mtime_ns": str(source_stat.st_mtime_ns),
            **probe,
            "index_signature": signature,
            "index_signature_hash": signature_hash,
            "generation_key_hash": generation_key_hash,
            "artifact_root": str(output_root),
            "shots": artifacts,
            "worker_version": WORKER_VERSION,
            "created_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        manifest_path = output_root / "asset-revision-manifest.json"
        manifest_hash = atomic_write_json(manifest_path, manifest)
        checkpoint["stage"] = "COMPLETE"
        checkpoint["completed_shots"] = artifacts
        checkpoint["manifest_sha256"] = manifest_hash
        atomic_write_json(checkpoint_path, checkpoint)
        progress("MANIFEST", 1.0, {"shots": len(shots)})
        return {
            "manifest_path": str(manifest_path),
            "manifest_sha256": manifest_hash,
            "index_signature_hash": signature_hash,
        }
    except OSError as error:
        raise map_os_error(error) from error
