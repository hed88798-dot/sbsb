# AI 电商短视频桌面端

本仓库承载本地优先的 Windows 桌面产品与其最小云网关。Code C 分支在已合并的
`v0.1 Desktop Foundation + Product + Copywriting` 基线上实现 `v0.3 Local Media Intelligence + CPU Index`。

## 架构基线

已批准的 Code 0 文档位于 [`docs/architecture/code-0/`](docs/architecture/code-0/)。实现必须遵守 Electron 安全隔离、SQLite 单写者、版本化 Contract、Provider Key 不进入客户端，以及 Auto Edit 与 Digital Human 隔离等冻结边界。

## 本地开发

精确工具版本记录在 `package.json`、`pnpm-lock.yaml` 和开发文档中。完成 workspace 初始化后，可使用：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

`pnpm check` 同时执行 source secret、license first-pass 与 Golden manifest integrity。`pnpm clean-checkout` 会在带空格路径的 detached worktree 和隔离 pnpm store 中从锁文件重建；它不允许依赖历史 `dist`、开发机 store 或手工 symlink。

Windows、native addon 与打包说明见 `docs/development/WINDOWS_SETUP.md`。
架构所有权和冻结边界见 `docs/development/ARCHITECTURE_BOUNDARIES.md`。
Quality/Release/Compliance 门禁见根目录的 `CI_GATE_MATRIX.md`、`DEPENDENCY_ACCEPTANCE_POLICY.md` 和 `RELEASE_GATE.md`。

## 当前范围

- Electron 安全桌面壳
- SQLite migrations 与产品库
- AI 文案、Product Fact Lock 与本地 Job 历史
- Mock Gateway、Text capability contract 与 mock sidecar smoke
- Shot 级本地素材索引、增量/恢复、SQLite float16 真源与 mmap exact search

Auto Edit、Matcher、Timeline、FFmpeg 最终成片和数字人不在 Code C v0.3 范围。
