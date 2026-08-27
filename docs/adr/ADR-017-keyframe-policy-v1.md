# ADR-017：Shot 关键帧策略 v1

状态：Proposed for Code C review  
决定版本：`safe-mid-best-v1`

## Architecture Question

Code 0 同时出现 `25% / 50% / 75%` 和“开头安全帧 / 中点 / 质量最佳帧”两种口径。
两者不能在没有版本记录的情况下互换。

## 决定

v0.3 实现并版本化 `safe-mid-best-v1`：长 Shot 选择距开头 120–500 ms 的安全帧、
中点、轻量质量分最高帧；短于 600 ms 的 Shot 只取中点。每帧先归一化 embedding，
均值聚合后再次 L2 归一化。

保留 `25/50/75` benchmark 实现作为候选对照，不将 detector threshold 或帧位点写成永久
产品契约。原因是 safe/mid/best 能直接规避淡入黑帧并利用质量指标降低模糊、黑暗和过曝
对 Shot embedding 的影响；代价是需要额外抽取少量候选帧计算质量。

## 当前证据和审核门禁

合成 fixture 已覆盖淡入黑帧、模糊中段、快速运动与短 Shot，选择逻辑和 CPU 上界有自动测试。
本地工作区没有任务书要求的授权 ≥500 条兽药素材，因此真实检索 Top-K、额外解码成本和两策略
逐 Shot 对照不能被本提交虚报为通过。Code C review 应在受控 Golden Set 上运行 benchmark；若
`25/50/75` 在批准指标上更优，用新 policy version supersede 本 ADR，不静默改变 v1 语义。
