# Release Gate

## Invariants

1. 正式 PASS 只绑定真实 `main` commit 生成的不可变 artifact。
2. beta 测试和 stable promotion 使用同一个 artifact SHA-256；任何重建都是新 candidate，重新过 Gate。
3. 未解决 P0/P1、未知 license/model/binary、Provider Key 泄漏或不可恢复 migration 直接阻止发布。
4. 不可信 PR 不能取得 Provider Key、正式签名材料或生产环境权限。
5. Golden test split 在正式评测前保持只读；算法作者不能单人改标签迎合结果。
6. External runtime requirement 必须绑定获准 prerequisite provider；raw System32/开发机副本不因
   external disposition 获得分发批准。

## PR merge gate

必须通过：format、lint、typecheck、unit/contract/integration、migration、dependency direction、developer-path portability、workspace package resolution、source secret scan、npm license/vulnerability、Python artifact inventory/hash/license/vulnerability、golden manifest integrity、clean build、isolated clean checkout、Windows packaged native smoke。存在 production worker inventory 时，Windows Gate 还必须完成 packaged native reconciliation。

Legacy/ambiguous Python wheel license facts may only pass through Artifact License Evidence v3 plus
an ACTIVE, authorized Artifact License Review v1 bound to the exact wheel SHA-256 and evidence
snapshot. Missing, conflicting, superseded-only, or revoked review state blocks release; CI machine
suggestions and package-name mappings are never approvals.

跨 IPC/DB/provider/sidecar/public domain contract 的破坏性变化需要 Architecture Question/ADR。依赖变化同时提交 provenance/license/NOTICE 影响说明。

## Beta gate

全部条件为真才可进入 beta：

- candidate 来自 clean `main`，metadata 含 commit、run ID、timestamp、固定 Node/pnpm/Electron、DB/IPC/sidecar/model/native versions；
- External Runtime Prerequisite 的 exact bootstrap、Authenticode、真实安装 closure、兼容策略、许可与未过期审批全部 PASS；release job 必须执行 `compliance:runtime-prerequisite:release`；
- installer SHA-256 已生成并验证，Authenticode 有效；
- Windows 10/11 clean VM 的 install/launch/product/copywriting/update/relaunch/data retention/uninstall 通过；
- migration 使用当前 stable DB fixture，升级前备份，失败可恢复；
- artifact secret scan、release license gate、installer-complete SBOM、NOTICE 和适用的 model/FFmpeg/provider manifests 完整；
- Python/native SBOM 来自实际 release wheel 和解包后的 packaged worker；locked input 与 packaged native
  inventory reconciliation 无 unexpected/missing/hash mismatch/unknown owner；
- PyInstaller one-file worker 必须静态解析最终 executable，而不是运行后临时目录或 one-folder staging；
  bootloader layer、CArchive payload 和 final executable 分别有 hash/provenance，zero-native/unparsed 失败；
- CPython runtime 回链到 exact、hash 固定的 distribution artifact；wheel-owned 与 toolchain-owned native 分离；
  build-only pip 不被错误要求进入 runtime；final worker provenance 绑定 commit、run、config、wheel/toolchain manifests
  与最终 SHA-256；当前不要求不同构建 bit-for-bit 相同；
- 所有命中的 CPython/toolchain CVE 已完成 Stage B；Stage A `ALLOW_VALIDATION_BUILD_ONLY` 或
  `PENDING_STAGE_B` 不能进入 beta。受影响但不可达的项必须绑定 exact distribution/final Worker/build context、
  packaged-module 与负测试证据，并以未过期的 `PASS_WITH_ACCEPTED_RISK` 明示；任何 `UNKNOWN`、权威证据冲突、
  binding 变化、到期/复审触发或 upstream fixed release trigger 均阻塞；
- Schema v2 wheel compatibility 由锁定 Compatibility Engine 验证，artifact filename tag set 与真实 target
  `sys_tags()` set 至少一个交集；target descriptor、engine/package version 和 tag-set hash 全部归档；
- production worker 与 export/evaluation scope 分离，production artifact 中不存在未批准的
  `torch`/`transformers`；
- 相关 golden regression 无未批准退化；
- 无 P0/P1；P2 例外有 owner/risk/expiry/follow-up。

beta 记录 artifact ID/SHA-256，不复制后重新命名为另一个未校验文件。

## Stable gate

stable 只能 promote 已通过 beta 的同一 artifact：

- 对比 beta artifact SHA-256 完全一致；
- beta soak/试点无新 P0/P1；
- rollback 演练和前一 stable artifact/DB 恢复路径可用；
- 更新 manifest 签名、channel、最低 DB/sidecar/model 兼容版本正确；
- SBOM/NOTICE/MODEL_MANIFEST/FFMPEG_BUILD/PROVIDER_LEGAL_ALLOWLIST 为 release-complete，不是 `SCAFFOLD`；
- 发布审批、隐私/EULA/Provider 条款在有效期内。

若必须重建，stable promotion 终止，新 SHA-256 回到 beta gate。

## Severity and hard blockers

P0 包括 Provider Key 泄漏、产品错绑、DB/用户文件破坏、任意代码执行、重复大额计费、不可恢复升级。P1 包括已知物种硬错配、成片核心路径不可用、更新失败不可恢复、授权绕过、Digital Human 耦合 Auto Edit。存在任何未解决 P0/P1：`RELEASE_BLOCKED`，业务 owner 无权口头放行。

以下合规项同样硬阻塞：未知/未批准 GPL/AGPL、未知 model weight rights、未登记 native binary/font/codec、Python wheel 无 hash/来源/platform/ABI、Python transitive graph 不完整、packaged worker 出现未知或 hash 不匹配 native binary、错误 FFmpeg build、缺失必需 NOTICE、无法确认来源/hash、Provider legal status 未批准。

External runtime 的公开可下载状态不是再分发许可。缺少适用产品许可、分发主体或授权证明时，
prerequisite manifest 可以通过结构验证，但 `--require-approved` 必须失败并阻止 beta/stable。

## v0.1 gate

只有以下全部 PASS 才能设置 `ALL_V0_1_ACCEPTANCE = PASS`：

- Code A implementation；
- Linux CI；
- Windows native smoke；
- Windows clean VM；
- B 合入 main 后，F 独立执行真实 Text Provider smoke并证明 Key 不进入 Desktop、成本/延迟/状态可追溯、错误不泄密。

当前 Windows clean VM 和 real Text Provider 均未正式通过，因此 v0.1 stable/tag 被阻止。
