# V1 测试策略

## 质量目标

测试优先保护五件事：产品事实不被改变、产品不被错绑、动物不被明显错配、Timeline 可重复渲染、平台 Key/客户素材不泄露。准确率、成本和 CPU 性能必须基于固定数据，而不是演示观感。

## 测试层次

| 层 | 内容 | 频率 |
|---|---|---|
| 单元 | 规则、评分、hash、状态机、migration、时间换算 | 每次 PR |
| 契约 | IPC、sidecar NDJSON、Provider、Schema 前后兼容 | 每次 PR |
| 组件 | SQLite repositories、索引单文件、matcher、Timeline builder | 每次 PR |
| 集成 | FFmpeg/whisper/ONNX、真实文件、mock gateway | PR 关键路径 + nightly |
| Golden | route、召回、排序、事实保持、ASR、Timeline | nightly + release |
| Windows E2E | 安装、升级、索引、生成、编辑、导出、恢复 | nightly + release |
| 性能/soak | 50k 检索、500 文件索引、长渲染、断电/kill | nightly/里程碑 |
| 安全/合规 | secret、SSRF、授权、SBOM、许可证、签名 | PR 初筛 + release 全量 |

## Provider Mock 与契约

为七种 Provider 共用可编程 fake server，支持：成功、排队、慢响应、429、5xx、超时但实际成功、审核拒绝、错误参数、重复 webhook、乱序 webhook、未知 job、成本超估/少估、对象过期。

必须验证：

- 相同 `request_id` 并发/重放只产生一个上游 job 和 settlement。
- 超时后查询状态；`UNKNOWN` 不盲重试。
- 只有可重试错误触发有限退避；审核/参数/预算失败不绕过。
- primary 熔断时按配置 fallback，且不超过已批准成本。
- 回调验签、乱序/重复状态幂等；失败不会把 provider 原始秘密返回客户端。
- 每条记录含 provider/model/cost/latency/state/error，日志没有 Key、URL token 和客户内容。
- 业务包只使用接口；静态依赖测试禁止厂商 SDK/import。

每个真实 Provider 在 sandbox/最低付费额度上跑每日 canary；canary 不使用客户数据，成本设硬上限。

## 本地素材索引

### Fixture 矩阵

包含：硬切、淡入淡出、镜头抖动、长静态、变帧率、旋转元数据、无音频、多音轨、损坏尾部、零字节、中文/超长路径、移动/重命名、重复文件、4K、竖屏、黑暗/模糊，以及猪/鸡/牛羊/人员/产品/非目标场景。

### 不变量

- 二次扫描不变文件时 probe 以外的重处理计数为 0。
- `mtime` 变但 hash 相同不重建；hash 变只重建该 Asset。
- 每个 Shot 满足 `0 <= start < end <= asset duration`，同 revision 不交叠越界。
- sidecar kill/磁盘满/坏模型输出不会让半 revision 可见；续跑不重复已完成阶段。
- 同 index generation 只有一种 embedding model/preprocess/dimension。
- SQLite BLOB 删除缓存后能重建同 row mapping/近似相同分数。
- VLM 未知保留 null/unknown，不转换成 false；行业 metadata 不破坏通用 schema。

使用属性测试生成随机时长/时间边界；migration 使用每个已发布 schema 的真实匿名副本。

## AnimalMatcher

每个 Segment 标注可接受 Shot 集、不可接受原因和是否应 NO_MATCH。离线评估输出：

- Route macro-F1 ≥ 0.90。
- Animal Top-5 recall ≥ 0.85。
- Animal Top-1 人工可用率 ≥ 0.70。
- 已知物种冲突数 = 0。
- 标注 NO_MATCH 的 Segment 被硬匹配的比例 ≤ 5%。
- 连续相同 Shot = 0；相同 Asset 过度集中率作为观察指标。

每次改变 embedding、VLM prompt、词表、权重、阈值或 reuse 策略都必须跑全量，并输出与上版逐 Segment diff。总体均值变好但高风险物种冲突增加时拒绝发布。

## ProductMatcher

- 精确名、别名、SKU、“本产品/这款产品”等在唯一上下文中 100% 绑定当前 `product_id`。
- 多产品歧义返回 NO_MATCH/要求选择，不用向量猜。
- 候选集合中不能出现其他产品 ID；用 adversarial 数据验证相似包装、近似名称和旧包装。
- 没有产品素材时不回退到 AnimalMatcher；生成明确缺口。
- 产品事实保持集锁定名称、规格、适用对象、用法、禁忌、批准/合规字段；轻/中/深去重逐字段比较。

“100%”是发布硬门槛，任何错绑都按 P0 处理。

## Timeline 与 FFmpeg

### 模型测试

- Timeline schema round-trip 无信息丢失；未知字段按版本策略处理。
- clip 不越界、不重叠主轨、总长与音频一致；frame/ms 换算在指定 fps 下确定。
- 用户锁定 clip 不被重新匹配覆盖；源 revision/hash 变化 fail closed。
- NO_MATCH 延续受最大时长限制，空缺可见。

### 媒体测试

- 用 ffprobe 断言 codec/container/尺寸/帧率/时长/音轨；抽帧做 perceptual diff。
- 音视频总长误差 ≤ 1 帧；主音频同步误差 < 80 ms。
- 字幕起止不越界，中文换行和安全区在 9:16/16:9 均截图审查。
- 中途 kill、源文件消失、磁盘满、编码器不可用时任务失败可恢复，临时文件不冒充成品。
- Release 二进制检查 `-buildconf` 和 DLL 依赖，断言无 GPL/nonfree/libx264/libx265。

渲染 MP4 字节不要求完全相同；用 Timeline 结构、ffprobe、关键帧视觉和音频指纹判断稳定性。

## Golden Test Set

### v0.7 最小规模

- ≥40 篇真实授权/匿名兽药文案，覆盖带货、科普、痛点、产品介绍和去重。
- ≥300 个 ScriptSegment，覆盖 ANIMAL/PRODUCT/NO_MATCH 与歧义/否定。
- ≥500 个 Shot，含猪、鸡、牛羊、仔猪、猪舍、鸡舍、养殖场、采食、走动、异常表现、员工工作、产品混入和干扰素材。
- ≥30 个产品素材组，含相似包装、多个规格、旧包装、缺图和不同画幅。
- ≥20 条授权中文口播音频，覆盖口音、数字、计量单位、药品术语、噪音与停顿。

真实大媒体置于访问受控对象存储；Git 只保存 manifest、授权状态、匿名 ID、SHA-256 和标签。禁止把客户目录/名称写入 fixture。

### 标注方法

两名熟悉业务的标注者独立标 route、视觉意图、可接受 Shot/不可接受原因、产品绑定与 NO_MATCH；分歧由第三人裁决。记录标注指南版本和一致性（Cohen's kappa 作为观察），禁止算法作者单人改标签迎合新版本。

分 train/calibration/test；test 在发布评估前只读。每次增加线上失败样本，先匿名化/授权，再进入下一个数据集版本，不能回写当前 test 结果。

## CPU/资源矩阵

最低目标机建议基线：Windows 10/11、4 物理核、8 GB RAM、无独显、SSD；再测 8 核/16 GB 常见机和有 GPU 但未启用路径。

| 场景 | 指标/门槛 |
|---|---|
| 50k Shot 查询 | P95 < 200 ms，记录 mmap cold/warm |
| 500 文件首次索引 | 报告视频小时、墙钟、实时倍数、峰值 RAM、失败率；不得虚构固定承诺 |
| 二次扫描 | 未变化文件重分析 0 |
| 前台 + 索引 | UI 输入/导航仍可交互，暂停在有界时间内生效 |
| 30 分钟连续渲染 | 无内存无界增长、僵尸进程、数据库锁死 |
| 8 小时 soak | 无不可恢复任务/DB 损坏；资源回到稳定区间 |

性能结果连同模型、线程数、电源模式、温度、文件编码和 commit 存档。

## Digital Human 隔离测试

- 静态依赖图禁止 `domain-auto-edit -> domain-digital-human`。
- Auto Edit route schema snapshot 仅包含三值。
- 卸载/禁用 Digital Human adapter、删除模型配置、模拟 LipSync 全部失败后，Auto Edit 全 E2E 仍通过。
- Digital Human 表/任务迁移不修改 AnimalMatcher/ProductMatcher/VisualDescriptor。
- 数字人成品手工导入时仅作为普通 Asset；V1 自动路由不识别 AVATAR。

## 安全、升级与许可证

- secret scanner 覆盖 Git、安装包解包、asar、sidecar、模型 manifest、日志、崩溃包和内存诊断样本。
- API fuzz capability/model/URL/path/尺寸/价格；验证 SSRF、路径穿越、zip bomb/恶意媒体、重放和越权。
- 从每个 stable schema 升级到当前，模拟 migration 中断；自动备份可恢复并可用旧应用打开。
- 干净 VM 测安装、签名更新、降级阻止、回滚、卸载保留/清除选择。
- SBOM 对实际 artifact 生成；未知、GPL、AGPL、FFmpeg GPL config、未登记模型/字体一律 fail release。

## 缺陷与发布规则

P0：Key 泄漏、产品错绑、数据库/客户文件破坏、任意代码执行、重复大额计费。  
P1：已知物种错配、成片不可用、更新失败不可恢复、授权绕过、数字人耦合主链。  

v1.0 不允许 P0/P1；准确率门槛降低、性能豁免和许可证例外必须有 ADR、责任人和到期日，不能只在测试配置里改数字。
