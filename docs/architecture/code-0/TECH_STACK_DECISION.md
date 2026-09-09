# V1 技术栈唯一决策

快照日期：2026-08-26。版本均应在实现 PR 中锁定精确 patch 与 hash；本文给出系列和选择，不鼓励追随刚发布主版本。

历史说明：本文件最初批准的 Media Worker 基线是 Python 3.12 x64。该项已由
`ADR-018-media-worker-python-3-13-15.md` 明确取代；其余 Code 0 技术决策及历史证据不因本次工具链变更而改写。

## 最终栈

| 层 | 唯一选择 | V1 用途 | 选择理由 |
|---|---|---|---|
| 桌面壳 | Electron 43.4.x 支持线 | Windows 壳、进程、更新 | 综合集成与维护风险最低；不是包体最小 |
| 构建/更新 | electron-builder 26.15.x + electron-updater | NSIS、签名更新 | Windows 成熟；避免刚出现的 v27 breaking changes |
| UI | React + TypeScript + Vite | Renderer | 团队/智能体生态、组件和测试成熟 |
| UI 组件 | Ant Design + 少量 CSS tokens | 表单、表格、任务、素材 | 企业桌面效率高；避免自建基础组件体系 |
| 状态 | Zustand + TanStack Query | 本地 UI/异步 job | 小而直接；服务状态仍以 Main/SQLite 为准 |
| Contract | JSON Schema 2020-12 + Zod | IPC、sidecar、backend | JSON Schema 为语言中立真源，生成 TS/Python 类型 |
| 主进程 | TypeScript / Node（随 Electron） | 业务编排、文件、DB | 与 UI/后台共享语言；不引入 Rust |
| 本地 DB | SQLite + better-sqlite3 | 全部结构化本地数据 | 单机单写者足够；同步事务易推理 |
| AI/媒体 worker | Python 3.13.15 x64 + PyInstaller | scene、ONNX、向量 | Python AI 生态成熟；版本兼容面可控 |
| Shot | PySceneDetect 0.7.1 AdaptiveDetector | 镜头边界 | BSD-3，成熟 API，支持内容/自适应检测 |
| 图像 I/O | OpenCV 4.x + Pillow | 帧、质量、缩略图 | 不采用刚发布的 OpenCV 5 作为 V1 基线 |
| 推理 | ONNX Runtime CPU | embedding/VLM | Windows CPU、INT8、线程控制与部署成熟 |
| Embedding | SigLIP 2 base patch32/256 official weights | 图文检索 | 多语言 image-text retrieval；Apache-2.0 权重 |
| VLM | Florence-2-base-ft official weights，可选 | caption/OD 增强 | 0.23B、MIT；不让其成为功能硬依赖 |
| Vector | SQLite BLOB 真源 + NumPy exact cosine cache | Top-K | V1 规模最简单、确定、可迁移 |
| ASR | whisper.cpp core + Whisper small Q5 | 中文时间轴 | CPU 友好、MIT；避开 PyAV GPL wheel 风险 |
| 媒体 | FFmpeg/ffprobe LGPL-only shared build | 裁切、字幕、合成 | 行业标准；自建可复现配置并履行 LGPL |
| 字体 | Noto Sans CJK SC | UI/字幕 | OFL-1.1，避免重分发微软雅黑 |
| 云网关 | Fastify + TypeScript + SQLite WAL + Caddy | 授权/代理/账本 | 单机最小栈；以后 repository 后可换 Postgres |
| Provider | capability protocol + server adapters | 所有生成能力 | 业务不写厂商判断 |
| 包管理 | pnpm workspace + uv locked worker env | 单仓依赖 | 确定性 lockfile 与缓存效率 |

## Electron 版本政策

尽调日 Electron 44.0.0 刚发布，43.4.x 与 42.10.x 仍受支持。V1 先选 43.4.x 最新 patch；每月执行升级分支、安全扫描与 smoke test。不得把“43”写成长期架构契约，契约是“官方支持窗口内、至少经过两周 soak 的最新稳定线”。

## 为什么需要 Python sidecar

需要，因为 PySceneDetect、模型导出验证、ONNX 图像预处理和候选 VLM 的成熟实现都在 Python。边界是：

- Node：业务规则、数据库、任务、Provider、Timeline；
- Python：纯媒体智能计算；
- FFmpeg/whisper.cpp：独立受控二进制；
- 不在 Python 再建 FastAPI/local server；
- 不在 Renderer 直接调用 Python。

打包用 PyInstaller 的 GPL-2.0 bootloader exception 允许生成闭源商业产物，但发布时仍保留其许可证文本并扫描所有被打入 worker 的依赖。[PyInstaller licensing](https://pyinstaller.org/en/stable/license.html)

## SQLite 与 embedding 存储

SQLite 足够，原因不是“以后也无限够用”，而是 V1 明确是单机单用户：

- products、scripts、assets、shots、descriptors、jobs、timelines、provider call summaries 都在 SQLite；
- 大文件不进 BLOB；缩略图、音频、视频在工作区；
- embedding 的**规范真源**为 SQLite `embedding.vector_f16 BLOB`；
- 运行缓存为按 active model 生成的连续 `.f16`/row-id manifest，校验后 memory-map；
- cache 损坏直接从 SQLite 重建；备份不依赖 cache；
- 50,000 × 768 × 2 bytes 约 76.8 MB，精确点积在普通办公机可控；
- 达到 100,000 Shot 或 P95 > 200 ms 才触发 ADR 评估 USearch。

明确不选：

- FAISS：能力强且 MIT，但 V1 规模不需要其 ANN/训练，Windows/BLAS/Python 打包增加风险；
- Qdrant：Apache-2.0 且成熟，但服务进程/端口/存储生命周期对单机 V1 过重；Python local mode官方也定位于测试或少量向量；
- sqlite-vec：方向很合适，但尽调时仍是 0.1.x；暂不让预 1.0 native extension成为核心存储契约；
- OpenCLIP runtime：代码 MIT，但不同 pretrained weights 许可证各自独立，且 PyTorch runtime 更大；只作为离线评估工具。

## Embedding 决策与门禁

候选固定为 `google/siglip2-base-patch32-256`，理由：SigLIP 2 的官方说明明确把多语言和 image-text retrieval 作为用途，模型卡为 Apache-2.0。[官方模型卡](https://huggingface.co/google/siglip2-base-patch32-256)

实现要求：

1. 从官方 safetensors 和 processor 文件自行导出 ONNX，不下载不明社区量化包；
2. 输出 L2 normalize；每个 Shot 取开头安全帧/中点/质量最佳帧，向量 normalize 后求均值再 normalize；
3. text query 同一模型；VisualIntent 同时保留中文原文与规范 taxonomy token；
4. 用真实黄金集比较 FP32/INT8：Top-5 recall 下降不得超过 2 个百分点；
5. 若 CPU 预算不达标，先减少关键帧/关闭 VLM，不擅自换模型；换模型必须升 `index_schema_version` 并重建。

## VLM 决策

`microsoft/Florence-2-base-ft` 是唯一 V1 候选，但属于**可选增强包**：

- 官方模型卡为 MIT、0.23B，支持 caption、object detection 等；
- 首次导出时审计 `trust_remote_code`，运行安装包不允许在线执行 remote code；
- 优先自行导出固定 ONNX 图与 tokenizer；
- 只对每个 Shot 的质量最佳关键帧做一次，低电量/低内存可暂停；
- VLM 输出是 evidence，不是事实；无法确认 `health_state` 时必须 `unknown`；
- taxonomy mapping 使用受控词表和 confidence，不让自由 caption 直接成为硬过滤条件。

因此对“本地 VLM 是否必要”的正式回答是：VisualDescriptor 必要，通用本地 VLM 不是成功路径硬依赖。

## ASR 决策

采用 whisper.cpp，而非 faster-whisper 的原因：

- whisper.cpp 核心与 OpenAI Whisper 权重为 MIT，CPU 量化和 Windows CLI 成熟；
- 输入先由受审计 FFmpeg 转成 16 kHz mono PCM WAV；
- 构建时只包含核心/CLI，明确排除仓库中标记 GPL 的 `examples/ffmpeg-transcode.cpp`；
- 默认 `small` Q5 作为中文质量档，低配可选 `base`；
- 输出 token/segment 时间轴后再做中文标点与切段；
- faster-whisper 可用于实验对照，但其 PyAV PyPI wheel 会捆绑启用 x264/x265 的 FFmpeg，闭源分发风险不接受。[PyAV wheel 构建说明](https://github.com/PyAV-Org/pyav-ffmpeg)

## FFmpeg 决策

采用 FFmpeg，但不是随便下载一个 Windows build：

- 自建/委托构建 `--disable-gpl --disable-nonfree`，不包含 libx264/libx265；
- shared DLL build，保存精确源码、patch、configure line、SBOM 和 hash；
- Windows H.264 首选 `h264_mf`，启动自检 encoder；没有合规 H.264 encoder 时阻止正式导出并给出明确诊断，不静默回退 libx264；
- AAC 使用 build 内合规 encoder，并另做专利法务评估；
- About、EULA、下载页、NOTICE 和同站源码包按 FFmpeg 官方 LGPL checklist 执行；
- 任何 Provider/第三方 wheel 自带 FFmpeg 都算独立分发项，不能被主 FFmpeg NOTICE“顺带覆盖”。

FFmpeg 官方说明基础为 LGPL-2.1+，启用 GPL parts 后整个 FFmpeg 适用 GPL，并特别指出 libx264。[FFmpeg Legal](https://ffmpeg.org/legal.html)

## UI 与 Timeline

- Ant Design 负责产品库、素材表、任务和设置；
- Timeline 不引入专业编辑器 SDK，使用 React 自绘的只读/轻编辑轨道；
- V1 操作仅为预览、换镜、锁镜、裁切入出点、字幕开关、比例和重新匹配；
- 时间数据全部用整数毫秒；最终由 renderer profile 按 30 fps 做确定性帧对齐；
- 不采用 MoviePy 作为成片核心，避免隐式 codec/default、版本兼容和额外对象图；直接生成 FFmpeg filter graph/concat plan。

## Provider 与 Backend 技术边界

- Provider adapter 只部署在 gateway；desktop 使用平台 capability API；
- Fastify 单进程、SQLite WAL、Caddy TLS，运行在 2 vCPU/4 GB Linux；
- 当前腾讯云内地同档公开刊例可到约 ¥80/月，区域、带宽和活动价会变化；预算按 **¥80–200/月 + 对象存储/流量 + AI 调用费**；
- 海外 API 为主时可部署香港/新加坡同规格；部署地域属于运营决策，不改变协议；
- 不在 V1 引入 Redis、Kafka、Kubernetes、微服务或管理后台；
- 大文件经短期签名对象存储直传，不穿过 Fastify 内存。

## 明确禁止的技术捷径

- Renderer 开 Node integration；
- localhost 无鉴权 HTTP sidecar；
- 把 Provider Key 混淆后写入客户端；
- 从 Hugging Face/插件市场运行未固定 hash 的 remote code；
- 用文件 mtime 代替内容哈希作为永久身份；
- 把完整视频作为搜索记录；
- PRODUCT 跨产品向量猜测；
- 分发 GPL FFmpeg、ComfyUI 或未知许可自定义节点；
- 将 VLM 的猜测写成产品事实或动物疾病诊断。

## 发布前技术验收

- Windows 10/11 干净虚拟机安装、升级、回滚、卸载；
- 离线打开本地库与完成本地搜索/渲染；
- 4 核/16 GB CPU 性能基线；
- SBOM 不含未批准 GPL/AGPL/NC；
- FFmpeg `-buildconf` 与 encoder 列表留档；
- 所有 model pack hash、license、来源和 model card 快照齐全；
- Provider mock、超时、重复 webhook、客户端崩溃恢复通过。
