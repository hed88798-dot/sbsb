# AI Provider 策略

## 决策

V1 不维护 GPU 集群，不让桌面业务代码直接调用厂商，也不把平台 Key 下发到客户端。所有托管模型经 Lightweight Backend 的厂商适配器调用；本地/未来自部署实现同一协议。路由是“按能力配置的低成本默认 + 已批准的高质量 fallback”，不是动态 Agent。

价格、免费额度和模型上下线随时变化。本文件的供应商信息是 2026-08-26 快照；实际价格由后端配置与官方价格接口/页面刷新，不能编译进客户端。

## Provider Protocol

### 通用对象

```text
ProviderRequest {
  request_id, tenant_license_id, capability, model_alias,
  input_refs[], parameters, output_spec, policy_context
}

ProviderJob {
  job_id, provider, provider_job_id, state,
  estimated_cost, final_cost, currency,
  created_at, started_at, finished_at, error_class
}

ProviderResult {
  job_id, artifacts[{url_ref, mime, sha256, expires_at}],
  provider, provider_model, latency_ms, billed_units,
  request_snapshot_hash, moderation
}
```

所有创建操作带 `request_id` 作为幂等键。统一状态为 `QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED/UNKNOWN`；`UNKNOWN` 必须先向厂商查询，禁止盲目重试导致重复计费。

### 七个业务接口

```text
TextProvider.generate(TextRequest) -> TextResult
ImageProvider.generate(ImageRequest) -> ProviderJob
ImageEditProvider.edit(ImageEditRequest) -> ProviderJob
VideoProvider.generate(VideoRequest) -> ProviderJob
TTSProvider.synthesize(TTSRequest) -> ProviderJob
VoiceCloneProvider.createVoice(VoiceCloneRequest) -> ProviderJob
LipSyncProvider.generate(LipSyncRequest) -> ProviderJob
```

业务层只认识能力、`model_alias` 和质量档位，不认识 `SiliconFlow`、`fal` 等厂商名。适配器承担字段转换、轮询/webhook、错误归一、计费单位和内容策略。输入参数使用明确 allowlist；不允许客户端传原始 provider URL、任意模型 ID 或任意 JSON。

## V1 供应商组合

| 能力 | 默认候选 | Fallback | 决策说明 |
|---|---|---|---|
| 文案/改写/去重 | SiliconFlow 上经批准的低价中文文本模型 | 经评测的强中文模型 | 事实先结构化注入；深度去重也不得改产品事实。 |
| 生图 | AutoDL.Art 或 LiblibAI 上的批准 workflow/model | fal.ai | 国内访问、低成本优先；一致性任务单独档位。 |
| 图片编辑 | LiblibAI/AutoDL.Art 上批准的 Qwen-Image-Edit 类模型 | fal.ai/Replicate | 必须支持参考图和输入 hash；无输出权结论不启用。 |
| 图生视频/动物素材 | AutoDL.Art、RunningHub 或官方国内 API | fal.ai；Replicate 仅实验 | 按成功视频秒估价，提交前展示预计区间。 |
| TTS | SiliconFlow 或 MiniMax 官方语音 API | 另一家已批准语音服务 | 中文自然度、数字/单位读法和稳定性优先。 |
| 声音克隆 | MiniMax 官方语音能力 | 暂不 fallback 或经批准供应商 | 强制声音权利声明、同意记录与水印/标识策略。 |
| LipSync | 托管 LatentSync 类服务 | fal.ai 上已批准模型 | 数字人模块专用，不成为 Auto Edit 依赖。 |

这是一组候选适配器，不代表在没有签约/法务审查时同时启用。Code B 用真实价格、可用地区、发票、SLA、数据保留和输出条款做最终供应商上线清单。

官方信息：[SiliconFlow 价格](https://www2.siliconflow.cn/pricing) 与[服务条款](https://docs.siliconflow.com/en/legals/terms-of-service)、[LiblibAI API](https://www.liblib.art/apis) 与[API 服务协议](https://www.liblib.art/activities/API-Service-Agreement)、[AutoDL.Art 大模型计费](https://autodl.art/docs/large_model/) 与[工作流 API](https://autodl.art/docs/comfyui_api/)、[RunningHub 企业 API](https://www.runninghub.ai/enterprise-api)、[MiniMax 语音计费](https://platform.minimaxi.com/docs/guides/pricing-speech)、[fal 计费规则](https://fal.ai/docs/documentation/model-apis/pricing)、[Replicate 计费](https://replicate.com/pricing)。

## 静态成本路由

路由配置示例：

```yaml
text.standard:     {primary: text_low_cn, fallback: text_strong_cn}
text.complex:      {primary: text_strong_cn}
image.standard:    {primary: image_low_cn, fallback: image_global}
image.consistent:  {primary: image_edit_strong, fallback: image_global_hq}
video.standard:    {primary: video_low_cn, fallback: video_global}
```

选择只依据：能力、质量档、地区可用性、法律 allowlist、预算余额和熔断状态。V1 不根据提示词让模型自主选择供应商。

每次请求按以下顺序：

1. 标准化参数并计算幂等 hash。
2. 检查许可、内容、租户预算和单次硬上限。
3. 根据当前价格表估算成本，保留预算。
4. 调用 primary；只对明确可重试错误退避重试。
5. primary 熔断/不可用/明确失败时，且用户预算允许，调用 fallback。
6. 结算实际成本并释放差额；保存厂商账单单位。

必须记录：`provider`、`provider_model`、能力、输入/输出计费单位、估算/实际成本、币种、延迟、成功/失败、错误类型、重试次数、fallback 原因。默认不记录完整提示词、原图或声音；诊断日志使用 hash 和脱敏字段。

## 压低成本的具体做法

- 文案的产品事实从本地结构化字段拼装，低价模型只做表达；只有复杂任务升级强模型。
- 编辑前先本地裁切、压缩、去 EXIF；按模型最低有效分辨率上传。
- 视频先生成短镜头，再由本地 Timeline 复用和拼接；不给单条文案盲目生成长视频。
- 相同输入、参数、模型 revision 命中本地/后端结果缓存；声音克隆 ID 和资产可复用。
- 失败重试不换随机种子；先查询异步任务状态。计费失败不自动跨厂商风暴式重试。
- 免费额度只用于验收和灾备演练，不作为商业毛利模型。默认配额必须能在免费额度消失后仍成立。
- 每周对“成功成片成本、失败浪费、人工采用率、P95 延迟”做能力级报表；不是只看标价。

fal 官方明确要求客户端应用不要暴露 `FAL_KEY`，应通过服务端代理；本架构对全部平台 Key 执行同一原则。[fal 客户端密钥说明](https://fal.ai/models/fal-ai/flashtalk/api)

## Fallback 和故障语义

- 超时不等于失败：先查询 provider job。
- 内容审核拒绝不自动 fallback，返回可解释错误，避免绕过政策。
- 参数错误、余额不足、法律 allowlist 失败不可重试。
- 429/5xx 使用有上限的指数退避；连续失败触发能力级熔断。
- fallback 若质量/价格更高，提交前的用户授权必须覆盖最大预算；超过则停止。
- 厂商回调必须验签；回调和轮询都通过状态机幂等合并。

## Provider 法律清单

每个 `provider + model + capability` 上线前至少记录：

```text
api_terms_version
model_code_license
model_weight_license
commercial_use
output_ownership
training_or_retention_policy
region/data_transfer
prohibited_content
attribution_requirement
approved_by / approved_at / expires_at
```

Replicate 明确提示不同模型许可证不同，因此不能把平台级付费等同于商用授权。[Replicate 模型许可说明](https://replicate.com/docs/reference/how-does-replicate-work)

## 未来自部署

未来 `SelfHostedH3Provider` 或企业私有 endpoint 实现同一接口，由后端配置切换；业务对象、Timeline 和任务历史不变。迁移判断基于实际月调用量、成功率、P95、运维人力、许可证和单次完全成本，而不是 GPU 单价。V1 不包含 GPU 调度、Kubernetes、队列集群或通用推理平台。

## 验收标准

- 客户端安装包、配置和日志扫描不到平台 Key。
- 对七种能力均有契约测试和 mock；业务包不存在厂商 SDK import。
- 同一 `request_id` 重放不会产生第二张账单。
- 每一笔成功/失败都能追溯路由、模型、成本、延迟和结果 hash。
- provider 下线可通过后端配置禁用，不发布新桌面版本。
