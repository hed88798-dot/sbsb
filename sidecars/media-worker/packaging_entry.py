from __future__ import annotations

import importlib.util
import json
import sys


def runtime_smoke() -> None:
    import cv2
    import numpy
    import onnxruntime
    import PIL
    import scenedetect
    import sentencepiece

    providers = onnxruntime.get_available_providers()
    if "CPUExecutionProvider" not in providers:
        raise SystemExit("CPUExecutionProvider is unavailable")
    print(
        json.dumps(
            {
                "schema_version": "1.0",
                "status": "PASS",
                "python": sys.version.split()[0],
                "numpy": numpy.__version__,
                "onnxruntime": onnxruntime.__version__,
                "opencv": cv2.__version__,
                "pillow": PIL.__version__,
                "scenedetect": scenedetect.__version__,
                "sentencepiece": sentencepiece.__version__,
                "providers": providers,
                "contains_torch": importlib.util.find_spec("torch") is not None,
                "contains_transformers": importlib.util.find_spec("transformers") is not None,
            },
            separators=(",", ":"),
        )
    )


if sys.argv[1:] == ["--runtime-smoke"]:
    runtime_smoke()
else:
    from media_worker.worker import main

    main()
