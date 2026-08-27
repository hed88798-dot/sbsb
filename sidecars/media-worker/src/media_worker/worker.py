from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from . import PROTOCOL_VERSION, WORKER_VERSION
from .contracts import WorkerError
from .embedding import SiglipOnnx
from .pipeline import index_asset
from .search import ExactSearchCache


def emit(event_type: str, request_id: str, *, payload: dict[str, Any] | None = None, error: dict[str, Any] | None = None) -> None:
    event: dict[str, Any] = {
        "type": event_type,
        "protocol_version": PROTOCOL_VERSION,
        "request_id": request_id,
    }
    if payload is not None:
        event["payload"] = payload
    if error is not None:
        event["error"] = error
    sys.stdout.write(json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def handle(request: dict[str, Any]) -> None:
    request_id = str(request.get("request_id", ""))
    if request.get("type") != "request" or request.get("protocol_version") != PROTOCOL_VERSION or not request_id:
        raise WorkerError("PROTOCOL_INVALID", "Sidecar request does not match protocol 1.0")
    method = request.get("method")
    payload = request.get("payload")
    if not isinstance(payload, dict):
        raise WorkerError("REQUEST_INVALID", "Request payload must be an object")
    if method == "hello":
        emit(
            "hello",
            request_id,
            payload={
                "worker_version": WORKER_VERSION,
                "capabilities": ["media.index.asset.v1", "media.search.exact.v1"],
            },
        )
        return
    emit("accepted", request_id, payload={"method": method})
    if method == "media.index.asset.v1":
        result = index_asset(
            payload,
            lambda stage, progress, details: emit(
                "progress", request_id, payload={"stage": stage, "progress": progress, **details}
            ),
        )
        emit("result", request_id, payload=result)
        return
    if method == "media.search.exact.v1":
        cache = ExactSearchCache(Path(str(payload.get("cache_root", ""))), str(payload.get("signature_hash", "")))
        model = SiglipOnnx(
            Path(str(payload.get("model_root", ""))), int(payload.get("dimension", cache.dimension))
        )
        query = model.text_embedding(str(payload.get("query_text", "")))
        allowed_payload = payload.get("allowed_shot_ids")
        allowed = (
            {str(shot_id) for shot_id in allowed_payload}
            if isinstance(allowed_payload, list)
            else None
        )
        results = cache.search(query, int(payload.get("top_k", 20)), allowed_shot_ids=allowed)
        emit("result", request_id, payload={"candidates": results})
        return
    raise WorkerError("METHOD_NOT_SUPPORTED", "Worker method is not supported")


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id = "unknown"
        try:
            request = json.loads(line)
            if isinstance(request, dict):
                request_id = str(request.get("request_id", "unknown"))
                handle(request)
            else:
                raise WorkerError("PROTOCOL_INVALID", "Sidecar request must be an object")
        except WorkerError as error:
            if error.code == "JOB_CANCELLED":
                emit("cancelled", request_id, payload={"code": error.code})
            else:
                emit(
                    "error",
                    request_id,
                    error={"code": error.code, "message": error.message, "retryable": error.retryable},
                )
        except (json.JSONDecodeError, ValueError, TypeError):
            emit(
                "error",
                request_id,
                error={"code": "REQUEST_INVALID", "message": "Worker request is invalid", "retryable": False},
            )
        except Exception:
            emit(
                "error",
                request_id,
                error={"code": "WORKER_INTERNAL", "message": "Media worker failed", "retryable": True},
            )


if __name__ == "__main__":
    main()
