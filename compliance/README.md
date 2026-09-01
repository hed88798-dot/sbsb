# Compliance artifact scaffolds

本目录只保存发布合规制品的 schema/template 说明，不把模板冒充完整发布清单。

当前 `pnpm sbom:generate` 生成 CycloneDX 1.6 的 npm 与已批准 Python wheel/native
源码/构建依赖清单，并明确标记为
`SOURCE_AND_BUILD_DEPENDENCIES_ONLY_NOT_INSTALLER_COMPLETE`。Python component 绑定 scope、wheel filename、
SHA-256、platform/Python ABI、license 和 provenance；它仍不足以解除 stable release 的 SBOM Gate。

stable 候选必须从解包后的真实 installer 重新盘点 Electron app、asar、Python wheels、native DLL、模型、字体、FFmpeg/whisper 和其他二进制，并将完整结果与 artifact SHA-256 一起归档。

External runtime prerequisite 使用 `runtime-prerequisites/` 中的 O/Q/I/E Contract。PR/clean-checkout
验证允许诚实的 `BLOCKED` 审批记录存在；release 验证要求 exact provider 的签名、安装 closure、许可与
未过期审批全部 PASS。External disposition 不批准 raw System32/CPython DLL，也不允许这些 external
capabilities 进入最终 Worker。

Build-only 工具与 runtime 组件使用独立 reachability。Artifact Usage Binding v1 要求 PyInstaller
build wheel 进入 Build SBOM 与内部合规证据；只有真实进入发布 runtime 的组件才进入 Runtime SBOM
和 customer-facing notices。Build dependency 身份本身不构成 runtime reachability。

SBOM 还包含 `COMPLIANCE_TOOLING` scope 的锁定 `packaging==25.0` compatibility engine wheel；该 bootstrap
component 已绑定 upstream filename、SHA-256、license files、provenance 和 vulnerability source，不能从
开发机 Python 环境隐式取得。

CPython/toolchain 漏洞使用
`schemas/compliance/toolchain-vulnerability-disposition/v1/review.schema.json`。Stage A 只可授权构建验证候选，
Stage B 才能形成绑定 final Worker 的正式风险结论；所有 review 通过 current-context 精确比较实现到期与
artifact/source/graph/capability/policy 变化失效。示例正式记录位于
`compliance/vulnerability-reviews/cpython-3.13.15-windows-x64/`。

模板规则：

- `completeness` 为 `SCAFFOLD` 的文件一律不能通过 stable Gate。
- 尚未实现的模块使用空数组或 `NOT_PRESENT`，不得虚构来源、hash 或许可。
- 模型代码许可与权重许可分开记录。
- FFmpeg 必须记录实际 `-buildconf` 和最终 DLL，而不是只记录计划中的 configure 参数。
- Provider 条款批准必须包含负责人、日期、范围和到期复审日期。
