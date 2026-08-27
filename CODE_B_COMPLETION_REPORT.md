# Code B Completion Report

报告日期：2026-08-27

任务：Provider + Lightweight Backend v0.2 Foundation

> 说明：Git commit 无法在其自身内容中保存自己的最终 SHA。实现 commit 已准确记录；包含本报告的
> handoff commit SHA 以最终回复中的 `git rev-parse HEAD` 为准。

1. Branch：`code-b/provider-gateway-v0.2`
2. Final commit SHA：见最终 handoff；实现 commit 为 `4be1c4fe19af83d047e64258c6c7246ff4219c3a`
3. Main baseline SHA：`b04b8c152cd3e589b17246f53bab16262aefe313`
4. Gateway Node/Fastify exact versions：Node `24.19.0`；Fastify `5.6.2`
5. Gateway SQLite version：SQLite `3.53.4`（`better-sqlite3 13.0.3`）
6. Gateway migration version：`1`（`001_provider_gateway_v1.sql`）
7. Provider Protocol version：`1.0`
8. Auth/token foundation：PASS
9. Device signature / replay protection：PASS
10. Idempotency 20 concurrent duplicate requests：PASS
11. Budget reservation + job atomic transaction：PASS
12. Usage/cost ledger：PASS
13. Webhook signature + duplicate/out-of-order：PASS
14. Object storage presign：PASS（SigV4/checksum/随机 key/策略/TTL；真实 bucket canary 未运行）
15. SSRF / arbitrary URL protection：PASS
16. Text real provider smoke：BLOCKED_BY_CREDENTIALS_AND_PROVIDER_LEGAL_REVIEW
17. Image provider：BLOCKED_BY_PROVIDER_LEGAL_REVIEW（Protocol/Mock/primary+fallback candidate PASS）
18. ImageEdit provider：BLOCKED_BY_PROVIDER_LEGAL_REVIEW（Protocol/Mock/primary+fallback candidate PASS）
19. Video provider：BLOCKED_BY_PROVIDER_LEGAL_REVIEW（Protocol/Mock/primary+fallback candidate PASS）
20. Provider legal allowlist：PASS（fail-closed 机制与审计已完成；生产条目尚未批准）
21. Provider Key secret scan：PASS
22. Contract tests：PASS
23. Security tests：PASS
24. Linux CI：NOT_RUN（需要 push/PR；本地完整 quality gate PASS）
25. Existing Windows native smoke regression：NOT_RUN_ON_WINDOWS（本地 native packaging smoke PASS；需 Code F/PR 验证）
26. License scan：PASS（first-pass）
27. Known issues：见下节
28. Architecture Question / Contract Change Proposal：NONE
29. Does Code B satisfy Provider/Gateway v0.2 foundation：BLOCKED_BY_CREDENTIALS_AND_PROVIDER_LEGAL_REVIEW

## 已完成范围

- 七能力 Zod/JSON Schema、Mock、统一错误与 Provider Job 六状态；没有改动 Code A 冻结的 Desktop Job 语义。
- Fastify production runtime 与原 Code A 离线 Mock 并存；正式 CLI 不启动 Mock。
- 设备 Ed25519、公钥登记、短 access token、refresh hash/轮换、license/device/token/refresh 独立撤销。
- timestamp/nonce/body hash/device signature/request ID 防重放，异常在 Provider submit 前 fail closed。
- SQLite WAL versioned migration；预算检查、reservation、Job 同事务；append-only usage events。
- 许可证内 request ID 唯一；20 并发重放只有一个上游 submit、一个 reservation、一个 settlement。
- UNKNOWN 查询恢复；审核拒绝/非法参数/法律失败/预算失败不 fallback；高价 fallback 预留上界。
- 固定 endpoint server adapters、OpenAI-compatible Text adapter、primary/fallback 静态路由、地区与最小熔断。
- 统一 Provider fake server；覆盖 queue/slow/429/5xx/timeout-but-succeeded/moderation/invalid/
  unknown/cost deviation/webhook/object/signature 场景。
- S3 SigV4 直传、MIME/扩展/大小/checksum/随机 key/presign TTL 与 24h lifecycle metadata。
- Caddy、systemd、环境模板、候选配置、health/readiness、Online Backup、恢复与轮换说明。
- 真实 Text 纵向 canary 已实现为显式预算/法务门禁测试；普通 PR 不产生付费调用。

## 验证证据

- 全 workspace build：PASS
- format / lint / typecheck：PASS
- tests：196 PASS，1 SKIP（真实付费 Text canary，原因见阻塞项）
- dependency direction：PASS
- portability：PASS
- secret scan：PASS
- license scan：PASS（first-pass）
- package resolution：PASS
- migration online backup + integrity check：PASS

## Known issues / 外部阻塞

1. 未提供正式 Provider Key，也没有当期价格、商用条款、输出所有权、保留策略、地区与批准人记录；
   因此真实 Text/Image/ImageEdit/Video 均不能诚实标 PASS。
2. 示例 adapter、endpoint、model 与零价格仅是候选配置形状，不是生产事实；法律 allowlist 默认 fail closed。
3. S3 SigV4 已做确定性测试，但尚未对实际对象存储 bucket 做 upload/head/lifecycle deletion canary。
4. Linux GitHub CI 与 Windows native workflow 需要 branch push/PR 后由 Code F 验证；本轮未伪造云端 PASS。
5. V1 单实例 rate/circuit 状态在进程内，重启后清零；账本、预算、幂等、auth 与撤销状态均在 SQLite 持久化。
