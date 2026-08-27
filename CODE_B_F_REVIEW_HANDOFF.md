# Code B → Code F Review Handoff

状态：`CODE_B_MERGE_READINESS: PENDING_CI_AND_F_REVIEW`

本文件只准备审核材料，不创建、寻找或打断 Code F。由用户在既有 Code F 任务中明确下达审核指令。

## Review scope

- Branch：`code-b/provider-gateway-v0.2`
- Base：`main@b04b8c152cd3e589b17246f53bab16262aefe313`
- Code B implementation：PASS
- Foundation acceptance：BLOCKED（真实 Provider/真实 bucket 外部门禁）

## 新增或改变的运行时依赖

| 项目               | 精确版本/状态                    | 用途                    | Review 关注点                                         |
| ------------------ | -------------------------------- | ----------------------- | ----------------------------------------------------- |
| Node.js            | 24.19.0                          | Gateway runtime/CI 基线 | clean checkout、VPS runtime、漏洞支持窗口             |
| Fastify            | 5.6.2                            | HTTP Gateway            | transitive dependencies、body limit、生产默认值       |
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
tests                             196 PASS / 1 protected canary SKIP
20 concurrent idempotency         PASS
migration + online backup         PASS
dependency direction              PASS
portability                       PASS
secret scan                       PASS
license first-pass                PASS
package resolution                PASS
```

## Code F 请复核

- [ ] Linux clean checkout + frozen lockfile build
- [ ] Windows native regression
- [ ] Fastify/better-sqlite3 transitive dependency、SBOM、license、vulnerability
- [ ] Provider adapter 不成为 Desktop transitive dependency
- [ ] Caddy/systemd 最小权限与 production-safe defaults
- [ ] CI secret scope；普通 PR 无生产 Provider/Object Storage secret
- [ ] 无 approved production provider 时真实调用 fail closed
- [ ] 无真实 Object Storage 配置时 fail closed
- [ ] Gateway SQLite migration、WAL、Online Backup/restore instructions
- [ ] Known limitation：进程内 rate limiter/circuit breaker 重启清零；不要求引入 Redis

## 不属于本 PR merge readiness 的外部门禁

- `PRODUCTION_PROVIDER_APPROVAL: BLOCKED`
- `REAL_TEXT_PROVIDER_SMOKE: BLOCKED_BY_CREDENTIALS_AND_PROVIDER_LEGAL_REVIEW`
- `REAL_BUCKET_CANARY: BLOCKED`
- `CODE_B_FOUNDATION_ACCEPTANCE: BLOCKED`
- `V0_2_ACCEPTANCE: BLOCKED`
