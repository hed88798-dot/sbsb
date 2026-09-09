# Media Worker dependency provenance

Code C v0.3 runtime dependencies are exact-pinned in `sidecars/media-worker/requirements.lock`.
Release packaging must resolve them from the audited wheel source for Python 3.13.15 x64 and include wheel hashes
in the final SBOM; CI does not download floating versions.

| Component        |   Version | License                    | Source / purpose                                         |
| ---------------- | --------: | -------------------------- | -------------------------------------------------------- |
| Click            |     8.5.0 | BSD-3-Clause               | PySceneDetect command/runtime dependency                 |
| FlatBuffers      |  25.12.19 | Apache-2.0                 | ONNX Runtime serialization dependency                    |
| NumPy            |     2.3.5 | BSD-3-Clause               | exact vector math and mmap search                        |
| ONNX Runtime CPU |    1.29.0 | MIT                        | SigLIP 2 CPU inference                                   |
| OpenCV headless  | 4.14.0.94 | Apache-2.0                 | frame decode and quality metrics; V1 remains on OpenCV 4 |
| Packaging        |      26.3 | Apache-2.0 OR BSD-2-Clause | version handling dependency                              |
| Pillow           |    12.3.0 | MIT-CMU                    | deterministic RGB/JPEG and SigLIP preprocessing          |
| Platformdirs     |    4.11.4 | MIT                        | PySceneDetect platform paths                             |
| Protobuf         |    7.36.0 | BSD-3-Clause               | ONNX Runtime serialization dependency                    |
| PySceneDetect    |     0.7.1 | BSD-3-Clause               | headless `AdaptiveDetector` Shot detection               |
| SentencePiece    |     0.2.1 | Apache-2.0                 | fixed local SigLIP 2 text tokenizer                      |
| tqdm             |    4.70.0 | MPL-2.0 AND MIT            | PySceneDetect progress/runtime dependency                |

The SigLIP 2 source lock records official revision, every required source file SHA-256 and Apache-2.0
license. Model weights and ONNX files are not committed to Git. The export tool refuses remote code and accepts
only a complete local source directory whose files match the source lock. Florence-2 is not enabled in v0.3
and is not a base-index dependency.

Build-only dependencies are isolated in `tools/build-requirements.lock` and are not production worker
imports. PyInstaller is GPL-2.0-or-later with the upstream bootloader exception; release counsel/manual review
is still required for the final distributed executable. Export/evaluation dependencies (including PyTorch and
Transformers) are isolated in `tools/export-requirements.lock`; the packaged runtime smoke rejects both modules.
The final installer SBOM, wheel notices, MPL-2.0 file-level obligations and distribution signing remain release
gates rather than PR first-pass claims.
