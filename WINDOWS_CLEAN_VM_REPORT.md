# Windows Clean VM Report

报告日期：2026-08-27（Asia/Shanghai）  
正式验收状态：`WINDOWS_CLEAN_VM = BLOCKED`

本报告只承认由 `main` 上真实代码构建、带 SHA-256 和 workflow run ID 的不可变安装包。当前 Code F 分支上的 workflow/tooling 结果不能替代 main artifact 验收。

## Environment and artifact identity

| Field                       | Recorded value                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Windows version             | `NOT_EXECUTED`（当前执行环境为 macOS，未发现 Parallels/VMware/VirtualBox/UTM 或可用 Windows runner） |
| VM environment              | `NOT_AVAILABLE`                                                                                      |
| Main SHA                    | `b04b8c152cd3e589b17246f53bab16262aefe313`                                                           |
| Artifact SHA-256            | `NOT_AVAILABLE`                                                                                      |
| Workflow / run / build ID   | `NOT_AVAILABLE`                                                                                      |
| Build timestamp             | `NOT_AVAILABLE`                                                                                      |
| Installer version           | `0.1.0`（源码声明；尚无获准验收 artifact）                                                           |
| Electron / Node / pnpm      | `43.4.1 / 24.19.0 / 11.19.0`（源码锁定值）                                                           |
| DB / IPC / sidecar protocol | `1 / 1.0 / 1.0`（源码锁定值）                                                                        |
| Code signing                | `BLOCKED`（未提供正式 Windows 签名环境/证书）                                                        |

## Acceptance results

| Check                                                      | Result               | Evidence / reason                                                  |
| ---------------------------------------------------------- | -------------------- | ------------------------------------------------------------------ |
| Install                                                    | `FAIL — NO EVIDENCE` | 没有可追溯、已签名 main installer 在 clean Windows 10/11 VM 上执行 |
| Launch                                                     | `FAIL — NO EVIDENCE` | 未从安装目录启动正式 main artifact                                 |
| Product smoke                                              | `FAIL — NO EVIDENCE` | 未在安装后的 Desktop UI 创建并读取合成产品                         |
| Copywriting smoke                                          | `FAIL — NO EVIDENCE` | 未在安装后的 Desktop UI 执行 mock 产品文案并核对事实               |
| Update                                                     | `FAIL — NO EVIDENCE` | 没有获准旧版 immutable installer/run ID                            |
| Relaunch                                                   | `FAIL — NO EVIDENCE` | 更新未执行                                                         |
| Data retained after update                                 | `FAIL — NO EVIDENCE` | 更新/重启未执行                                                    |
| Rollback                                                   | `NOT_YET_AUTOMATED`  | workflow 已包含旧版重装与原业务数据打开路径，尚未在 main + VM 执行 |
| Update interruption / partial download / migration failure | `NOT_YET_AUTOMATED`  | v0.1 只有 schema 1；中断/部分下载场景仍需专用 harness              |
| Uninstall                                                  | `FAIL — NO EVIDENCE` | 未执行正式 installer 的 uninstaller                                |
| User data retained after uninstall                         | `FAIL — NO EVIDENCE` | `deleteAppDataOnUninstall: false` 只是配置证据，不是 clean VM 实测 |

## Prepared execution path

`.github/workflows/windows-e2e.yml` 已建立 fail-closed 流程：

1. 只允许手工从 `refs/heads/main` 运行；
2. 在隔离 `release-signing` environment 中 build once；
3. Authenticode 非 `Valid` 立即失败；
4. 生成 commit/toolchain/schema/run ID/artifact SHA-256 metadata；
5. 上传一次 immutable candidate；
6. Windows 10 和 Windows 11 clean-VM runner 下载同一 candidate；
7. 安装旧版，使用安装后的 UI 创建合成产品和文案；
8. 安装 candidate 完成升级并验证原产品/任务；
9. 回装旧版验证可恢复，再恢复 candidate；
10. 卸载并验证 `%LOCALAPPDATA%\Company\AiVideoDesktop\app.db` 保留。

## Known blockers

- 该 workflow/tooling 尚未通过 PR 合入 `main`；分支 artifact 不可获得正式 PASS。
- 未配置带 `windows-10-clean-vm` / `windows-11-clean-vm` 标签的可还原 runner。
- 未配置受保护的 `release-signing` environment 与 Windows Authenticode secrets。
- 未提供前一获准 main installer 的 workflow run ID、artifact name 和 SHA-256。
- update interruption、partial download 和真实 migration failure 仍为 `NOT_YET_AUTOMATED`。

因此：`ALL_V0_1_ACCEPTANCE = BLOCKED`，不得打 stable tag。
