# Lockfile Policy

- JavaScript/TypeScript 使用 pnpm workspace，并提交唯一根 `pnpm-lock.yaml`。
- `package.json` 的 runtime、Electron、better-sqlite3 和打包工具使用精确版本，不使用 `latest`、`*` 或浮动 major。
- CI 使用 `pnpm install --frozen-lockfile`。
- Python sidecar 未来由 Code C 使用 Python 3.12 与带 hash 的锁文件；Code A mock sidecar 不引入第三方 Python 包。
- 原生二进制、模型和字体使用独立 manifest 固定来源、revision、SHA-256 和 license id。
- 依赖升级单独提交，并运行 contract、migration、native packaging、secret 和 license 检查。

