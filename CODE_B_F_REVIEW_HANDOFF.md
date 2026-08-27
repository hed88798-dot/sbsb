# Code B → Code F Review Handoff

状态：`CODE_B_MERGE_READINESS: PENDING_F_RE_REVIEW`

本文件只准备审核材料，不创建、寻找或打断 Code F。由用户在既有 Code F 任务中明确下达审核指令。

## Review scope

- Branch：`code-b/provider-gateway-v0.2`
- Base：`main@b7ddefbdda046118efaba9f3ef84b48ae8e2fb09`
- Code B implementation：PASS
- Foundation acceptance：BLOCKED（真实 Provider/真实 bucket 外部门禁）

## 新增或改变的运行时依赖

| 项目               | 精确版本/状态                    | 用途                    | Review 关注点                                         |
| ------------------ | -------------------------------- | ----------------------- | ----------------------------------------------------- |
| Node.js            | 24.19.0                          | Gateway runtime/CI 基线 | clean checkout、VPS runtime、漏洞支持窗口             |
| Fastify            | 5.8.5                            | HTTP Gateway            | Issue #5 修复、body/schema 回归、production audit     |
| better-sqlite3     | 13.0.3                           | Gateway SQLite WAL      | native build、Linux/Windows resolution、SQLite 3.53.4 |
| Provider SDK       | NONE                             | 使用固定 HTTPS adapter  | 确认无厂商 SDK 进入 Desktop/transitive graph          |
| Object Storage SDK | NONE                             | 内置 S3 SigV4 presigner | 签名正确性、secret scope、真实 bucket canary 后置     |
| Caddy              | 配置材料，未打包 Node dependency | TLS/reverse proxy       | request body limit、service permissions               |

## Production-safe defaults

- Provider 配置只引用服务端环境变量名；仓库无真实 Key。
- 示例 endpoint 使用 `.invalid`，model 为 `LEGAL_REVIEW_REQUIRED`，价格为零；它们不是生产事实。
- 没有有效 `provider + model + capability` 法律记录时 route fail closed，不能提交付费任务。
- CLI 要求显式数据库、secret、S3 与 Provider 配置；缺少任一必填项时启动失败。
- 真实 Provider canary 只有显式 `REAL_TEXT_PROVIDER_CANARY=1` 才运行，普通 PR 保持 deterministic Mock/Fake。
- 真实对象存储未配置时生产 CLI 无法启动；presign 实现 PASS 不等于 real bucket acceptance。

## 已执行验证

```text
workspace build                   PASS
format / lint / typecheck         PASS
tests                             203 PASS / 1 protected canary SKIP
20 concurrent idempotency         PASS
migration + online backup         PASS
dependency direction              PASS
portability                       PASS
secret scan                       PASS
license first-pass                PASS (660 packages / 0 manual review)
package resolution                PASS
SBOM scaffold                     PASS (660 components; Fastify 5.8.5 only)
production audit high/critical    PASS (0 / 0)
clean detached checkout           PASS (5d692e2; isolated store; frozen lockfile)
```

## Fastify P1 remediation evidence

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

- 修复原因：Issue #5 的两个 Fastify High production advisories；严格补丁下限为 `5.8.5`。
- 变更范围：`apps/gateway/package.json` 与 `pnpm-lock.yaml` 中 Fastify exact version/integrity。
- 传递依赖：没有新增 package；Fastify 现有直接传递依赖版本未变化。
- Production audit：High `0` / Critical `0`；AJV 链保留一个 Moderate，不属于 Issue #5 的 P1 阻塞。
- Full workspace audit 中的共享开发工具问题属于 Issue #6 / Code F，本修复没有修改这些依赖。
- Issue #4 Object Storage startup coupling 未处理；Gateway public contract 与启动语义未改动。

## Code F 请复核

- [x] Linux clean checkout + frozen lockfile build（本地 detached gate）
- [ ] Linux PR CI / quality（等待 Fastify 修复后的新 HEAD）
- [ ] Windows native regression（等待 Fastify 修复后的新 HEAD）
- [ ] Fastify Issue #5、SBOM、license、vulnerability re-review
- [x] Provider adapter 不成为 Desktop transitive dependency（Code F 原审核 PASS；本轮未改）
- [x] Caddy/systemd 最小权限与 production-safe defaults（Code F 原审核 PASS；本轮未改）
- [x] CI secret scope；普通 PR 无生产 Provider/Object Storage secret（Code F 原审核 PASS；本轮未改）
- [x] 无 approved production provider 时真实调用 fail closed（Code F 原审核 PASS；本轮未改）
- [x] 无真实 Object Storage 配置时 fail closed（Code F 原审核 PASS；本轮未改）
- [x] Gateway SQLite migration、WAL、Online Backup/restore instructions（Code F 原审核 PASS；本轮未改）
- [x] Known limitation：进程内 rate limiter/circuit breaker 重启清零；不要求引入 Redis

## 不属于本 PR merge readiness 的外部门禁

- `PRODUCTION_PROVIDER_APPROVAL: BLOCKED`
- `REAL_TEXT_PROVIDER_SMOKE: BLOCKED_BY_CREDENTIALS_AND_PROVIDER_LEGAL_REVIEW`
- `REAL_BUCKET_CANARY: BLOCKED`
- `CODE_B_FOUNDATION_ACCEPTANCE: BLOCKED`
- `V0_2_ACCEPTANCE: BLOCKED`
