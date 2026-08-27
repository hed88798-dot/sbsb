# Lightweight Gateway v0.2

Fastify 5.6.2 + TypeScript + SQLite WAL + Caddy 的最小可部署 Gateway，目标为 2 vCPU / 4 GB Linux VPS。
它只处理设备授权、Provider allowlist 代理、异步 Job、幂等、成本账本、短期对象中转和 release metadata；
不保存企业业务库或本地媒体索引。`startMockGateway` 仍保留给 Code A 离线契约测试，生产 CLI 不启动该 Mock。

## 安全不变量

- Provider Key 只从服务端环境/secret store 读取，配置文件只引用环境变量名。
- access token 默认 15 分钟；refresh secret 只保存 HMAC hash，刷新后立即轮换。
- 付费请求同时校验 token、设备 Ed25519 签名、timestamp、nonce、body hash 与 request ID。
- `request_id` 在许可证内唯一；超时进入 `UNKNOWN` 并查询上游，不盲目再次 submit。
- 预算检查、reservation 和本地 Job 创建在同一 SQLite transaction。
- 客户端只能提交能力、model alias 和严格参数；不能提交 URL、Provider payload 或 webhook。
- 对象直传，Fastify body 上限 1 MB；对象默认生命周期不超过 24 小时。
- Provider 法律清单缺失、过期或不允许商用时 fail closed。

## 部署

1. 安装精确 Node.js 24.19.0、pnpm 11.19.0 与 Caddy 2.x；以 lockfile 执行
   `pnpm install --frozen-lockfile` 和 `pnpm --filter @app/gateway... build`。
2. 把 checkout 部署到 `/opt/ai-video-gateway/current`，创建无登录用户 `ai-video-gateway`，
   数据库目录 `/var/lib/ai-video-gateway` 权限设为 0700。
3. 根据 `deploy/gateway.env.example` 从 secret store 写入 `/etc/ai-video-gateway/gateway.env`；
   不要把实际值写入 Git、镜像层或 shell history。
4. 根据 `deploy/providers.example.json` 创建生产配置。示例 candidate、model、endpoint 和零价格均不可
   直接生产启用；必须用当期正式信息替换并完成法律批准。
   对象存储 bucket 必须另外配置不超过 24 小时的 lifecycle deletion；presign 本身不替代 lifecycle。
5. 使用 `pnpm --filter @app/gateway admin -- seed-license` 创建许可证。每个
   `provider + model + capability` 由负责人填写法律批准 JSON，再执行 admin 的 `approve-provider`。
6. 安装 `deploy/ai-video-gateway.service`，启动后检查 `/health` 与 `/ready`；Caddy 终止 TLS，
   Gateway 只监听 loopback。

## 备份与恢复

- 每天运行 `pnpm --filter @app/gateway backup`，把 `GATEWAY_BACKUP_PATH` 设为带日期的加密暂存文件，
  再上传访问受控的异地存储；初始保留 30 天，RPO 24 小时。
- 命令使用 SQLite Online Backup API，不能在 WAL 运行时只复制单个 `.db` 文件。
- 每月抽样恢复：停止服务，保留当前数据库与 `-wal/-shm`，解密备份到新路径，执行
  `PRAGMA integrity_check`，再用同版本 Gateway 验证 `/ready` 和合成 Job smoke。
- 验证后原子切换 `GATEWAY_DB_PATH`；失败则恢复原路径。初始 RTO 4 小时。

## Key 轮换、撤销和真实 canary

在 secret store 建新 Key，更新环境并重启，通过受预算 canary 后撤销旧 Key。疑似泄漏时先在厂商侧
撤销，再关闭 route/切换已批准 fallback，最后审计 `audit_events` 和 `usage_events`。许可证与设备可
分别用 admin CLI 撤销。

真实 canary 必须显式提供凭据、有效法律批准、非零当期价格和固定合成输入；设置硬成本上限，且不在
普通 PR 自动运行。缺凭据或法律结论时状态是 `BLOCKED`，不能用 Fake 结果代替真实 PASS。
满足全部条件后，以 `REAL_TEXT_PROVIDER_CANARY=1 pnpm exec vitest run
tests/canary/real-text-provider.canary.test.ts --maxWorkers=1` 运行完整纵向 canary。
