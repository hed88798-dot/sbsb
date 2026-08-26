# V1 迭代计划与验收标准

## 顺序调整结论

原顺序总体方向正确，但本地素材索引是全项目最高技术风险，不能等数字人完成后才验证；数字人又是独立模块，不应阻塞“动物 + 产品”自动混剪主链。因此调整为：

```text
v0.1 基础壳/产品/文案
v0.2 托管 Provider 与 AI 图片/视频素材
v0.3 本地 Shot 索引风险闭环
v0.4 ANIMAL/PRODUCT 匹配与可编辑 Timeline 草稿
v0.5 ASR/字幕/FFmpeg 基础自动成片
v0.6 独立数字人口播
v0.7 真实兽药数据、性能、发布硬化
v1.0 商业交付
```

每一版本是可演示、可测试、可回滚的纵向增量，不以“代码写完”作为验收。任何新范围只能进入后续 ADR/版本，不能偷渡。

## 全程门禁

每个版本必须：

- 使用 `v0.x.x` 标签，记录 Git commit、数据库 schema、契约、sidecar、模型和 FFmpeg build ID。
- SQLite migration 在生产副本上做升级/失败恢复测试；升级前自动备份。
- 新跨模块对象先更新版本化 schema 和契约测试。
- 更新 ADR、SBOM、第三方 NOTICE、模型/Provider 法律清单。
- 通过上一版本 golden set，指标无未批准回退。
- 保留前一 stable 安装包和兼容数据恢复路径。

## v0.1：桌面基础、产品库、AI 文案

### 范围

Electron Windows 壳；安全 preload；SQLite migrations；产品资料和本地图片引用；文案从零生成、产品驱动、优化、轻/中/深去重；Lightweight Backend mock 和 TextProvider mock/首个适配器；本地任务历史。

### 验收

- Windows 10/11 clean VM 可安装、启动、更新测试版和卸载；卸载不擅自删除用户数据。
- renderer 为 sandbox、无 Node；IPC allowlist 契约测试通过。
- 产品增删改查和文案四类流程可完整完成；产品事实以锁定字段注入。
- 100 条事实保持测试中，产品名、规格、适用对象、禁忌、批准信息等锁定事实不得被去重改变；不确定内容显式提示人工审核。
- 数据库从空库建库、旧 fixture 升级、故障恢复均通过。
- Provider Key 不在客户端；mock 可离线跑通，真实文本请求有成本/延迟/失败记录。

### 不进入

图片/视频生成、素材索引、数字人、自动混剪。

## v0.2：AI 动物与产品素材 Provider

### 范围

Image/ImageEdit/Video Provider 协议；短期对象上传；动物/行业素材生成、产品场景化/编辑/首帧/必要图生视频；成本预计、任务取消/重试、fallback；Provider 法律 allowlist。

### 验收

- 三种能力各有 mock、主 Provider 和一个可配置 fallback；业务代码无厂商判断/SDK。
- 同一 request ID 重放只计费一次；超时后先查状态，不产生重复任务。
- 上传对象 TTL 自动删除；客户端/日志扫描无平台 Key、presigned URL 被脱敏。
- 选定的 30 个兽药素材提示用例成功率 ≥ 90%（排除明确内容政策拒绝），所有失败可归类。
- UI 在提交前显示最大成本区间；账本误差在厂商最小计费单位内。
- 产品参考图、生成图和参数/hash 可追溯；模型与输出商用条款有批准记录。

## v0.3：本地素材库与 CPU 索引风险闭环

### 范围

文件夹扫描；Asset/Shot；PySceneDetect；关键帧；质量；SigLIP 2 ONNX；可选 Florence-2 descriptor；SQLite 真源和 mmap 精确检索；断点续跑。

### 验收

- 真实授权的 ≥500 条、含至少 10 类场景的视频完成首次索引；报告最低支持机耗时、峰值内存、失败率和平均 Shot 数。
- 二次扫描未变化文件的解码/VLM/embedding 调用为 0；修改一个文件只重建它，移动同 hash 文件不重建。
- 断电/kill/坏文件后可续跑且无半 revision 可见。
- 每个结果精确返回 `asset_id/shot_id/start_ms/end_ms` 并可预览。
- 50k Shot 精确搜索 P95 < 200 ms；最低支持机索引期间 UI 可交互、任务可暂停。
- ONNX/量化与基准模型 Top-K 排序退化在批准阈值内；物种冲突样本进入 golden set。

未达标时优先调整关键帧、批量、量化和 VLM 默认开关；不得未经 ADR 直接加入 Qdrant/FAISS。

## v0.4：轻量路由、匹配与 Timeline 草稿

### 范围

ScriptSegment；固定 route；VisualIntent；AnimalMatcher、ProductMatcher、NO_MATCH；Clip Selector；可编辑 Timeline 和代理预览。输入先支持文案，音频仍可后置。

### 验收

- route enum 只有 ANIMAL/PRODUCT/NO_MATCH；架构测试证明无 Digital Human 依赖。
- 明确产品引用 100% 绑定当前 `product_id`，跨产品猜测为 0。
- golden route macro-F1 ≥ 0.90；已知物种冲突为 0；NO_MATCH 错配率 ≤ 5%。
- Animal Top-5 recall ≥ 0.85、Top-1 人工可用率 ≥ 0.70。
- 同 Shot 连续重复为 0；低置信结果显示空缺而不硬匹配。
- 用户可替换、锁定、移动镜头；重新匹配不会覆盖锁定片段。
- Timeline 保存/重开输出一致，源 revision 变化会阻止静默渲染。

## v0.5：ASR、字幕与基础 MP4 成片

### 范围

whisper.cpp 音频转写/时间轴；文本/音频统一切段；可选字幕；Timeline Builder；合规 FFmpeg 渲染；导出和错误恢复。

### 验收

- 中文兽药口播测试集的转写指标记录并达到团队批准门槛；产品名可用本地词表校正但保留原 ASR。
- Segment/字幕时间不越界；音视频总长误差 ≤ 1 帧，主音频同步误差 < 80 ms。
- 9:16 1080×1920 基准项目在 Windows clean VM 导出可播放 MP4；中断不会留下被标为成功的文件。
- FFmpeg 是自建 LGPL 动态配置，最终二进制无 GPL/nonfree/libx264/libx265，`h264_mf` 可用或给出受批准替代。
- 无字幕/有字幕、静态产品图、Shot 裁切、NO_MATCH 延续、缺失源文件都有 E2E。
- 相同 Timeline + 相同 source hash 的结构输出确定；不可避免的编码差异用帧/音频指标比较。

此版本即完成 V1 的“动物 + 产品”基础自动成片主闭环。

## v0.6：独立数字人口播

### 范围

平台/企业数字人母版；TTS、声音克隆、LipSync Provider；可选字幕；独立 DigitalHumanJob 生成 standalone VideoAsset；授权与删除流程。

### 验收

- `母版 + 文案 + 声音 -> TTS -> LipSync -> 独立视频` 可完成，失败可从各阶段恢复。
- 用户上传声音/母版前完成权利确认；能删除云端中转与本地记录。
- mock/主/fallback（若批准）契约通过，成本和延迟完整记录。
- 20 条中文口播的唇形、音质、清晰度由双人量表达到批准线；产品术语读法可配置。
- 禁用整个 Digital Human feature 后，Auto Edit 全套测试和安装仍通过。
- Auto Edit route、AnimalMatcher、ProductMatcher、VisualDescriptor schema 与 v0.5 相同；没有 AVATAR route。

## v0.7：真实兽药验证与商业硬化

### 范围

至少两家授权试点的匿名化数据；规则/词表/阈值校准；CPU/内存/磁盘优化；安全、隐私、安装/升级、崩溃恢复、许可证和支持工具。

### 验收

- golden set 扩为 ≥40 篇文案、≥300 个 Segment、≥500 个 Shot、≥30 个产品素材组，双人标注并解决分歧。
- v0.4/v0.5 所有准确率和性能指标在真实集保持，无未批准回退。
- 最低支持 Windows 设备完成连续 8 小时索引/渲染 soak，无数据库损坏、僵尸 sidecar 或不可恢复任务。
- 从前两个 stable 数据库升级和回滚演练成功；电源中断场景通过。
- 渗透/滥用清单关闭高危项；Provider Key、声音、对象存储、更新签名通过专项检查。
- SBOM、NOTICE、模型清单、FFmpeg 清单无未知/GPL/AGPL 未批准项。
- 客服可导出不含客户内容的诊断包，已完成安装/升级/备份/恢复手册。

## v1.0：第一版商业交付

### 发布条件

- v0.7 beta 试点完成并签字，无 P0/P1 缺陷；P2 有明确处置。
- Windows 安装包代码签名，stable 更新签名和回滚验证完成。
- V1 Scope 中所有流程有 E2E；明确“不做”项没有暗入口或半成品。
- 最终供应商合同/条款、隐私政策、EULA、第三方 NOTICE 和模型输出权经过负责人批准。
- 成本报表证明默认配额下单位经济可接受；服务端备份恢复和 Provider 故障演练完成。
- 支持矩阵、最低硬件、已知限制和首次索引耗时用实测数据发布。

## 版本停止与回滚

任何版本遇到以下情况不得晋级：平台 Key 可提取、产品错绑、已知物种硬冲突、数据库不可恢复、未批准许可证、重复计费、数字人耦合 Auto Edit。功能旗标必须能关闭 Provider 或 Digital Human；本地产品库、素材库和已有 Timeline 仍可使用。

v1.0 后的云同步、团队、多租户、AVATAR route、复杂导演、GPU 自部署均需新 Product Scope 和 ADR，不由本计划暗示授权。
