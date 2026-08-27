# Code C Completion Report — Local Media Intelligence + CPU Index v0.3

报告日期：2026-08-27（Asia/Shanghai）

## 结论

```text
CODE_C_IMPLEMENTATION: PASS
CODE_C_LOCAL_GATES: PASS
CODE_C_MERGE_READINESS: BLOCKED_PENDING_F_REVIEW
V0_3_INDEX_ACCEPTANCE: BLOCKED
```

Code C 已同步 `main@8e3a98ab664d0737ddf2c9d02002242b88e0c71c`，ADR-017 已接受，
Media Index v1 Contract 已批准。固定官方 revision 的 SigLIP 2 image/text encoder 已离线导出为
真实 FP32 ONNX，完成 provenance、SHA-256、PyTorch/ORT correctness 与真实 Video → Index → SQLite
→ Cache → Text Search E2E。模型二进制不进入 Git；Manifest 指向不可变、内容寻址的 Git LFS
model-pack tag。

## 工程状态

```text
BRANCH:
code-c/local-media-index-v0.3

ORIGINAL_C_BASELINE:
b04b8c152cd3e589b17246f53bab16262aefe313

SYNCED_MAIN_SHA:
8e3a98ab664d0737ddf2c9d02002242b88e0c71c

SIDECAR_PROTOCOL_VERSION:
1.0

DESKTOP_MIGRATION:
002_media_index_v1.sql (forward-only)

KEYFRAME_POLICY_VERSION:
safe-mid-best-v1 (ADR-017 Accepted; Real Golden performance PENDING)

SIGLIP_MODEL:
google/siglip2-base-patch32-256

SIGLIP_MODEL_REVISION:
9e7ee68506177b546b2d5dc578f54afdc5e425f1

SIGLIP_SOURCE_LOCK_HASH:
3f628585475283c2b50bd8040acb2f47767b3cebc4b07cdf9ae08bde47e4b82d

ONNX_OPSET:
18

ONNXRUNTIME_VERSION:
1.29.0

PREPROCESS_VERSION:
siglip2-processor-256-bicubic-mean0.5-official-text-v2

IMAGE_ENCODER_ONNX:
logical_id: google-siglip2-base-patch32-256/image-encoder-onnx-fp32/sha256:ef5f7b69830c352e57f15668092d7323521836c16fff2d71d14549b75eca6059
sha256: ef5f7b69830c352e57f15668092d7323521836c16fff2d71d14549b75eca6059
size: 378435041 bytes

TEXT_ENCODER_ONNX:
logical_id: google-siglip2-base-patch32-256/text-encoder-onnx-fp32/sha256:12bccdb491a98d224df1e6b6b249378118c6cfb54c18f6eb12286ffce8b26f30
sha256: 12bccdb491a98d224df1e6b6b249378118c6cfb54c18f6eb12286ffce8b26f30
size: 1129415247 bytes

MODEL_MANIFEST_STRUCTURE:
PASS

MODEL_ARTIFACT_PROVENANCE:
PASS

MODEL_ARTIFACT_HASH:
PASS

MODEL_ARTIFACT_STORAGE:
PASS — Git LFS model-pack tag model-pack-siglip2-9e7ee685-opset18-fp32
tag commit: 96fc88b3a0139ea5d927fa183b381b314ac7057c

MODEL_RUNTIME_CORRECTNESS:
PASS

MODEL_DISTRIBUTION_SIGNING:
BLOCKED (Code F / Desktop Model Pack release boundary)

PYTORCH_ORT_CORRECTNESS:
PASS — image/text [4,768], allclose, finite, ranking-consistent; production tokenizer IDs match official

REAL_SIGLIP_ONNX_E2E:
PASS — 2 real ONNX Shot embeddings committed through Main, exact text search returned hydrated Shot evidence

PRODUCTION_WORKER_CONTAINS_TORCH:
NO

PRODUCTION_WORKER_CONTAINS_TRANSFORMERS:
NO

LOCAL_PACKAGED_WORKER_RUNTIME:
PASS — PyInstaller artifact hash 56d77301511838162515d311d2997102be51694263ecd0223242932dde8894ae

WINDOWS_WORKER_PACKAGING:
PASS — Windows native smoke run 33089679168

WINDOWS_WORKER_RUNTIME_SMOKE:
PASS — packaged ORT CPU load, torch/transformers absence and stdio hello

MACOS_50K_SEARCH_BENCHMARK:
PASS — P95 18.41 ms; 50,000 x 768 float16; Apple M3 / 8 GB

SECOND_SCAN_ZERO_REPROCESS:
PASS

SINGLE_FILE_REBUILD:
PASS

MOVED_SAME_HASH_ZERO_REPROCESS:
PASS

INTERRUPT_RECOVERY:
PASS

INDEX_GENERATION_ATOMIC_SWITCH:
PASS

CACHE_DELETE_REBUILD:
PASS

ROW_SHOT_MAPPING:
PASS

CACHE_SIGNATURE_VALIDATION:
PASS

CORRUPTED_MEDIA_RESULT:
PASS

MALICIOUS_PATH_INPUT_RESULT:
PASS

MOTION_SENSITIVE_FALSE_CLAIM_TEST:
PASS

LOCAL_TYPESCRIPT_TESTS:
PASS — 221 passed, 2 expected skips

LOCAL_PYTHON_TESTS:
PASS — 18 passed

SIDECAR_BACKWARD_REGRESSION:
PASS — 10 passed; protocol remains 1.0

SECRET_SCAN:
PASS

LICENSE_SCAN:
PASS — first-pass source/build inventory; distribution notices/signing remain release gates

VULNERABILITY_SCAN:
PASS at moderate threshold — no moderate/high/critical advisory; one low dev-server esbuild advisory remains

LINUX_CI:
PASS — CI run 33089679957

WINDOWS_NATIVE_REGRESSION:
PASS — Windows native smoke run 33089679168
```

## 正式验收阻塞项

```text
500_ASSET_TEST: BLOCKED
WINDOWS_4_CORE_8GB_PROFILE: BLOCKED
WINDOWS_4_CORE_16GB_PROFILE: BLOCKED
GOLDEN_RETRIEVAL_QUALITY: BLOCKED
MODEL_DISTRIBUTION_SIGNING: BLOCKED
V0_3_INDEX_ACCEPTANCE: BLOCKED
```

这些状态没有用合成 fixture、Apple M3 搜索基准或本地打包结果冒充。Code D 未启动。

## Architecture Question

`ARCHITECTURE_QUESTION_SIGLIP_TEXT_INPUT_V2.md` 已提交 Code F：固定 official revision 的 tokenizer
只声明 `input_ids`，官方 text transformer 默认推理不产生 `attention_mask`。当前 artifact 与生产 Worker
使用官方固定长度输入语义，preprocess version 已升级并进入 Index Signature；Sidecar、DTO、SQLite 和
embedding dimension 均未改变。等待 F 对该正式模型语义确认。
