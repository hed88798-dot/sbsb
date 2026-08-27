# Media Worker dependency provenance

Code C v0.3 runtime dependencies are exact-pinned in `sidecars/media-worker/requirements.lock`.
Release packaging must resolve them from the audited wheel mirror for Python 3.12 x64 and include wheel hashes
in the final SBOM; CI does not download floating versions.

| Component        |   Version | License      | Source / purpose                                         |
| ---------------- | --------: | ------------ | -------------------------------------------------------- |
| NumPy            |     2.3.5 | BSD-3-Clause | exact vector math and mmap search                        |
| ONNX Runtime CPU |    1.29.0 | MIT          | SigLIP 2 CPU inference                                   |
| OpenCV headless  | 4.14.0.94 | Apache-2.0   | frame decode and quality metrics; V1 remains on OpenCV 4 |
| Pillow           |    12.3.0 | HPND         | deterministic RGB/JPEG and SigLIP preprocessing          |
| PySceneDetect    |     0.7.1 | BSD-3-Clause | `AdaptiveDetector` Shot detection                        |
| SentencePiece    |     0.2.1 | Apache-2.0   | fixed local SigLIP 2 text tokenizer                      |

The SigLIP 2 source lock records official revision, every required source file SHA-256 and Apache-2.0
license. Model weights and ONNX files are not committed to Git. The export tool refuses remote code and accepts
only a complete local source directory whose files match the source lock. Florence-2 is not enabled in v0.3
and is not a base-index dependency.
