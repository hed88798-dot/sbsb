# Lightweight Backend 与安全架构

## 最小答案

一台 2 vCPU / 4 GB Linux VPS 上运行 **Caddy + 单实例 TypeScript/Fastify API + SQLite WAL**，外加兼容 S3 的对象存储用于短期中转大文件。它只负责授权、平台 Key 保护、Provider 代理、用量/成本、限流、版本与签名更新信息；不保存企业产品库和本地素材索引，不演化为多租户 SaaS。

预算基线：国内/港新同规格轻量服务器约 **¥80–200/月**，另加对象存储、流量、短信/邮件（若用）和 AI 调用实耗。腾讯云曾公布 2C4G 轻量应用服务器 ¥80/月的目录价，实际地区和活动价需采购时复核。[腾讯云价格调整公告](https://cloud.tencent.com/document/product/1207/119345)

## 为什么仍需要后端

打包在桌面应用、环境变量、混淆代码或本地配置中的平台 Key 都可被客户提取。Key 必须只存在服务端 Secret Store/受限环境；桌面拿到的是本软件自己的短期 access token，而不是厂商凭证。fal 也明确要求 GUI/client 使用服务端代理，不暴露 `FAL_KEY`。[fal 客户端安全说明](https://fal.ai/models/fal-ai/flashtalk/api)

## 最小组件

```text
Internet
   |
Caddy: TLS, request size/rate edge limits
   |
Fastify API: auth, schema allowlist, provider adapters, job state
   |
SQLite WAL: licenses/devices/jobs/usage/cost/idempotency/audit
   |
Object Store: presigned upload/output, TTL lifecycle deletion
   |
Provider APIs
```

单实例足以服务 V1 首批客户。进程由 systemd 托管，每日加密备份数据库，异地保留。无需 Redis、Kafka、Kubernetes、服务网格、微服务或自建 GPU。需要横向扩容或 HA 时再用数据和 ADR 驱动迁移。

## 客户端授权

### 首次激活

1. 客户端生成设备密钥对；私钥由 Windows DPAPI 保护，不上传。
2. 用户输入许可证/激活码；后端校验状态和设备上限。
3. 后端登记公钥与最小设备摘要，签发短期 access token 和可撤销 refresh credential。
4. 后续敏感请求带 token、时间戳、nonce、body hash，并用设备私钥签名。

设备摘要不能用不可变硬件指纹把客户永久锁死；提供受审计的解绑/换机流程。服务端存 refresh token 的 hash，不存明文。access token 建议 10–15 分钟；离线本地功能可有有限宽限期，但平台付费 API 必须在线授权。

### 防重放与撤销

- nonce 在短窗口唯一，服务器时间偏差有限；过期请求拒绝。
- license、device、token 都可独立撤销。
- 异常地区/频率/多设备并发只触发风险控制和人工核查，不自动销毁本地数据。
- 客户端退出登录清除 refresh credential；卸载是否清除由用户选择。

## Proxy 不是开放转发器

建议最小 endpoint：

```text
POST /v1/activate
POST /v1/token/refresh
POST /v1/jobs                 # 仅标准 ProviderRequest
GET  /v1/jobs/:id
POST /v1/uploads/presign
GET  /v1/config/providers     # 只返回模型别名/能力，不返回 Key
GET  /v1/app/releases/:channel
POST /v1/telemetry/usage      # 最小、可关闭的产品遥测另行处理
```

服务端 allowlist 检查 capability、model alias、尺寸、时长、文件类型、最大成本和内容策略。客户端不能指定厂商 base URL、任意 webhook、任意对象存储 key 或原始厂商请求。对 URL 输入防 SSRF：默认只接受本系统签发的对象引用，不替用户抓任意 URL。

Provider webhook 使用每家厂商的签名验证和固定回调路径；状态转换幂等。未知状态先查询厂商，避免超时重试重复扣款。

## 大文件与数据最小化

- API 签发短时 presigned upload；客户端直传对象存储，应用服务器不转发视频字节。
- object key 随机且与客户文件名无关；上传限制 MIME、扩展、大小和 checksum。
- 输入/输出默认 24 小时 lifecycle 删除；任务可更短，法规/合同要求优先。
- 只有用户明确选择云生成的资产上传；本地索引、产品库、原始素材目录默认不上云。
- Provider 不需要的 EXIF、音轨和高分辨率在本地先移除。
- 数据库保存对象引用、hash、字节数、到期时间，不保存提示词全文或可克隆声音样本。

隐私政策必须列出具体 Provider、地区、保留期和用途。声音克隆、数字人母版必须增加权利确认与删除入口。

## Key 与秘密管理

- Provider Key 只注入服务端进程；生产、测试、开发分开，按 capability 使用尽可能小的权限/额度。
- Key 不写 Git、镜像层、崩溃报告、请求日志、SQLite 或客户端更新包。
- 日志过滤 Authorization、Cookie、签名、presigned query、厂商 header 和提示词。
- 每 90 天或供应商能力允许时轮换；疑似泄漏立即撤销、切 fallback、查审计。
- 管理操作需 MFA/受限网络；V1 可用云商 Secret Manager，不能用团队共享文档。

## 用量、成本与限流

账本使用 append-only 事件：

```text
usage_event_id, license_id, device_id, request_id, job_id,
provider, model, capability, estimated_cost, final_cost, currency,
billed_units, latency_ms, state, error_class, occurred_at
```

提交前执行单请求硬上限、日/月许可证预算和并发数；先 reservation，完成后 settlement。预算检查与 job 创建在同一事务，避免并发穿透。未知计费挂起，不立即重复请求。

限流至少按 IP、license、device、capability 四层；登录/激活比推理更严格。错误分为用户输入、内容策略、配额、可重试供应商、永久供应商和内部错误，不能把上游敏感响应原样回客户端。

## 更新安全

- 更新 manifest 与安装包均签名；Windows 正式版使用代码签名证书。
- 客户端只信固定 HTTPS 域名与公钥/签名链，拒绝降级到 HTTP。
- release channel 分 stable/beta；更新声明最低兼容数据库/sidecar/模型协议版本。
- 自动更新前备份 SQLite；migration 失败恢复旧应用与旧 DB。
- 后端只发布版本/签名/下载元数据，不提供任意脚本执行。

Electron 自身要求安全上下文隔离、限制导航/新窗口并及时升级受支持版本。[Electron 安全清单](https://www.electronjs.org/docs/latest/tutorial/security)

## 运行与灾备

- Caddy 自动 TLS；主机只开放 80/443 和受限管理通道。
- 服务以非 root 用户运行，最小文件权限，自动安全更新与主机防火墙。
- SQLite 位于本地块存储；WAL 不放网络文件系统。每日在线 Backup API 快照并加密上传，定期恢复演练。
- 监控可用性、P95、5xx、provider 成功率、预算偏差和磁盘；不采集客户内容。
- RPO 初始 24h、RTO 4h；正式商业 SLA 前再评估。

## 威胁与控制

| 威胁 | 主要控制 |
|---|---|
| 反编译客户端找平台 Key | Key 永不下发；短 token + 服务端代理 |
| 激活码共享 | 设备公钥、设备上限、撤销与速率异常检测 |
| 重放付费请求 | nonce、时间戳、body hash、幂等 request ID |
| 越权调用昂贵模型 | capability/model/参数 allowlist + 预算 reservation |
| SSRF/任意代理 | 只接受内部对象引用和固定 provider endpoints |
| 大文件耗尽资源 | 直传对象存储、大小/checksum/TTL、并发限制 |
| Webhook 伪造 | 厂商验签、幂等状态机 |
| 日志泄密 | 结构化脱敏、内容默认不记、访问和保留限制 |
| 更新供应链劫持 | 代码签名、manifest 签名、HTTPS、可回滚 |

## V1 验收

- 对安装包、进程内存转储、配置和日志扫描，找不到任何 Provider Key。
- 任意客户端参数不能改变 provider URL 或调用 allowlist 外模型。
- 同一 request ID 并发 20 次只创建一项厂商任务/一笔账。
- 超预算、撤销设备、过期 token、重放 nonce 均 fail closed。
- 对象到 TTL 后自动删除，数据库可证明删除状态。
- 全新主机可从基础设施说明与备份在 4 小时内恢复。
