# Compliance artifact scaffolds

本目录只保存发布合规制品的 schema/template 说明，不把模板冒充完整发布清单。

当前 `pnpm sbom:generate` 生成 CycloneDX 1.6 的源码/构建依赖清单，并明确标记为 `SOURCE_AND_BUILD_DEPENDENCIES_ONLY_NOT_INSTALLER_COMPLETE`。它用于建立工具链和 PR 级审计，不足以解除 stable release 的 SBOM Gate。

stable 候选必须从解包后的真实 installer 重新盘点 Electron app、asar、Python wheels、native DLL、模型、字体、FFmpeg/whisper 和其他二进制，并将完整结果与 artifact SHA-256 一起归档。

模板规则：

- `completeness` 为 `SCAFFOLD` 的文件一律不能通过 stable Gate。
- 尚未实现的模块使用空数组或 `NOT_PRESENT`，不得虚构来源、hash 或许可。
- 模型代码许可与权重许可分开记录。
- FFmpeg 必须记录实际 `-buildconf` 和最终 DLL，而不是只记录计划中的 configure 参数。
- Provider 条款批准必须包含负责人、日期、范围和到期复审日期。
