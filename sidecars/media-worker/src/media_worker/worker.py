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


def _required_string(payload: dict[str, Any], name: str) -> str:
    value = payload.get(name)
    if not isinstance(value, str) or not value:
        raise WorkerError("REQUEST_INVALID", f"{name} must be a non-empty string")
    return value


def _optional_int(payload: dict[str, Any], name: str, default: int) -> int:
    value = payload.get(name, default)
    if not isinstance(value, int) or isinstance(value, bool):
        raise WorkerError("REQUEST_INVALID", f"{name} must be an integer")
    return value


def _search_payload(
    payload: dict[str, Any],
) -> tuple[Path, str, Path, int | None, str, int, set[str] | None]:
    cache_root = Path(_required_string(payload, "cache_root"))
    signature_hash = _required_string(payload, "signature_hash")
    model_root = Path(_required_string(payload, "model_root"))
    query_text = payload.get("query_text")
    if not isinstance(query_text, str):
        raise WorkerError("REQUEST_INVALID", "query_text must be a string")
    dimension_value = payload.get("dimension")
    if dimension_value is None:
        dimension = None
    elif isinstance(dimension_value, int) and not isinstance(dimension_value, bool):
        if dimension_value <= 0:
            raise WorkerError("REQUEST_INVALID", "dimension must be a positive integer")
        dimension = dimension_value
    else:
        raise WorkerError("REQUEST_INVALID", "dimension must be an integer")
    top_k = _optional_int(payload, "top_k", 20)
    allowed_payload = payload.get("allowed_shot_ids")
    if allowed_payload is None:
        allowed = None
    elif isinstance(allowed_payload, list) and all(
        isinstance(shot_id, str) and bool(shot_id) for shot_id in allowed_payload
    ):
        allowed = set(allowed_payload)
    else:
        raise WorkerError("REQUEST_INVALID", "allowed_shot_ids must be a list of non-empty strings")
    return cache_root, signature_hash, model_root, dimension, query_text, top_k, allowed


def handle(request: dict[str, Any]) -> None:
    request_id_value = request.get("request_id")
    request_id = request_id_value if isinstance(request_id_value, str) else ""
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
        (
            cache_root,
            signature_hash,
            model_root,
            requested_dimension,
            query_text,
            top_k,
            allowed,
        ) = _search_payload(payload)
        cache = ExactSearchCache(cache_root, signature_hash)
        dimension = cache.dimension if requested_dimension is None else requested_dimension
        model = SiglipOnnx(model_root, dimension)
        query = model.text_embedding(query_text)
        results = cache.search(query, top_k, allowed_shot_ids=allowed)
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
        except json.JSONDecodeError as error:
            emit(
                "error",
                request_id,
                error={
                    "code": "REQUEST_INVALID",
                    "message": f"Malformed JSON ({error.msg})",
                    "retryable": False,
                },
            )
        except (ValueError, TypeError) as error:
            emit(
                "error",
                request_id,
                error={
                    "code": "WORKER_INTERNAL",
                    "message": f"Worker execution failed ({type(error).__name__}): {error}",
                    "retryable": False,
                },
            )
        except Exception as error:
            emit(
                "error",
                request_id,
                error={
                    "code": "WORKER_INTERNAL",
                    "message": f"Media worker failed ({type(error).__name__}): {error}",
                    "retryable": True,
                },
            )


if __name__ == "__main__":
    main()
