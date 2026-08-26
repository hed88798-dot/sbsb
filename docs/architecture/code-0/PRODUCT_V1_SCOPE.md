**如果今天从零开始开发，我唯一推荐的 V1 架构是：Electron + React/TypeScript 桌面端，SQLite 本地真源，受控 Python 媒体智能侧车，FFmpeg/whisper.cpp 本地媒体链路，SigLIP 2 + 可选 Florence-2 本地索引，以及只保护平台密钥和记录用量的轻量 API 网关。**

# AI 电商短视频桌面软件 V1 范围

状态：Code 0 架构基线  
尽调快照：2026-08-26  
适用：Windows V1；行业首发为兽药电商，领域模型保持可扩展

## 决策摘要：15 个必须回答的问题

1. **Electron 还是 Tauri？** Electron。包体更大，但 Windows 安装/更新、Node 文件能力、原生模块、FFmpeg 与 Python 子进程管理、调试和智能体维护的综合风险更低。
2. **是否需要 Python sidecar？** 需要，但严格限定为媒体分析工作进程；桌面主进程拥有业务状态，侧车不直接成为第二套后端。
3. **SQLite 是否足够？** 足够。V1 是单机、单用户、单写者；数据库必须位于本机磁盘，不能放网络共享目录。
4. **FAISS / Qdrant / 其他选谁？** V1 选“其他”：SQLite 保存向量真源，启动时构建连续 `float16` 矩阵，用 NumPy 精确余弦 Top-K。达到 100,000 个有效 Shot 或搜索 P95 超过 200 ms 后，再评估 USearch；不在 V1 引入 Qdrant 服务或 FAISS 打包负担。
5. **Embedding 选什么？** `google/siglip2-base-patch32-256`，自行从官方 Apache-2.0 权重导出并验收 ONNX；按 3 个关键帧聚合为 Shot embedding。上线前必须用兽药黄金集通过 CPU、中文检索和量化精度门槛。
6. **本地 VLM 是否必要？** 不是成片硬依赖。结构化描述必要，本地 VLM 是可关闭的后台增强：候选为官方 MIT 权重 `microsoft/Florence-2-base-ft`；失败时字段保持 `unknown`，不阻塞 embedding 搜索。
7. **普通企业 CPU 能否首次索引？** 能，但必须后台增量运行。4 核/16 GB/无独显作为验收机，基础索引目标不高于素材时长 2 倍，含 VLM 增强不高于 6 倍；几百条素材可能运行数小时。未实测前这是验收预算，不是假定性能事实。
8. **Auto Edit V1 最小算法？** 时间感知切段 → 确定性 Product Route → 规则与轻量模型生成 Animal VisualIntent → embedding Top-K → metadata 硬过滤 → 轻量重排 → 去重复 Clip Selector → Timeline → FFmpeg。
9. **数字人如何彻底解耦？** `DigitalHumanJob` 只生成一个普通视频资产；Auto Edit 的 `VisualRouteV1` 无 `AVATAR` 值，且禁止引用 digital-human package。未来以新 `AvatarRouteAdapter` 注册，不修改 AnimalMatcher、ProductMatcher 或现有索引语义。
10. **Lightweight Backend 最小做什么？** 激活/设备授权、短期令牌、Provider allowlist 代理、异步任务与 webhook、用量/成本账本、限流/预算、版本与签名更新清单。它不保存本地素材、不做业务库云同步。
11. **AI API 如何最低成本？** 能力级静态路由：默认低价 Provider + 一条质量 fallback；先估价再执行；仅对明确未开始推理的失败回退；记录实际成本。免费额度只用于测试，不能作为商业 SLA。
12. **哪些 GitHub 代码值得实际采用？** PySceneDetect、ONNX Runtime、whisper.cpp 核心、SQLite、NumPy，以及经过自建配置审计的 LGPL FFmpeg；以依赖或受控二进制使用，不整仓 Fork。
13. **哪些只能借鉴？** MoneyPrinterTurbo、Auto-Editor、OpenCLIP 训练框架、FAISS/Qdrant、ComfyUI、LatentSync。它们分别存在职责不匹配、额外运行时、模型许可或 GPL 分发边界。
14. **哪些许可证不能进入闭源安装包？** 未经法务批准的 GPL/AGPL 代码和 GPL FFmpeg build；含 `libx264`/`libx265` 的 FFmpeg/PyAV wheel；NC/Research-only 权重；许可证不明的 LoRA、字体、模型和自定义节点。LGPL 仅在履行动态链接/源码/NOTICE/EULA 等义务后进入。
15. **Code A-F 如何拆分？** A 桌面与本地数据；B Provider 与轻后端；C 素材索引；D Auto Edit 与渲染；E 独立数字人；F 质量、发布、许可与性能。详见 `V1_REPO_PLAN.md`。

## V1 产品目标

V1 让一个兽药电商内容人员在 Windows 电脑上完成以下闭环：

1. 维护企业产品事实与素材；
2. 生成、优化或去重口播文案；
3. 通过托管 AI 生成动物、行业和产品素材；
4. 独立生成数字人口播资产；
5. 索引企业本地视频到 Shot；
6. 用文案或口播音频自动匹配“动物 + 产品”镜头；
7. 人工预览、替换低置信镜头并导出基础 MP4。

产品承诺是“可控地节省搜素材和基础剪辑时间”，不是“自动导演出最终广告片”。

## V1 包含

### AI 文案中心

- 从零创作：产品、目标、时长、方向、风格和口语化程度；
- 产品驱动：带货、科普、痛点、产品介绍和可扩展模板；
- 优化：结构、开头、压缩、扩写、口语化；
- 去重：轻度、中度、深度；
- 事实锁：产品名、成分、规格、适用范围、用法用量、禁忌和企业批准声明以结构化事实输入，生成结果不得静默改写；
- 每次结果保存事实快照、Provider、model、prompt template version 与人工确认状态。

文案功能不替代兽药广告审查、执业兽医判断或企业法务审核。涉及疗效、适应症、用量和承诺性表述时必须让用户确认。

### AI 动物与行业素材

- 文本提示词与参数输入；
- 生成猪、鸡、牛羊、养殖场景、行为、异常状态和人员工作镜头；
- 由 `VideoProvider`/`ImageProvider` 调用托管 API；
- 保存请求参数、来源、模型、成本、输出权利快照和内容审核结果；
- 模型及厂商均由后台目录配置，业务界面不写死。

### AI 产品素材

- 产品场景化、特写、手持、养殖场、实验室、广告场景；
- 图像编辑、首帧生成和必要的图生视频；
- 原图永不覆盖，所有编辑生成新资产并记录 lineage；
- Z-Image-Turbo、Qwen-Image-Edit-2511、MiniMax H3 只作为当期可评估模型，不成为领域接口名。

### 独立数字人口播

- 平台数字人母版和企业上传母版；
- 平台声音和经授权的企业克隆声音；
- `母版 + 文案 + 声音 → TTS → LipSync → 视频资产`；
- 字幕仅为该任务的可选输出；
- 保存肖像/声音授权确认与 Provider 处理告知；
- 产物可被用户手工使用，但 V1 Auto Edit 不自动选择或调用它。

### 本地素材库与智能索引

- 选择一个或多个本地文件夹；
- 增量扫描、文件哈希、Shot Detection、关键帧、质量、embedding、可选 VLM 描述；
- 搜索和预览单位是 Shot，结果包含 `asset_id/start_ms/end_ms`；
- 未变化文件不重算；失败可恢复；用户可重建单文件或整个索引；
- 原视频不移动、不改名、不写入。

### 轻量 Auto Edit

- 输入文案，或输入音频后本地 ASR；
- 生成短时稳定的 `ScriptSegment`；
- 路由仅允许 `ANIMAL | PRODUCT | NO_MATCH`；
- PRODUCT 永远绑定当前明确选择的 `product_id`，不跨产品向量猜测；
- ANIMAL 只检索本地动物/行业 Shot；
- NO_MATCH 延续邻镜、留空待补或提示用户；
- 提供镜头级置信度、替换候选、锁定镜头和重新匹配；
- 输出旁白、可选字幕、基础裁切/缩放和 MP4。

## V1 明确不包含

- 多租户 SaaS、复杂 RBAC、团队协作、云同步；
- 支付、CRM、ERP、电商交易；
- Kubernetes、GPU 集群、自研推理平台；
- 复杂 Agent、AI 导演、跨段叙事规划；
- 自动把数字人加入 Auto Edit；
- 自动批量生产 100 条完整视频；
- 历史全库查重和版权检测；
- 独立字幕中心、专业 NLE、多轨特效编辑器；
- 医疗/兽药合规自动审批；
- 在安装包中分发 ComfyUI、LatentSync 或大体量生成模型。

## 完整用户流程

### 第一次使用

1. 安装已签名软件并激活设备；
2. 选择本地工作区和输出目录；
3. 下载已签名的“基础索引模型包”和可选 ASR/VLM 包；
4. 创建企业产品，录入事实、别名、禁用表述、主图和包装图；
5. 选择本地素材文件夹，软件后台索引并显示进度、预计剩余量和失败项。

### 文案与 AI 素材

1. 选择产品或从空白开始；
2. 选择内容方向、时长和风格；
3. 生成或优化文案；
4. 查看事实差异提示并确认；
5. 必要时生成动物/产品图片或视频，预览成本后提交；
6. 接受的输出进入本地素材库，并标注为 generated 与 Provider provenance。

### 数字人口播

1. 进入独立“数字人口播”模块；
2. 选择已授权母版和声音；
3. 输入/选择文案，生成 TTS，再生成 LipSync；
4. 可选字幕并导出独立视频；
5. 任务结束，不跳转或注入 Auto Edit 路由。

### 自动混剪

1. 选择当前产品；
2. 输入文案或音频；
3. 确认 ASR 文本和切段；
4. 系统显示每段的 Route、VisualIntent、匹配镜头和置信度；
5. 用户处理 NO_MATCH、替换候选或锁定镜头；
6. 预览成本为 0（本地匹配与渲染）；
7. 生成 Timeline，选择字幕和画幅；
8. FFmpeg 导出到临时文件，校验后原子改名为最终 MP4；
9. 保存 Timeline 与 Provider/模型/索引版本，便于重现。

## 非功能范围与最低支持线

- 首发：Windows 10 22H2/Windows 11 x64；macOS 为后续构建目标；
- 8 GB 可运行文案与基础功能，16 GB 为本地索引推荐配置；
- 本地素材与产品数据默认不上传；调用云生成/数字人时必须明确提示将上传哪些文件；
- UI 在后台索引时可继续文案、浏览和编辑；
- 所有长任务可取消、可恢复、可查看失败原因；
- 日志默认脱敏，绝不记录 API Key、完整授权令牌或企业原始文案正文；
- 大文件在用户目录，SQLite 只存结构化数据、路径、哈希、小缩略图引用与 embedding 真源。

## V1 成功标准

- 真实黄金集中 Product Route 绑定错误为 0；
- 明确物种冲突的 Animal 匹配为 0；
- 未变化素材二次扫描不执行镜头检测、embedding 或 VLM；
- 4 核/16 GB 无独显验收机可完成首次索引，且 UI 不假死；
- 50,000 Shot 搜索 P95 小于 200 ms；
- 60 秒成片音画总时长误差不超过 1 帧，A/V 同步误差小于 80 ms；
- Provider Key 不存在于安装包、崩溃报告或客户端网络响应；
- 商业安装包 SBOM、NOTICE、FFmpeg 对应源码与模型许可清单齐全。

## 范围变更门禁

任何把 AVATAR、团队云同步、批量导演或新行业字段塞入 V1 核心枚举/表结构的变更都必须新建 ADR。新增行业只允许通过 taxonomy、`industry_metadata` 和 Provider catalog 扩展，不得复制一套“兽药专用引擎”。
