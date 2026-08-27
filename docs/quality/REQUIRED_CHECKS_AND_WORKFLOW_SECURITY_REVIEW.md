# Required Checks and Workflow Security Review

审阅日期：2026-08-27。范围：`.github/workflows/ci.yml`、`windows-native-smoke.yml`、`windows-e2e.yml`、CODEOWNERS 和发布 secret boundary。

## Review result

- Workflow token 默认最小化：PR/CI 仅 `contents: read`；release 仅增加 `actions: read` 用于下载已知 artifact。
- checkout 使用 `persist-credentials: false`。
- 所有第三方 Actions 固定到已核验的 commit SHA，并在注释保留版本标签。
- 生产签名 secret 只在手工、`main` 限制、受保护 `release-signing` environment 的 build-once job 引用。
- clean-VM job 不接触签名 secret；普通 PR/native/unit job不接触 Provider Key 或生产 secret。
- `pull_request_target` 未使用；不可信 PR 代码不会在 production-secret context 执行。
- release workflow 对非 `refs/heads/main` 直接跳过，不允许用 Code F branch artifact 获得正式 PASS。
- concurrency 对 PR 可取消旧运行；release candidate 不自动取消，避免中途替换 artifact。
- job 设置 timeout，artifact retention 明确，candidate 使用 upload-artifact v4 immutable artifact 行为。

## Required checks expectation

main branch protection/ruleset 应要求：

- `CI / quality`
- `CI / isolated-clean-checkout`
- `Windows native smoke / packaged-native-addon`

Windows native workflow 已改为每个 PR 运行，避免 path-filter 造成 required check 缺席。任何更名必须同步 ruleset；任何删除/临时禁用必须有原因、风险、owner、恢复日期。

## Unverified external setting

当前只有 Git SSH 权限；没有可用 GitHub Connector/CLI 管理权限证据来读取 private repository branch protection/ruleset。因此“workflow 安全审阅”完成，但“远端 required checks 已实际启用”仍为 `UNVERIFIED / RELEASE BLOCKER`。合入后由仓库管理员在 GitHub Settings → Rules/Rulesets 核对并保留截图或 API 输出。

## Remaining hardening

- stable 前需对 NSIS 解包内容和 asar 解包内容执行 secret/license/SBOM inventory；当前原始压缩 installer 扫描不足以替代解包扫描。
- 配置 GitHub environments 的 required reviewers、防自审、deployment branch `main` 限制和 secret 访问审计。
- 签名证书优先使用托管 HSM/云签名；若暂用 PFX，限制 environment、轮换并禁止 artifact 上传私钥。
- 接入 Code B 后，真实 Provider canary 使用独立低额度 secret/environment，不在 PR 或普通 unit workflow 暴露。
