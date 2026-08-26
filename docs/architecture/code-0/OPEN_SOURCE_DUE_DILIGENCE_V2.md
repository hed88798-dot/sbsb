# 开源与模型尽调 V2

状态：Code 0 决策基线  
快照日期：2026-08-26  
适用场景：闭源收费 Windows 桌面软件

> 本文是工程尽调，不代替律师意见。发布前必须用最终锁文件、实际二进制和模型文件重新生成 SBOM 与许可证报告；“代码可商用”不等于“模型权重、输出、专利和 API 条款均无风险”。

## 结论分级

### 进入 V1 安装包或构建链

| 组件 | 版本/基线 | 许可证 | 用法与结论 |
|---|---|---|---|
| Electron | 43.4.x 支持线 | MIT | 桌面壳；保留 LICENSE/NOTICE。实现时锁精确 patch。 |
| React / TypeScript / Vite | 当前受支持稳定线 | MIT/Apache-2.0 | UI 与构建。按锁文件复核所有传递依赖。 |
| Ant Design / Zustand / TanStack Query | 稳定线 | MIT | UI、状态和远端任务状态。 |
| better-sqlite3 / SQLite | 稳定线；SQLite ≥3.45 | MIT；Public Domain | 本地数据。SQLite 为公有领域；封装库仍须记录 MIT。 |
| PySceneDetect | 0.7.1 | BSD-3-Clause | Shot Detection；直接调用公开 API，不复制内部源码。 |
| ONNX Runtime CPU | 稳定 LTS/受支持线 | MIT | 本地 embedding/VLM 推理。 |
| NumPy | 2.x 稳定线 | BSD-3-Clause | 向量归一化、批量精确余弦检索。 |
| whisper.cpp | 1.8.x | MIT（核心） | 本地 ASR；自行构建并排除 GPL 示例文件。 |
| FFmpeg | 发布时固定源码 commit | LGPL-2.1-or-later 配置 | 仅自建动态链接 LGPL 配置，禁用 GPL/nonfree 与 libx264/libx265。 |
| electron-builder / PyInstaller | 26.x / 稳定线 | MIT / GPL-2.0 with bootloader exception | 打包工具；PyInstaller 的例外允许闭源分发，仍保留其许可证。 |
| Noto Sans CJK SC | 固定字体版本 | SIL OFL-1.1 | 可嵌入；不得单独销售字体，保留 OFL 文本和名称要求。 |

依据：[Electron MIT](https://github.com/electron/electron/blob/main/LICENSE)、[PySceneDetect BSD-3-Clause](https://github.com/Breakthrough/PySceneDetect/blob/main/LICENSE)、[ONNX Runtime MIT](https://github.com/microsoft/onnxruntime/blob/main/LICENSE)、[SQLite 公有领域声明](https://www.sqlite.org/copyright.html)、[PyInstaller 许可证例外](https://pyinstaller.org/en/stable/license.html)。

### 模型候选：代码与权重分开核验

| 用途 | V1 候选 | 权重许可 | 决策 |
|---|---|---|---|
| 视觉 embedding | `google/siglip2-base-patch32-256` | Apache-2.0 | 唯一首选；从官方权重自行导出 ONNX，记录文件 hash、导出脚本版本和 tokenizer。 |
| 可选结构化 VLM | `microsoft/Florence-2-base-ft` | MIT | 仅增强；先在隔离环境导出并审计 ONNX，不在产品运行时执行远端自定义代码。 |
| ASR | OpenAI Whisper `small`，whisper.cpp Q5 模型 | MIT | 中文默认；模型文件作为可下载模型包，记录来源/hash。 |
| 生图 API 候选 | Z-Image-Turbo | Apache-2.0 | 权重许可较清晰，但经 API 使用时还要叠加服务商条款与输出条款。 |
| 图像编辑 API 候选 | Qwen-Image-Edit-2511 | Apache-2.0 | 同上；20B 不进入 V1 本地包。 |
| 图生视频 API 候选 | MiniMax H3 | 自定义社区许可 | 不能把“开放权重”当 Apache；V1 仅通过经法务批准的官方/授权 API 使用。 |
| LipSync API 候选 | LatentSync | 代码 Apache-2.0；官方权重 OpenRAIL++ | 仅托管服务候选；分别归档代码、权重及服务条款。 |

官方模型卡：[SigLIP 2](https://huggingface.co/google/siglip2-base-patch32-256)、[Florence-2-base-ft](https://huggingface.co/microsoft/Florence-2-base-ft)、[OpenAI Whisper](https://github.com/openai/whisper)、[Z-Image-Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo)、[Qwen-Image-Edit-2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511)、[MiniMax H3 LICENSE](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)、[LatentSync 权重许可](https://huggingface.co/ByteDance/LatentSync)。

## 源码级专项结论

### PySceneDetect：采用，不重写

`AdaptiveDetector` 在 `ContentDetector` 分数之上使用滚动窗口平均值来抑制快速运动造成的误切，已有成熟的场景管理、时间码和 CLI/API。V1 使用 AdaptiveDetector，保存阈值与版本到任务记录，并为硬切、淡入淡出、长静态镜头建立兽药素材回归集。镜头边界业务规则由本项目封装，避免依赖内部私有 API。

### SigLIP 2 + ONNX Runtime：采用权重和运行时，自建薄封装

SigLIP 2 官方模型卡明确包含多语言、图文检索用途和 Apache-2.0 权重。V1 不引入整套 OpenCLIP 运行时；导出固定 ONNX，使用官方预处理参数并用 golden set 验证 ONNX/量化前后排序一致性。[ONNX Runtime 量化指南](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)

### whisper.cpp：采用核心，不带 GPL 示例

核心为 MIT，适合 CPU、可独立分发。仓库中的 `examples/ffmpeg-transcode.cpp` 被项目自身 issue 标记为 GPL 来源，构建清单必须显式排除；音频统一由合规 FFmpeg 转为 16 kHz 单声道 WAV，再交给 whisper.cpp。[whisper.cpp](https://github.com/ggml-org/whisper.cpp)、[相关 GPL issue](https://github.com/ggml-org/whisper.cpp/issues/3838)

不采用 `faster-whisper` 作为 V1 安装包基线：其代码是 MIT，但常用 PyAV wheel 捆绑 FFmpeg，PyAV 的 wheel 构建包含 x264/x265，社区也曾就 wheel 的 GPL 合规提出问题。它可用于内部 benchmark，不能在未完成二进制审计前分发。[PyAV wheel 构建](https://github.com/PyAV-Org/pyav-ffmpeg)、[PyAV GPL issue](https://github.com/PyAV-Org/PyAV/issues/2270)

### FFmpeg：功能成熟，许可证配置决定能否分发

不重写裁切、拼接、音频混合、字幕烧录和封装。发布构建必须：

1. 使用可复现脚本从固定源码构建共享库；`--disable-gpl --disable-nonfree`。
2. 不包含 libx264、libx265 或其他 GPL/nonfree 依赖；H.264 优先 Windows Media Foundation `h264_mf`。
3. 在 About、EULA 和第三方页面明确 FFmpeg/LGPL，提供准确源码、构建参数和修改；允许用户替换 LGPL 动态库。
4. 验证最终 `ffmpeg -buildconf` 与动态库依赖，不只检查脚本。
5. 单独处理编解码器专利/地区问题；LGPL 不授予专利许可。

[FFmpeg 官方法律与分发清单](https://ffmpeg.org/legal.html)

### 向量检索：V1 不引入向量数据库

| 项目 | 许可/成熟度 | 源码与部署观察 | V1 结论 |
|---|---|---|---|
| FAISS | MIT；成熟 | Windows 官方路径不如 Linux 简单，二进制/BLAS 打包增加体积；V1 数据量无需 ANN。 | 不引入；只做算法 benchmark。 |
| Qdrant | Apache-2.0；成熟 | 桌面端需要额外 server/端口/生命周期；官方 local mode 更偏小规模和测试。 | 不引入。 |
| sqlite-vec | MIT/Apache-2.0；0.1.x | 很有前景，但 pre-1 API/格式尚不适合作为商业数据真源。 | 观察。 |
| USearch | Apache-2.0；成熟 | 支持持久化与 mmap，作为未来 ANN 的最小升级较合适。 | 达阈值后首选 ADR 候选。 |

参考：[FAISS](https://github.com/facebookresearch/faiss)、[Qdrant Local Mode](https://qdrant.tech/documentation/quick-start/)、[sqlite-vec](https://github.com/asg017/sqlite-vec)、[USearch](https://github.com/unum-cloud/usearch)。

### 自动视频编辑项目：只借鉴，不整体 Fork

| 项目 | 源码观察 | 结论 |
|---|---|---|
| MoneyPrinterTurbo | MIT 仓库的 `app/services/video.py` 以 MoviePy 组织片段，默认视频编码器是 `libx264`；其工作流偏网络素材与脚本成片。 | 借鉴任务拆分、字幕和 Timeline 编排；不迁移渲染代码，不整体 Fork。默认 libx264 不进入本商业安装包。 |
| Auto-Editor | Unlicense；当前核心为 Nim，已有 v3 Timeline 类型，但主问题是静音/运动删剪，不是本地语义 B-roll 检索。 | 借鉴可序列化 Timeline 与 CLI 可测试性；不迁移。 |
| OpenCLIP | MIT 代码成熟，checkpoint 注册与模型工厂完整，但不同权重许可独立，运行依赖比固定 ONNX 大。 | 借鉴预处理/评估；V1 不作为运行时。 |
| ComfyUI | GPL-3.0 | 可通过第三方托管 Workflow API 使用；不把 GPL 程序、节点或修改版捆入闭源安装包。 |

源码入口：[MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo)、[Auto-Editor](https://github.com/WyattBlue/auto-editor)、[OpenCLIP](https://github.com/mlfoundations/open_clip)、[ComfyUI](https://github.com/Comfy-Org/ComfyUI)。

## 迁移、借鉴与禁止清单

### 值得实际复用

- PySceneDetect 的公开 API；ONNX Runtime；whisper.cpp 核心；SQLite；Electron 生态；经审计的 FFmpeg。
- 复用指“依赖并固定版本”，不把上游大段源码复制进本仓库。

### 只借鉴设计

- MoneyPrinterTurbo 的任务流与字幕组织。
- Auto-Editor 的可交换 Timeline 表达。
- OpenCLIP 的模型评估方法。
- FAISS/Qdrant/USearch 的索引基准方法。

### 不进入闭源商业安装包

- GPL/AGPL 程序、库或节点：除非未来选择满足对应源代码开放义务并通过法务评审。
- `--enable-gpl` 或 `--enable-nonfree` 的 FFmpeg、libx264、libx265。
- GPL 的 ComfyUI 本体与第三方节点。
- 来源、许可或再分发权不清晰的模型权重、LoRA、字体、音乐、素材和“整合包”。
- 要求执行远端任意 Python 的模型包；先离线审计并导出固定图。

LGPL 不是绝对禁止：仅在动态链接、可替换、通知、源码/修改提供等义务可完整履行时允许。API 调用也不自动安全：必须审查服务条款、训练数据声明、输出权、内容政策、数据保留与地区限制。

## 发布许可证闸门

每个正式构建必须产出：

- `SBOM.cdx.json`：应用、Python wheels、原生 DLL、sidecar、模型包及 hash。
- `THIRD_PARTY_NOTICES.html`：许可证全文、版权声明、字体说明。
- `MODEL_MANIFEST.json`：权重来源、revision、license、hash、用途、是否允许再分发。
- `FFMPEG_BUILD.json`：源码 commit、configure、编译器、DLL、`-buildconf` 与下载地址。
- `PROVIDER_LEGAL_ALLOWLIST.json`：provider/model/能力/地区/输出权/批准日期。

CI 对 GPL/AGPL、未知许可证、未登记二进制和模型 fail closed；只有书面例外可以放行，且例外必须有到期日和负责人。
