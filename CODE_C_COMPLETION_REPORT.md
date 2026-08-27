# Code C Completion Report — Local Media Intelligence + CPU Index v0.3

报告日期：2026-08-27（Asia/Shanghai）

本报告只覆盖 Code C：Shot 索引、增量文件身份、恢复、质量、SigLIP 2 ONNX 边界、
VisualDescriptor 证据、SQLite float16 真源、search cache 与 exact search。没有进入 Auto Edit、
Matcher、Timeline、Provider、Digital Human 或最终 FFmpeg 成片。

## 结论

`LOCAL_IMPLEMENTATION: PASS`  
`LOCAL_CI_EQUIVALENT: PASS`  
`V0_3_INDEX_ACCEPTANCE: BLOCKED`

阻塞原因不是已知代码失败，而是当前 workspace 没有授权 ≥500 条真实兽药视频、官方导出的
SigLIP 2 ONNX artifact、Windows 4 核 8 GB/16 GB 验收机和当前分支远端 CI 结果。任务书明确
禁止猜性能或伪造模型/真实数据结果，因此这些项目保留为 `BLOCKED`。

```text
BRANCH:
code-c/local-media-index-v0.3

BASELINE_SHA:
b04b8c152cd3e589b17246f53bab16262aefe313

FINAL_SHA:
见最终交付消息；Git commit 无法在自身内容中可靠自引用自身 SHA

SIDECAR_PROTOCOL_VERSION:
1.0

INDEX_SCHEMA_VERSION:
1.0 (desktop SQLite migration 002)

INDEX_SIGNATURE_VERSION:
1.0

SHOT_DETECTOR:
PySceneDetect.AdaptiveDetector

SHOT_DETECTOR_VERSION:
0.7.1

SHOT_DETECTOR_PARAMS_HASH:
4b8dcee936e5937cf0040c83bb0883837a38d174fb1f1ee632d5ebfaa8247e10

KEYFRAME_POLICY_VERSION:
safe-mid-best-v1

KEYFRAME_POLICY_DECISION:
Proposed / versioned implementation. 25/50/75 对照实现与 Golden benchmark harness 已交付；
合成 fixture 选择 safe/mid/best，授权真实素材比较等待 Code C review。

SIGLIP_MODEL_REVISION:
9e7ee68506177b546b2d5dc578f54afdc5e425f1

SIGLIP_SOURCE_HASH:
3f628585475283c2b50bd8040acb2f47767b3cebc4b07cdf9ae08bde47e4b82d
(固定 source-lock 全文件清单的 canonical SHA-256)

SIGLIP_ONNX_HASH:
BLOCKED — 未生成/未提交伪 artifact；export 后由 MODEL_MANIFEST.json 记录 image/text encoder 各自 SHA-256

ONNX_OPSET:
18

ONNXRUNTIME_VERSION:
1.29.0

PREPROCESS_VERSION:
siglip2-processor-256-bicubic-mean0.5-v1

OFFICIAL_MODEL_REVISION:
PASS

ONNX_ARTIFACT_HASH:
BLOCKED

ONNX_OUTPUT_VALIDATION:
BLOCKED — export tool 已实现 PyTorch/ORT allclose gate，缺正式 artifact 执行结果

FP32 / ONNX TOP-K REGRESSION:
BLOCKED — evaluator 已交付，缺只读授权 Golden Set 与正式 ONNX 输出

SIGLIP_FP32_TOP5:
BLOCKED

SIGLIP_ONNX_TOP5:
BLOCKED

INT8_ENABLED:
NO

SIGLIP_INT8_TOP5:
NOT RUN

QUANTIZATION_RECALL_DELTA:
NOT RUN — 没有在缺 Golden Set 时启用 INT8；未来启用必须满足下降 <= 2 percentage points

500_ASSET_TEST:
BLOCKED — 真实企业素材不在 Git/workspace

TOTAL_VIDEO_DURATION:
BLOCKED

SHOT_COUNT:
BLOCKED

AVERAGE_SHOTS_PER_ASSET:
BLOCKED

FIRST_INDEX_WALL_TIME:
BLOCKED

REALTIME_FACTOR:
BLOCKED

SECOND_SCAN_ZERO_REPROCESS:
PASS (automated synthetic inventory fixture)

SINGLE_FILE_REBUILD:
PASS (automated synthetic inventory fixture)

MOVED_SAME_HASH_ZERO_REPROCESS:
PASS (inventory + SQLite integration fixture)

INTERRUPT_RECOVERY:
PASS (hash-verified per-Shot checkpoint + old active revision integration test)

INDEX_GENERATION_ATOMIC_SWITCH:
PASS

CACHE_DELETE_REBUILD:
PASS

ROW_SHOT_MAPPING:
PASS

CACHE_SIGNATURE_VALIDATION:
PASS

50K_SEARCH_P95:
23.30 ms (30 queries, 50,000 x 768 float16, NumPy mmap, float32 accumulation)
Host: Apple M3 / 8 physical cores / 8 GB RAM / macOS 15.5 arm64
Formal Windows profile: BLOCKED

8GB_CPU_PROFILE:
BLOCKED — search-only macOS 8 GB baseline PASS; Windows 4-core full-index profile not run
WALL_TIME:
BLOCKED
PEAK_RAM:
BLOCKED for full index
CPU:
BLOCKED for formal profile

16GB_CPU_PROFILE:
BLOCKED — Windows 4-core full-index profile not run
WALL_TIME:
BLOCKED
PEAK_RAM:
BLOCKED
CPU:
BLOCKED

VLM_OFF_RESULT:
BLOCKED for official-model end-to-end; base Shot/Quality/Embedding/Search path is implemented and VLM-independent

VLM_ON_RESULT:
NOT_ENABLED

MOTION_SENSITIVE_FALSE_CLAIM_TEST:
PASS (static evidence guard fixtures; real motion Golden cases remain part of 500-asset milestone)

CORRUPTED_MEDIA_RESULT:
PASS (stable per-file probe failure; no folder-wide crash)

MALICIOUS_PATH_INPUT_RESULT:
PASS (Chinese/space path, symlink escape, manifest/artifact containment, argv shell=false)

MODEL_MANIFEST:
BLOCKED overall — schema/source-lock/export provenance PASS; final ONNX artifact manifest awaits export

LICENSE_SCAN:
PASS (first-pass Node + exact-pinned Python/model allowlist); release wheel/model SBOM remains release gate

LINUX_CI:
BLOCKED remote / LOCAL EQUIVALENT PASS

WINDOWS_NATIVE_REGRESSION:
BLOCKED remote; existing workflow preserved and extended with worker tests

KNOWN_FAILURES:
1. No authorized >=500-video veterinary Golden Set mounted.
2. No official SigLIP 2 FP32 ONNX artifact generated in this workspace.
3. No FP32/ONNX/INT8 retrieval-quality result without the artifact and Golden Set.
4. No Windows 4-core 8 GB/16 GB full-index, UI responsiveness, pause latency or thermal run.
5. Florence-2 remains intentionally NOT_ENABLED.

ARCHITECTURE_QUESTIONS:
ADR-017: 25/50/75 vs safe/mid/best-quality. Implementation recommends safe-mid-best-v1,
but final acceptance waits for the authorized Golden comparison.

CONTRACT_CHANGE_PROPOSALS:
docs/architecture/CONTRACT_CHANGE_PROPOSAL_MEDIA_INDEX_V1.md
Non-breaking Sidecar protocol 1.0 method additions + forward-only SQLite migration 002 + Main-owned narrow commit.

V0_3_INDEX_ACCEPTANCE:
BLOCKED
```

## 已完成的工程不变量

- Python worker 不打开业务 SQLite、不监听 HTTP、不持有 Provider secret。
- Main 在 schema、job path、artifact hash、embedding dimension 和 signature 校验后短事务提交；失败时旧 revision 继续 active。
- Asset signature 绑定单文件 hash；generation key 绑定共同模型/预处理/检测器/关键帧策略；全局 generation signature 再绑定全部 Asset revision，避免多文件漏搜或跨模型混用。
- SQLite `vector_f16 BLOB` 是真源；cache 可删、可重建，matrix/hash/row mapping/signature 任一不一致即拒绝。
- Search 返回 `asset_id + shot_id + start_ms + end_ms + revision`；计算使用同一 SigLIP 2 text encoder、NumPy mmap、float32 accumulation。
- 未变化文件走 stat 快路径；mtime/路径变化后计算真实 SHA-256；同 hash 移动/重复位置复用 Asset；缺失位置不删除 revision。
- Probe/Shot Detection 与每个已完成 Shot 都有 checkpoint；恢复只复用 hash 验证通过且 generation 输入相同的 artifact。
- `health_state` 没有批准证据保持 unknown；静态关键帧不能高置信输出咳嗽、喘气、跛行、抽搐等 motion-sensitive claim。

完成 Code C 实现后停止；没有进入 Code D。
