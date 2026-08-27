# Dependency Acceptance Policy

适用对象：npm package、Python wheel、native DLL/CLI、model/weight、font/codec、GitHub Action，以及会进入 installer、sidecar、model pack 或发布链的传递依赖。

核心规则：以最终 artifact 为判断对象；未知来源、版本、hash、许可或再分发权一律 `REJECT / FAIL CLOSED`。仓库 LICENSE、付费 API 或代码许可不能自动覆盖模型权重、字体、编解码器、传递二进制和输出权。

## Common intake record

每项新依赖必须记录：

- 名称、用途、owner、直接/传递关系；
- 官方 source URL、精确版本/revision、下载 artifact SHA-256；
- code license、binary/weight/data license、copyright/NOTICE；
- commercial use、redistribution、modification/source-offer、attribution 义务；
- 安全公告/CVE、维护状态、签名或上游 provenance；
- 是否进入 installer/model pack/build chain；
- 审查人、审查日期、复审/到期日和书面例外（如有）。

## Decision classes

| Class           | Meaning                                                                | Merge                    | Release                                       |
| --------------- | ---------------------------------------------------------------------- | ------------------------ | --------------------------------------------- |
| `ALLOW`         | 来源/版本/hash 清晰，宽松许可，义务可自动/明确履行                     | Allowed after tests      | Allowed after final artifact inventory/NOTICE |
| `MANUAL_REVIEW` | LGPL/MPL/专利/平台条款/再分发边界等需要工程+法务确认                   | 可在不分发路径实验并标记 | 未有书面批准不得发布                          |
| `REJECT`        | GPL/AGPL/SSPL/NC/research-only、浮动来源、未知许可/权重、未登记 binary | Blocked                  | Blocked                                       |
| `EXCEPTION`     | 仅非 P0/P1 且书面批准，含 owner/risk/expiry/follow-up                  | 按记录                   | 到期自动恢复 Blocked                          |

## Type-specific rules

| Type               | Usually allowed                                                | Manual review                                            | Rejected / fail closed                                          |
| ------------------ | -------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| npm                | exact lock + MIT/BSD/Apache/ISC，传递依赖已盘点                | MPL/LGPL、postinstall 下载 binary、弃维护关键包          | unknown/GPL/AGPL/SSPL、floating version、未登记 binary download |
| Python             | Python 3.12、带 hash lock、官方 wheel/source、宽松许可         | PyInstaller exception、native wheel、OpenCV/codec bundle | 无 hash、个人环境、PyAV/x264/x265 未审计 wheel、未知 DLL        |
| Native / CLI / DLL | 官方源码、可复现 recipe、exact commit/hash、许可/符号依赖已查  | LGPL 动态链接、系统 codec、专利地区问题                  | 整合包、未知 build flags、GPL/nonfree FFmpeg、libx264/libx265   |
| Model / weight     | 官方 revision/hash，代码许可与 weight 许可分开，允许商业再分发 | API-only、自定义/OpenRAIL 条款、输出/训练/地区限制       | NC/research-only、社区重打包无 provenance、remote code 未审计   |
| Font               | 固定版本/hash，OFL/Apache 且保留文本                           | 名称保留/嵌入限制                                        | 系统商业字体拷贝、来源/嵌入权未知                               |
| GitHub Action      | 固定审核过的 commit SHA，最小 token permissions                | 组织内可变 action、需要写权限/OIDC                       | `@latest`、不可信 PR 获得生产 secret、未审批 workflow           |
| Provider SDK/API   | server-only、条款/region/output rights allowlist               | retention、跨境、voice/portrait、模型级条款              | Desktop 内平台 Key/vendor SDK、未知模型输出权、任意 base URL    |

## Automated gates

- `tools/license-audit.mjs` 盘点 pnpm virtual store，包含 scoped packages；未知或 blocked license 永远失败。
- PR first-pass 可以报告 `MANUAL_REVIEW`；`--release` 对任何未处置 review 项失败。
- `tools/secret-scan.mjs` 支持 Git-tracked source 和 `--require <artifact path>`；缺少声明的 artifact 路径也失败。
- CycloneDX scaffold 明确标为“不完整、release blocking”；stable 必须由解包后的实际 installer 生成完整清单。
- 新 model/native/font/binary 在 manifest 未登记前不能进入 installer。

批准一次不代表永久批准。版本、hash、build config、发行来源、条款或传递依赖变化均触发重新审查。
