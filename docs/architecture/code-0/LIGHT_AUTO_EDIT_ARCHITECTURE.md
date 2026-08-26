# V1 轻量自动混剪架构

## 不可变边界

V1 视觉路由只有：

```text
ANIMAL | PRODUCT | NO_MATCH
```

Digital Human 只生成独立口播视频资产，**不得**被 V1 Auto Edit 调用。`AnimalMatcher`、`ProductMatcher` 和现有素材索引中均不得出现 avatar、数字人母版、声音或 LipSync 逻辑。

目标不是自动导演，而是把口播稿的短视觉需求映射到企业已有的动物/养殖和指定产品素材，生成可人工调整的基础 Timeline。

## 端到端流程

```text
文案 ---------------------------> Script Segmentation
音频 -> whisper.cpp -> 字词时间轴 -> Script Segmentation
                                      |
                                  ScriptSegment
                                      |
                                   Route
                    +-----------------+----------------+
                 PRODUCT           ANIMAL          NO_MATCH
                    |                 |                 |
              ProductMatcher    AnimalMatcher      Gap Policy
                    +-----------------+----------------+
                                  Clip Selector
                                       |
                                Timeline Builder
                                       |
                       音频 + 可选字幕 + FFmpeg -> MP4
```

每一步输出版本化对象，可以保存、检查和人工覆盖；不存在不可解释的一次性“大模型成片”。

## 契约对象

### Asset / Shot / VisualDescriptor

由本地索引拥有。Shot 是唯一可匹配媒体单位，返回 `asset_id, shot_id, start_ms, end_ms, revision`。结构见 `LOCAL_MEDIA_INDEX_ARCHITECTURE.md`。

### ScriptSegment

```text
segment_id, script_id, source_start_char, source_end_char,
text, start_ms?, end_ms?, target_duration_ms,
previous_segment_id?, segmentation_version, user_locked
```

一个 Segment 表示短时间内较稳定的视觉需求。没有音频时，以目标语速估算时长；有音频时优先使用 ASR 字词时间戳。

### VisualIntent

```text
intent_id, segment_id, route,
selected_product_id?, product_reference?,
species[], scene[], action[], health_state?, people_present?,
query_text, hard_constraints, soft_preferences,
confidence, evidence[], intent_version
```

### MatchCandidate

```text
candidate_id, intent_id, shot_id, source_revision,
semantic_score, metadata_score, quality_score,
duration_score, aspect_score, reuse_penalty,
final_score, rejection_reasons[], evidence[]
```

### Timeline / TimelineClip

```text
Timeline {
  timeline_id, schema_version, source_script_id, source_audio_id?,
  canvas, fps, audio_duration_ms, clips[], subtitles?, build_version
}

TimelineClip {
  clip_id, segment_id, route, asset_id, shot_id?, product_asset_id?,
  source_start_ms, source_end_ms, timeline_start_ms, timeline_end_ms,
  fit_mode, crop, speed, transition, match_evidence,
  user_locked, missing_reason?
}
```

Timeline 必须可在不重新匹配的情况下重复渲染；引用源 revision 和 hash。人工修改后 `user_locked=true`，自动重建不得覆盖。

## 轻量 Script Segmentation

不是按标点机械切割，也不做复杂跨句推理。默认算法：

1. 标点、ASR 停顿和目标时长产生候选边界。
2. 合并过短片段，拆分超过上限的长片段。
3. 产品指代、并列动物动作、转折词和视觉主题变化调整边界。
4. 避免把修饰语与中心名词、否定词与谓词拆开。
5. 有时间轴时把边界吸附到自然停顿；无时间轴按字符/语速估算。

规则解析是默认路径。可选低价文本模型只能返回受 schema 约束的建议边界；超时、格式错或信心不足立即回退规则。模型不得改变原文。

## Route：确定性优先

路由严格按顺序：

### 1. PRODUCT

当前编辑会话必须显式选择 `selected_product_id`。以下证据可路由 PRODUCT：

- 精确产品名、登记别名、SKU。
- “本产品、这款产品、这包/这瓶”等明确指代，且上下文存在唯一当前产品。
- 用户手工标记。

一旦为 PRODUCT，直接绑定当前 `product_id`，只在该产品已登记的图片/视频资产中选镜头。禁止用向量在企业全部产品中猜产品身份。出现两个可能产品而无法确定时为 `NO_MATCH`，提示用户选择。

### 2. ANIMAL

不满足产品规则、且文本包含可支持的动物、养殖场景、动作、健康表现或人员作业视觉意图时路由 ANIMAL。Visual Intent 同时生成检索文本与结构化约束；否定和“不建议展示”的词进入排除条件。

### 3. NO_MATCH

无可靠视觉意图、超出素材领域、产品指代歧义或候选低于校准阈值时为 NO_MATCH。不得为提高覆盖率硬塞错误物种/产品。

规则、词表和阈值都带版本；黄金集校准，不把某个模型的自由文本当真值。

## AnimalMatcher

```text
VisualIntent
 -> SigLIP 2 Top-K exact recall
 -> metadata hard filter
 -> light rerank
 -> calibrated accept / NO_MATCH
```

硬拒绝包括：已知物种冲突、明确场景冲突、`product_present=true` 且不允许、源文件不可用、Shot 时长不足且不可合理循环/减速、画幅完全不适配。未知 metadata 不作为冲突，只降低置信。

初始 rerank 公式（需黄金集校准）：

```text
final = 0.50 * semantic
      + 0.15 * metadata
      + 0.12 * quality
      + 0.08 * duration_fit
      + 0.05 * aspect_fit
      - 0.07 * recent_reuse
      - 0.03 * same_asset_adjacency
```

权重不是产品契约；版本化并由离线评测批准。接受需要 Top-1 达阈值且与冲突候选有足够 margin，否则 NO_MATCH。阈值按 golden set 选择，不能凭主观固定。

## ProductMatcher

输入必须有 `product_id`。候选只来自该产品资产，按以下排序：

- 用户为“主图/包装/手持/场景/实验室”等槽位打的标签与 Segment 意图。
- 画幅、清晰度、可用时长、主体完整度。
- 当前 Timeline 最近使用次数。

产品图片可由 Timeline Builder 生成轻微 Ken Burns 运动，但不能伪造产品功效、包装文字或规格。若当前产品没有可用素材，返回 NO_MATCH/人工补素材，而不是转去 AnimalMatcher 猜。

## Clip Selector 与 NO_MATCH 策略

Selector 在全局短窗口内处理：

- 同一 Shot 不连续使用；最近使用多次逐级降权。
- 优先选择源长度覆盖 Segment 的连续区间；裁切点避开 Shot 边界抖动。
- 不用超过产品允许范围的拉伸；速度变化保持在配置的保守区间。
- 同一 Asset 连续最多两个片段，除非用户锁定或只有一个合格源。
- 裁切/缩放保留主体，V1 不做生成式补帧。

NO_MATCH 的顺序：延续相邻合格镜头且不超过最大延续时长；使用用户指定通用安全镜头；否则生成显式空缺 `TimelineClip.missing_reason` 并提示补素材。不得把空缺静默渲染为错误画面。

## Timeline 与渲染

Timeline Builder 先生成无损于语义的可编辑草稿：主口播音频为时钟，视频片段与 Segment 对齐，可选字幕从 ASR/文本生成。FFmpeg 负责裁切、缩放、帧率统一、音频混合、字幕和 MP4 封装；渲染参数固定并写入任务记录。

预览可用代理文件，最终导出从源文件读取。若源 hash/revision 不一致，停止并提示重新链接，不能悄悄用不同内容。

## Digital Human 的彻底解耦

```text
packages/domain-digital-human
  DigitalHumanJob -> standalone VideoAsset

packages/domain-auto-edit
  imports: media-index contracts, product contracts, timeline
  forbidden imports: digital-human, voice-clone, lip-sync
```

强制机制：

- 两个 bounded context 使用不同表、任务、服务和 UI 路由。
- Auto Edit 的 route enum、VisualIntent 和 index metadata 不含 avatar 字段。
- 架构依赖测试检查 Auto Edit 不 import Digital Human 包。
- Digital Human 失败不影响 Auto Edit 健康检查和发布。
- 未来若确需接入，新增 `AVATAR` route 和独立 `AvatarMatcher/Adapter`；不能修改 AnimalMatcher/ProductMatcher 的职责或把 avatar embedding 混入现有 Shot 索引。

数字人口播成品可以像任何普通用户视频一样被手工导入素材库，但 V1 自动路由仍不会识别或优先调用它。

## 算法验收

- 明确产品引用绑定正确 `product_id` 的准确率 100%；不存在跨产品向量猜测。
- 已知物种冲突匹配数为 0。
- 黄金集 route macro-F1 ≥ 0.90；标注为无合适素材的 Segment 错配率 ≤ 5%。
- Animal Top-5 recall ≥ 0.85；人工 Top-1 可用率 ≥ 0.70，具体集定义见测试策略。
- 连续重复 Shot 为 0；所有 NO_MATCH 在 UI 可见且可人工替换。
- Timeline 重载后逐帧/逐毫秒稳定，源引用可追溯。
- 静态依赖测试证明 Auto Edit 对 Digital Human 零依赖。

## V1 明确不做

复杂 AI 导演、全片主题规划、跨句长程视觉推理、生成式转场、多轨剧情、音乐踩点 Agent、AVATAR route、全自动百条批量生产均不在范围内。
