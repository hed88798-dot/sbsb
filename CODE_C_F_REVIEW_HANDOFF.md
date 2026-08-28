# Code C → Code F QICR Handoff

## Mandatory stop — remaining Python runtime license policy contract

```text
STATUS: BLOCKED_MANDATORY_STOP_QICR
QICR: docs/quality/CODE_C_QICR_PYTHON_RUNTIME_LICENSE_POLICY.md
PUSH_TO_PR_8: NOT_PERFORMED
FORMAL_F_REVIEW: NOT_STARTED
```

Main `84e7befb53cbcbc28fb39924ad36cce408d0760b` resolves the historical PyInstaller/packaging SPDX blocker.
The new shared quality-tooling assertion passes those two expressions. The same License Policy Evaluation v2
was then executed against evidence bound to the exact Windows and Linux Pillow 12.3.0 `cp313` artifact hashes
and their hash-verified PEP 658 metadata. Both normalized
`MIT-CMU` correctly but returned `FAIL` because policy `2026.08.28.1` has no rule for that valid SPDX id.
Code C stopped before ADR-018 creation, formal inventory approval, target builds, CI integration, or push; no
package-name override, private policy, license rewrite, or verifier bypass was added.

All later historical `PASS` evidence in this handoff belongs to the previously reviewed frozen media/index
implementation. It is retained for context and is not claimed as a rerun on the current unpushed HEAD.

## Identity and approved boundaries

```text
Branch: code-c/local-media-index-v0.3
PR HEAD SHA: use the immutable head shown by the Draft PR (a Git-tracked file cannot self-embed its own commit SHA)
Original C baseline: b04b8c152cd3e589b17246f53bab16262aefe313
Synced MAIN_BASELINE_SHA: 84e7befb53cbcbc28fb39924ad36cce408d0760b
ADR-017: Accepted — safe-mid-best-v1; Real Golden performance PENDING
Media Index Contract Change: Approved, non-breaking, narrowly scoped
Sidecar Protocol: 1.0
Desktop Migration: 002_media_index_v1.sql, forward-only
SQLite writer: Electron Main / @app/local-db only
Python: 3.13.15
```

No Provider/Gateway business logic, Provider Contract, Code B migration, Fastify, Object Storage, Digital Human,
Auto Edit, VisualIntent, Matcher or Timeline behavior was added or redesigned. Worker has no Provider secret,
does not open `app.db`, and does not listen on localhost HTTP.

## Dependency boundary

新增 Node 业务依赖：无。为关闭现有 vulnerability gate，root dev tooling only 更新为
`ajv 8.18.0`, `concurrently 10.0.5`, `vite 7.3.5`, `vitest 4.1.0`；Provider runtime unchanged。

Production Worker exact wheel graph（`pip --no-deps`）：

```text
click 8.5.0
flatbuffers 25.12.19
numpy 2.3.5
onnxruntime 1.29.0
opencv-python-headless 4.14.0.94
packaging 26.3
Pillow 12.3.0
platformdirs 4.11.4
protobuf 7.36.0
scenedetect-headless 0.7.1
sentencepiece 0.2.1
tqdm 4.70.0
```

Build-only graph：

```text
altgraph 0.17.5
macholib 1.16.4 (Darwin)
pefile 2024.8.26 (Windows)
pyinstaller-hooks-contrib 2026.7
PyInstaller 6.22.2
pywin32-ctypes 0.2.3 (Windows)
setuptools 84.0.0
```

Export/evaluation-only graph is exact-pinned in `tools/export-requirements.lock`; it includes
`torch 2.13.0`, `transformers 4.57.6`, `onnx 1.22.0`, Hugging Face/tokenizer dependencies and their
transitives. They are not installed into or bundled with the production Worker. Packaged runtime smoke reports:

```text
PRODUCTION_WORKER_CONTAINS_TORCH: NO
PRODUCTION_WORKER_CONTAINS_TRANSFORMERS: NO
CPUExecutionProvider: PRESENT
```

Native boundaries：ONNX Runtime CPU and OpenCV are wheel-native production components. `ffprobe` remains a
Main-resolved signed native-binary boundary and is not embedded in the Worker. The local E2E used an isolated,
hash-recorded test probe only; it is not claimed as the distribution artifact.

## Official SigLIP 2 artifact

```text
Model: google/siglip2-base-patch32-256
Official revision: 9e7ee68506177b546b2d5dc578f54afdc5e425f1
License: Apache-2.0
Source-lock canonical SHA-256: 3f628585475283c2b50bd8040acb2f47767b3cebc4b07cdf9ae08bde47e4b82d
ONNX opset: 18
ONNX Runtime: 1.29.0
Preprocess: siglip2-processor-256-bicubic-mean0.5-official-text-v2
```

Image Encoder:

```text
Logical ID: google-siglip2-base-patch32-256/image-encoder-onnx-fp32/sha256:ef5f7b69830c352e57f15668092d7323521836c16fff2d71d14549b75eca6059
SHA-256: ef5f7b69830c352e57f15668092d7323521836c16fff2d71d14549b75eca6059
Size: 378435041 bytes
Reference: https://github.com/hed88798-dot/ai-video-platform/raw/refs/tags/model-pack-siglip2-9e7ee685-opset18-fp32/image-encoder.onnx
```

Text Encoder:

```text
Logical ID: google-siglip2-base-patch32-256/text-encoder-onnx-fp32/sha256:12bccdb491a98d224df1e6b6b249378118c6cfb54c18f6eb12286ffce8b26f30
SHA-256: 12bccdb491a98d224df1e6b6b249378118c6cfb54c18f6eb12286ffce8b26f30
Size: 1129415247 bytes
Reference: https://github.com/hed88798-dot/ai-video-platform/raw/refs/tags/model-pack-siglip2-9e7ee685-opset18-fp32/text-encoder.onnx
```

Model Manifest status:

```text
STRUCTURE: PASS
PROVENANCE: PASS
HASH: PASS
RUNTIME_CORRECTNESS: PASS
GOLDEN_RETRIEVAL_METRICS: PENDING
DISTRIBUTION_SIGNING: BLOCKED
```

Controlled storage: PASS. Git LFS content objects are referenced by immutable tag
`model-pack-siglip2-9e7ee685-opset18-fp32`, whose model-pack commit is
`96fc88b3a0139ea5d927fa183b381b314ac7057c`. The tag contains only LFS pointer text plus
`MODEL_MANIFEST.json`; ONNX bytes are not Git blobs. A download batch check returned every Manifest OID/size
as available. Generation and verification remain separate; ordinary CI does not export or accept new hashes.

## Correctness and E2E evidence

PyTorch ↔ ORT correctness: PASS. Four deterministic images and four text queries（中英文各两条）produce
`[4,768]` finite outputs. Image max absolute error is `2.574920654296875e-05`, text max absolute error is
`9.5367431640625e-06`; minimum cosine similarities are `1.0` and `0.9999999403953552`; all four rankings
match exactly, and production SentencePiece IDs match the official tokenizer.

Real ONNX E2E: PASS. Synthetic authorized MJPG video → ffprobe → PySceneDetect → safe/mid/best → real image
ONNX → manifest → Main commit → SQLite truth → cache publication → real text ONNX → exact cosine → hydrated
Shot result. Evidence includes `asset_id`, `shot_id`, `start_ms`, `end_ms`, `revision`, semantic score and static
motion-sensitive guard.

Local packaged Worker: PASS. PyInstaller artifact loads ORT CPU/OpenCV/Pillow/PySceneDetect/SentencePiece,
reports no torch/transformers and completes stdio NDJSON `hello` with protocol `1.0`.

Windows Worker Packaging / Runtime Smoke: PASS in `windows-native-smoke` run
`https://github.com/hed88798-dot/ai-video-platform/actions/runs/33089679168`. The job installed exact
production/build locks with `--no-deps`, ran 18 Worker tests, built PyInstaller, checked ORT 1.29.0 and CPU
provider, rejected torch/transformers, exercised packaged stdio hello, rebuilt/package-tested the native addon,
and passed license/vulnerability/portability gates. Linux CI and isolated clean checkout also PASS in run
`https://github.com/hed88798-dot/ai-video-platform/actions/runs/33089679957`. Formal 4-core performance is not
inferred from either job.

## Persistence, backup and recovery

Migration 002 is additive/forward-only and does not modify migration 001. Existing Desktop backup runs before
migration. Main validates schema, containment, artifact hashes, dimension and signatures before a short
transaction. A new Asset revision becomes active only after all Shot/Keyframe/Descriptor/Embedding rows commit;
a new cache generation becomes active only after manifest/hash/signature/row mapping validation. Failures keep
the old active revision/generation. Checkpoint recovery reuses only hash-verified artifacts with matching
generation inputs.

## Requested F review focus

- Linux clean checkout / CI and Windows native regression.
- Windows PyInstaller Worker boundary, native wheels, wheel SBOM/licenses and signing boundary.
- Official revision/license, ONNX provenance/hash/storage references, checked Manifest and binary exclusion from Git.
- Production Worker absence of torch/transformers, Provider secrets, SQLite direct write and HTTP listener.
- Migration 002, backup/recovery, old-revision and cache-generation atomicity.
- `ARCHITECTURE_QUESTION_SIGLIP_TEXT_INPUT_V2.md`: official tokenizer declares only fixed `input_ids`; approve the
  versioned preprocess v2 semantics or request a superseding decision. Sidecar/DTO/SQLite contracts are unchanged.
- Secret, license, vulnerability and portability results.

## Formal acceptance blockers

```text
500_ASSET_TEST: BLOCKED
WINDOWS_4_CORE_8GB_PROFILE: BLOCKED
WINDOWS_4_CORE_16GB_PROFILE: BLOCKED
GOLDEN_RETRIEVAL_QUALITY: BLOCKED
MODEL_DISTRIBUTION_SIGNING: BLOCKED
V0_3_INDEX_ACCEPTANCE: BLOCKED
```

Code D has not started and must remain blocked on real-index risk closure.
