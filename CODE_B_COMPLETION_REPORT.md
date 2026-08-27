# Code B Completion Report

报告日期：2026-08-27

任务：Provider + Lightweight Backend v0.2 Foundation

```makefile
CODE_B_IMPLEMENTATION: PASS
CODE_B_MERGE_READINESS: PENDING_F_RE_REVIEW
LEGAL_ALLOWLIST_MECHANISM: PASS
PRODUCTION_PROVIDER_APPROVAL: BLOCKED
OBJECT_STORAGE_PRESIGN_IMPLEMENTATION: PASS
REAL_BUCKET_CANARY: BLOCKED
REAL_TEXT_PROVIDER_SMOKE: BLOCKED_BY_CREDENTIALS_AND_PROVIDER_LEGAL_REVIEW
CODE_B_FOUNDATION_ACCEPTANCE: BLOCKED
V0_2_ACCEPTANCE: BLOCKED
```

```makefile
FASTIFY_OLD_VERSION: 5.6.2
FASTIFY_NEW_VERSION: 5.8.5
FASTIFY_P1_REMEDIATION: PASS
VULNERABILITY_GATE: PASS
SBOM_UPDATED: PASS
LICENSE_GATE: PASS
CLEAN_CHECKOUT: PASS
GATEWAY_REGRESSION_TESTS: PASS
LINUX_CI: PENDING_NEW_HEAD
WINDOWS_NATIVE_REGRESSION: PENDING_NEW_HEAD
```

> `VULNERABILITY_GATE: PASS` 指 Code B production dependency 的 High/Critical 门禁：Fastify Issue #5
> 的两个 High advisory 已消失，production audit 为 High `0` / Critical `0`。现有 AJV 链仍报告一个
> Moderate；全 workspace 开发工具审计另由 Issue #6 / Code F 管理，本轮没有扩大依赖升级范围。

> 说明：Git commit 无法在其自身内容中保存自己的最终 SHA。实现 commit 已准确记录；包含本报告的
> handoff commit SHA 以最终回复中的 `git rev-parse HEAD` 为准。

1. Branch：`code-b/provider-gateway-v0.2`
2. Final commit SHA：见最终 handoff；Fastify P1 修复 commit 为 `5d692e2d8d5220e882b50ecc566550d9d339cfee`
3. Main baseline SHA：`b7ddefbdda046118efaba9f3ef84b48ae8e2fb09`
4. Gateway Node/Fastify exact versions：Node `24.19.0`；Fastify `5.8.5`（原 `5.6.2`）
5. Gateway SQLite version：SQLite `3.53.4`（`better-sqlite3 13.0.3`）
6. Gateway migration version：`1`（`001_provider_gateway_v1.sql`）
7. Provider Protocol version：`1.0`
8. Auth/token foundation：PASS
9. Device signature / replay protection：PASS
10. Idempotency 20 concurrent duplicate requests：PASS
11. Budget reservation + job atomic transaction：PASS
12. Usage/cost ledger：PASS
13. Webhook signature + duplicate/out-of-order：PASS
14. Object storage presign mechanism：PASS（SigV4/checksum/随机 key/策略/TTL metadata）
15. SSRF / arbitrary URL protection：PASS
16. Text real provider smoke：BLOCKED_BY_CREDENTIALS_AND_PROVIDER_LEGAL_REVIEW
17. Image provider：BLOCKED_BY_PROVIDER_LEGAL_REVIEW（Protocol/Mock/primary+fallback candidate PASS）
18. ImageEdit provider：BLOCKED_BY_PROVIDER_LEGAL_REVIEW（Protocol/Mock/primary+fallback candidate PASS）
19. Video provider：BLOCKED_BY_PROVIDER_LEGAL_REVIEW（Protocol/Mock/primary+fallback candidate PASS）
20. Legal allowlist mechanism：PASS；Production Provider approval：BLOCKED
21. Provider Key secret scan：PASS
22. Contract tests：PASS
23. Security tests：PASS
24. Linux CI：PENDING_NEW_HEAD（本地完整 quality gate PASS）
25. Existing Windows native smoke regression：PENDING_NEW_HEAD（本地 native packaging smoke PASS）
26. License scan：PASS（first-pass；clean checkout 660 packages / 0 manual-review licenses）
27. Known issues：见下节
28. Architecture Question / Contract Change Proposal：NONE
29. Code B implementation：PASS；Merge readiness：PENDING_F_RE_REVIEW；Foundation acceptance：BLOCKED

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
- tests：203 PASS，1 SKIP（真实付费 Text canary，原因见阻塞项）
- dependency direction：PASS
- portability：PASS
- secret scan：PASS
- license scan：PASS（first-pass；660 packages / 0 manual-review licenses）
- production vulnerability gate：PASS（High 0 / Critical 0；Issue #5 Fastify advisories 不再命中）
- SBOM scaffold：PASS（660 components；只包含 Fastify `5.8.5`）
- clean detached checkout：PASS（`5d692e2`；独立 store、frozen lockfile、含空格路径、从零 build/test）
- package resolution：PASS
- migration online backup + integrity check：PASS

## Fastify P1 remediation

- Old Fastify：`5.6.2`
- New Fastify：`5.8.5`（精确版本，同 Fastify 5.x major）
- Reason：Issue #5 / P1 production vulnerability remediation
- Manifest / lockfile：PASS；仅 Fastify 版本与 integrity 发生变化
- Transitive dependency graph：无新增 package，现有 Fastify 直接传递依赖版本未变化
- API / plugin / type / hook / schema / error / body-limit / listen regression：PASS
- Production audit：High `0` / Critical `0`；保留一个 AJV Moderate 供后续依赖治理
- Issue #4 Object Storage startup coupling：未修改
- Issue #6 shared development tooling：未修改（Code F ownership）

## Known issues / 外部阻塞

1. 未提供正式 Provider Key，也没有当期价格、商用条款、输出所有权、保留策略、地区与批准人记录；
   因此真实 Text/Image/ImageEdit/Video 均不能诚实标 PASS。
2. 示例 adapter、endpoint、model 与零价格仅是候选配置形状，不是生产事实；法律 allowlist 默认 fail closed。
3. S3 SigV4 已做确定性测试，但尚未对实际对象存储 bucket 做 upload/head/lifecycle deletion canary。
4. Linux GitHub CI 与 Windows native workflow 需要在 Fastify 修复后的新 PR HEAD 重跑；本地报告保持 PENDING，未复用旧 HEAD 绿灯。
5. V1 单实例 rate/circuit 状态在进程内，重启后清零；账本、预算、幂等、auth 与撤销状态均在 SQLite 持久化。

## 状态解释

- `CODE_B_IMPLEMENTATION: PASS` 仅表示工程实现达到 Code B 任务书边界。
- `CODE_B_MERGE_READINESS` 只有 Linux CI、Windows regression 与既有 Code F review 全部通过后才可改为 PASS。
- `CODE_B_FOUNDATION_ACCEPTANCE` 在真实 Provider 与真实 bucket 外部门禁解除前保持 BLOCKED。
- 示例 Provider 配置没有有效生产 model、非零价格或法律批准；法律记录不存在时 Gateway fail closed。
- 真实付费 canary 不进入普通 PR CI，不向不可信 PR 暴露生产 Provider Key。
