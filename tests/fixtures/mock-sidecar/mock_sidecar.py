#!/usr/bin/env python3
"""NON_PRODUCTION Code A stdio NDJSON contract fixture."""

import json
import sys
from typing import Dict, Optional

PROTOCOL_VERSION = "1.0"


def emit(message: Dict) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def event(event_type: str, request_id: str, payload: Optional[Dict] = None) -> Dict:
    message = {
        "type": event_type,
        "protocol_version": PROTOCOL_VERSION,
        "request_id": request_id,
    }
    if payload is not None:
        message["payload"] = payload
    return message


for raw_line in sys.stdin:
    try:
        request = json.loads(raw_line)
        request_id = str(request.get("request_id", "unknown"))
        if request.get("protocol_version") != PROTOCOL_VERSION:
            emit(
                {
                    **event("error", request_id),
                    "error": {
                        "code": "PROTOCOL_MISMATCH",
                        "message": "Unsupported protocol version",
                        "retryable": False,
                    },
                }
            )
            continue
        method = request.get("method")
        payload = request.get("payload", {})
        if method == "hello":
            emit(event("hello", request_id, {"worker_version": "0.1.0-mock"}))
        elif method == "ping":
            emit(event("result", request_id, {"pong": True}))
        elif method == "echo":
            emit(event("result", request_id, payload))
        elif method == "progress":
            emit(event("accepted", request_id, {}))
            emit(event("progress", request_id, {"progress": 0.5}))
            emit(event("result", request_id, {"progress": 1.0}))
        elif method == "cancel":
            emit(event("cancelled", request_id, {}))
        elif method == "error":
            emit(
                {
                    **event("error", request_id),
                    "error": {
                        "code": "MOCK_ERROR",
                        "message": "Synthetic sidecar failure",
                        "retryable": False,
                    },
                }
            )
        else:
            emit(
                {
                    **event("error", request_id),
                    "error": {
                        "code": "UNKNOWN_METHOD",
                        "message": "Method is not allowed",
                        "retryable": False,
                    },
                }
            )
    except Exception:
        emit(
            {
                **event("error", "unknown"),
                "error": {
                    "code": "INVALID_REQUEST",
                    "message": "Invalid NDJSON request",
                    "retryable": False,
                },
            }
        )
