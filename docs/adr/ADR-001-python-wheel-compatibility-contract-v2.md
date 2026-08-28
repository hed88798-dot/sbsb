# ADR-001：Python Wheel Compatibility Contract v2

- 状态：Accepted
- 日期：2026-08-28
- 决策者：Code F / Quality Infrastructure Owner
- Supersedes：Python Artifact Inventory Schema v1 的 target/artifact tag 等值建模（v1 reader 保留）

## 背景

Schema v1 同时要求一份完整 dependency graph 中每个 artifact 的 Python/ABI/platform tag 与 target
triple 完全相等。这无法表达正常 CPython 环境中同时存在的 `py3-none-any`、解释器专用 wheel、`abi3`
wheel 和 compressed/multi-platform wheel。Issue #10 因此阻塞 Code C C-1；Code C 不得通过重命名 wheel、伪造
tag 或拆碎依赖图规避公共 Gate。

## 决定

建立 Python Artifact Inventory Schema v2，并把两个概念明确分离：

1. `target` 描述 CPython patch version、OS、CPU architecture，以及由固定兼容性引擎产生的完整
   compatible tag set；
2. 每个 wheel artifact 记录由其真实 upstream filename 解析出的完整 tag set；
3. 只有 artifact tag set 与 target compatible tag set 的交集非空才是 `COMPATIBLE`，交集作为证据写入
   inventory；
4. compatibility engine v1 固定使用 `packaging==25.0` 的公共
   `packaging.tags` 与 `packaging.utils.parse_wheel_filename` API；它的 wheel、hash、license、provenance、scope
   和 OSV 状态作为 bootstrap supply-chain lock 单独审核；
5. v1 reader 保留原有严格等值语义，不重新定义 v1。v1→v2 必须由显式 migration 命令结合已批准 v2
   target descriptor 完成；
6. candidate、migration 和 verifier 通过同一个 compatibility engine wrapper，CI 只 verify，不生成或接受
   新 target/wheel hash。

Schema version 与 compatibility engine version 独立。未来任一数据结构或算法语义变化均单独升级对应版本。

## 影响

- 一个 v2 inventory 可以保留完整 transitive graph，同时表达 universal、ABI3 和平台 wheel 的混合。
- exact filename、SHA-256、source/index、provenance、scope、license、vulnerability 和 native ownership 门禁不变。
- target compatible tags 必须在真实目标环境用 `packaging.tags.sys_tags()` 显式生成、版本化并审查；Linux
  manylinux 兼容性不会由其他 OS 猜测。
- v1 inventory 继续可读，但进入 mixed-tag intake 前必须迁移到 v2；v1 不再扩展新能力。
- target descriptor 和完整 tag set 会增加 manifest 体积，这是可解释、可审计判定的成本。

## 替代方案

- **偷偷放宽 v1 字段语义**：拒绝；这是 breaking contract，会让旧证据含义漂移。
- **手写 OS/ABI/tag 字符串规则**：拒绝；无法可靠覆盖 ABI3、compressed tags 和 manylinux。
- **使用 pip 私有 API**：拒绝；不是稳定公共 contract。
- **按 wheel tag 拆 inventory**：拒绝；破坏完整 dependency graph。
- **CI 自动解析并改写 inventory**：拒绝；新 tag/hash 必须显式进入 PR diff。

## 验证

- v1 reader、旧 v1 fixture 和 v1→v2 migration；
- Windows/Linux CPython 3.12 mixed-tag complete graph；
- ABI3、compressed Python tags、multiple manylinux platform tags；
- wrong OS/CPU/Python/ABI fail closed；
- candidate/verifier shared-engine parity；
- hash/provenance、SBOM、license、vulnerability、native 和 packaged reconciliation 回归；
- clean checkout、Linux CI 与 Windows native smoke。

## 重审触发

- `packaging` version 或 public API 改变；
- target descriptor 字段、tag materialization/hash 规则改变；
- 支持非 CPython、macOS、musllinux 或新的 ABI family；
- 不再 materialize target compatible tags；
- Python Packaging compatibility semantics 变化导致既有 inventory 判定不同。
