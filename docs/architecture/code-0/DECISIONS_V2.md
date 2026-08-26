# Decisions V2：Code 0 正式 ADR 汇总

状态：Proposed for architecture review  
决策日期：2026-08-27  
原则：先做简单、确定、可交付的 AI 素材生产与“动物 + 产品”轻量混剪；数字人独立。

审核通过后，每项拆为 `docs/adr/ADR-xxx-*.md`；改变 Accepted ADR 必须新增 superseding ADR，不直接改写历史。

## ADR-001：Electron 是 V1 唯一桌面框架

**状态**：Proposed  
**背景**：Windows 优先，同时需要文件系统、SQLite、FFmpeg、sidecar、自动更新和高迭代效率。  
**决定**：Electron + React/TypeScript；首发固定受支持且经过 soak 的 43.4.x 最新补丁，不追刚发布主版本。  
**后果**：包体/内存高于 Tauri；换取 Node 桌面生态、成熟 updater/installer、调试和 Code 智能体可维护性。必须 sandbox renderer、context isolation、无 Node integration，并按官方最近三个主版本支持节奏月度升级。  
**重审触发**：Electron 安全/更新无法满足商业交付，或实测资源占用导致目标设备不可用。不是因“安装包想再小一点”就重写。

[Electron 支持节奏](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)、[安全清单](https://www.electronjs.org/docs/latest/tutorial/security)、[Tauri sidecar](https://v2.tauri.app/develop/sidecar/)

## ADR-002：使用受控 Python 媒体智能 sidecar

**状态**：Proposed  
**背景**：镜头检测、ONNX 和视觉处理的成熟生态集中在 Python；把全部逻辑写 Node/Rust 会增加重造成本。  
**决定**：Python sidecar 只执行无业务状态的媒体任务，通过 stdio NDJSON 通信；主进程负责生命周期、权限、超时和结果提交。  
**后果**：安装包更大且需打包/漏洞维护 Python；换取成熟算法生态。sidecar 不直接写业务 SQLite、不开放 localhost HTTP、不持有 Provider Key。  
**重审触发**：分发体积或安全维护不可接受，且同等成熟的 Rust/Node 方案通过完整 benchmark。

## ADR-003：SQLite 是 V1 唯一本地业务数据库

**状态**：Proposed  
**背景**：单用户本地优先，数据为产品、文案、素材 metadata、任务和 Timeline，无多人并发。  
**决定**：SQLite WAL、本机磁盘、桌面主进程单写者；版本化 migration 和 Backup API。  
**后果**：简单、易迁移备份；不适合网络共享/多人并发写。大媒体仍在企业文件夹。  
**重审触发**：产品正式引入多人实时协作或远端共享写入；这属于新 Scope，而非 V1 优化。

[SQLite WAL](https://www.sqlite.org/wal.html)、[Backup API](https://www.sqlite.org/backup.html)

## ADR-004：V1 使用精确向量检索，不上向量数据库

**状态**：Proposed  
**背景**：预计数万 Shot；FAISS/Qdrant 增加 Windows 打包、server/端口和备份复杂度。  
**决定**：SQLite float16 BLOB 为向量真源；可重建连续 `.f16` mmap + NumPy 分块点积做 exact cosine。  
**后果**：实现小、结果确定、可备份；规模大时线性成本上升。  
**重审触发**：≥100k Shot，或 50k Shot P95 连续两个版本 >200 ms 且批量/内存优化无效；届时优先评估 USearch，不默认 FAISS/Qdrant。

## ADR-005：SigLIP 2 是唯一 V1 视觉 embedding

**状态**：Proposed  
**背景**：需要中英文图文检索、CPU 可运行、许可清晰。  
**决定**：`google/siglip2-base-patch32-256` 官方 Apache-2.0 权重，自行导出固定 ONNX；关键帧聚合为 Shot 向量。  
**后果**：无需在产品运行时加载大型训练框架；导出/量化必须对 golden set 验证，模型版本改变需新 index generation。  
**重审触发**：最低支持 CPU 不达标或兽药 Top-K 指标不达门槛，且替代模型在相同许可/资源条件下显著胜出。

[SigLIP 2 官方模型卡](https://huggingface.co/google/siglip2-base-patch32-256)

## ADR-006：结构化 Descriptor 必需，通用 VLM 非必需

**状态**：Proposed  
**背景**：纯向量会产生明显物种/场景错配，但普通 CPU 不适合对全视频运行大 VLM。  
**决定**：稳定 VisualDescriptor 和 metadata filtering 是必需能力；Florence-2-base-ft ONNX 仅作为关键帧增强，可关闭/延迟，未知保持 unknown。  
**后果**：无 VLM 也能索引/检索；描述丰富度可能较低，但不会因 VLM 失败阻断。行业字段以 namespace 扩展。  
**重审触发**：规则 + embedding 无法达到物种冲突门槛，且 VLM 在最低 CPU 上通过成本/许可/准确率门槛。

[Florence-2 官方模型卡](https://huggingface.co/microsoft/Florence-2-base-ft)

## ADR-007：本地 ASR 使用 whisper.cpp

**状态**：Proposed  
**背景**：V1 需要 CPU 中文 ASR 和时间轴，同时控制 Python/FFmpeg 传递依赖。  
**决定**：whisper.cpp 核心 + OpenAI Whisper small Q5 模型；FFmpeg 先转 16 kHz mono WAV。构建排除 GPL 的 ffmpeg-transcode 示例。  
**后果**：本地隐私和可预测成本；模型包较大、速度需实测。faster-whisper 仅 benchmark，不随未审计 PyAV wheel 分发。  
**重审触发**：中文术语/CPU 性能不达批准线，或出现许可更清晰、显著更优的本地方案。

[whisper.cpp](https://github.com/ggml-org/whisper.cpp)、[OpenAI Whisper MIT](https://github.com/openai/whisper)

## ADR-008：只分发可审计的 LGPL FFmpeg

**状态**：Proposed  
**背景**：闭源商业安装包需要裁切/字幕/合成，但常见 FFmpeg 整合包带 GPL x264/x265。  
**决定**：固定源码自建动态 FFmpeg，`--disable-gpl --disable-nonfree`，不含 libx264/libx265；Windows H.264 优先 `h264_mf`。履行 LGPL source/build/notice/replaceability。  
**后果**：需要可复现原生构建和硬件/系统编码器兼容测试；商业专利问题独立评估。  
**重审触发**：`h264_mf` 覆盖不足；只能在法务批准新的编码器/分发方案后改变，不能静默启用 libx264。

[FFmpeg 官方法律清单](https://ffmpeg.org/legal.html)

## ADR-009：平台 Key 只在 Lightweight Backend

**状态**：Proposed  
**背景**：桌面客户端无法可靠隐藏平台 Provider Key。  
**决定**：Caddy + Fastify + SQLite 单 VPS + 短期对象存储；负责授权、allowlist 代理、成本/用量、限流、版本/更新。  
**后果**：月基础成本约 ¥80–200 加实耗，需要最小运维和备份；避免建设 SaaS、Redis/K8s/GPU 平台。  
**重审触发**：单实例 SLA/并发/账本一致性无法满足已签商业承诺，以实测和合同驱动迁移。

## ADR-010：Provider 通过能力协议与静态成本路由

**状态**：Proposed  
**背景**：供应商价格、模型和条款变化快，业务不能写死厂商。  
**决定**：七个 Provider 接口；业务只传 capability/model alias/质量档。后端用法律 allowlist、预算和熔断选择低成本 primary + fallback；全量记录成本/延迟/结果。  
**后果**：适配器和契约测试有额外工作；可配置切换 API/自部署且不动业务。免费额度不进入商业预算假设。  
**重审触发**：需要基于大规模真实数据的动态质量/价格优化；另立 ADR，不能变成提示词 Agent。

## ADR-011：Auto Edit route 永久冻结为三值（V1）

**状态**：Proposed  
**背景**：V1 要可靠，而非覆盖所有视觉类型。  
**决定**：只允许 ANIMAL、PRODUCT、NO_MATCH。产品规则优先绑定当前 product_id；动物用向量召回 + metadata filter + rerank；低置信 NO_MATCH。  
**后果**：覆盖率低于硬匹配系统，但错误素材更少、可解释可人工补。  
**重审触发**：V1 发布后有新 Scope；新增 route 必须是新 enum/version 和独立 matcher，不能扩写既有职责。

## ADR-012：Digital Human 是独立 bounded context

**状态**：Proposed  
**背景**：数字人生产链与动物/产品 B-roll 检索不同，耦合会污染索引和匹配算法。  
**决定**：Digital Human 生成 standalone VideoAsset；Auto Edit 编译期禁止依赖其包、表、Provider 或 UI。V1 没有 AVATAR route。  
**后果**：数字人不能自动插入混剪，但可独立交付、关闭和演进。未来通过新 `AVATAR Route + AvatarMatcher/Adapter` 接入。  
**重审触发**：架构审核后的新版本明确批准 AVATAR Scope；AnimalMatcher/ProductMatcher/现有索引语义仍不修改。

## ADR-013：Shot 是唯一搜索单位

**状态**：Proposed  
**背景**：整条视频可含多个完全不同场景。  
**决定**：所有语义、关键帧、descriptor、embedding 和匹配引用 Shot；结果必须含 asset/start/end。  
**后果**：索引对象更多、首次分析更慢；换取可用裁切和准确检索。Timeline 固定源 revision。  
**重审触发**：不取消；未来可增加 sub-shot/track，但整视频不能重新成为唯一搜索单位。

## ADR-014：索引、模型和契约全部版本化

**状态**：Proposed  
**背景**：模型/Prompt/检测器变化会悄悄改变结果，商业升级必须可回滚。  
**决定**：记录 index schema、embedding/VLM/prompt/detector/file hash；SQLite migration；跨进程 schema version；新 index generation 原子切换。  
**后果**：磁盘会暂时保留两代索引，开发需写迁移/兼容测试；换取回滚和可复现。  
**重审触发**：不取消；只可通过新 ADR调整保留期/兼容窗口。

## ADR-015：索引风险早于数字人实现

**状态**：Proposed  
**背景**：本地 CPU 索引决定 Auto Edit 可行性，原计划将其排在数字人之后，风险反馈太晚。  
**决定**：v0.3 完成索引，v0.4/0.5 完成混剪主链，v0.6 再交付独立数字人。  
**后果**：尽早暴露模型、性能和数据问题；数字人仍可按独立契约并行调研，但不阻塞主链。  
**重审触发**：不为市场演示跳过验收；若调整顺序，仍不能让数字人耦合 Auto Edit。

## ADR-016：开源依赖按实际 artifact fail closed

**状态**：Proposed  
**背景**：仓库 LICENSE、模型权重、FFmpeg build、字体和 API 输出是不同权利层。  
**决定**：发布生成 SBOM、NOTICE、MODEL_MANIFEST、FFMPEG_BUILD、Provider legal allowlist；未知/GPL/AGPL 默认拒绝。LGPL 只有完整履责时允许。  
**后果**：发布多一道人工/自动门禁，某些方便的整合包和 ComfyUI 本体不能捆绑。  
**重审触发**：只能由书面法务意见和新的分发策略 supersede，不能用技术负责人临时豁免。

## 架构审核签字项

审核者应明确接受或否决：Electron、Python sidecar、SQLite + exact vectors、SigLIP 2、可选 VLM、whisper.cpp、LGPL FFmpeg、最小后端、三值 route、数字人隔离、迭代重排和许可证闸门。任何未决项必须形成新 ADR 编号，不能以“实现时再说”进入 Code A–F。
