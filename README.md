# AI 电商短视频桌面端

本仓库承载本地优先的 Windows 桌面产品与其最小云网关。当前里程碑是 `v0.1 Desktop Foundation + Product + Copywriting`。

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

Windows、native addon 与打包说明见 `docs/development/WINDOWS_SETUP.md`。
架构所有权和冻结边界见 `docs/development/ARCHITECTURE_BOUNDARIES.md`。

## 当前范围

- Electron 安全桌面壳
- SQLite migrations 与产品库
- AI 文案、Product Fact Lock 与本地 Job 历史
- Mock Gateway、Text capability contract 与 mock sidecar smoke

图片/视频生成、素材索引、Auto Edit、Timeline、FFmpeg 成片和数字人不在 v0.1 范围。
