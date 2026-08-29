# ADR-018：Media Worker CPython 3.13.15 标准 GIL 工具链

- 状态：Accepted
- 日期：2026-08-29
- 取代：Code 0 技术栈中的 Python 3.12 Media Worker 基线
- 不取代：Sidecar Protocol 1.0、Migration 002、Media Index/SigLIP/ONNX 与缓存契约

## 决策

Media Worker 的唯一批准架构目标是标准 CPython 3.13.15、标准 GIL、ABI `cp313`：

- Windows x64 是生产 one-file Worker 目标；
- Linux x86_64 是正式 CI/兼容性目标，并记录实际 glibc、manylinux tags 与 runner image；
- PyInstaller 固定为 6.22.2；
- `pip`、PyInstaller、`pyinstaller-hooks-contrib` 与所有传递 wheels 使用精确版本、来源和 SHA-256；
- production runtime/build 只接收兼容的 binary wheel，禁止 sdist、VCS、私有 wheel、浮动 URL 与额外索引；
- `cp313t` 和 free-threaded CPython 无条件 fail closed。

批准架构目标不等于生产验收。在 Code C 完成真实 Windows/Linux graph、one-file archive、native
reconciliation、license/notice/vulnerability 与当前 HEAD 回归，并由 Code F 审核 PR #8 新 HEAD 前，
`PRODUCTION_TOOLCHAIN_ACCEPTANCE` 保持 `PENDING_C1_VALIDATION` 或 `PENDING_F_REVIEW`。

## 运行时硬证明

正式构建必须从实际解释器读取并保存：implementation、完整 patch version、`Py_GIL_DISABLED`、
`sys._is_gil_enabled()`（若存在）、`sys.abiflags`、`SOABI`、cache tag 和真实
`packaging.tags.sys_tags()`。只有同时满足以下条件才通过：

- CPython 3.13.15；
- `Py_GIL_DISABLED` 不为真，运行时 GIL API 不返回 false；
- `sys.abiflags`、`SOABI`、cache tag 与 compatible tags 均不含 `cp313t`/free-threaded 标记；
- compatible tags 至少包含一个 `cp313-cp313-*` tag；
- target descriptor 与当前解释器的完整 tag 集相同。

CPython distribution provenance 记录实际安装并用于创建构建 venv 的归档。CI 的 bootstrap Python
只负责取得和安装该 hash-locked distribution，不参与候选解析、安装或 Worker 构建。发行包容器、
内部安装入口以及最终解释器身份分别留证，不能用“版本相同”替代 artifact identity。

## 后果

Python 3.12 的历史 benchmark 与 SigLIP export provenance 继续保留为历史事实；本决策不触发 ONNX
重新导出、model revision 变更或 hash 变更。若任何生产依赖缺少批准的标准 `cp313` binary wheel，
或真实回归暴露不可接受问题，C-1 必须停止并重新打开 Python 工具链架构决策。
