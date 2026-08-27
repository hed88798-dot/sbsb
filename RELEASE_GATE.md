# Release Gate

## Invariants

1. 正式 PASS 只绑定真实 `main` commit 生成的不可变 artifact。
2. beta 测试和 stable promotion 使用同一个 artifact SHA-256；任何重建都是新 candidate，重新过 Gate。
3. 未解决 P0/P1、未知 license/model/binary、Provider Key 泄漏或不可恢复 migration 直接阻止发布。
4. 不可信 PR 不能取得 Provider Key、正式签名材料或生产环境权限。
5. Golden test split 在正式评测前保持只读；算法作者不能单人改标签迎合结果。

## PR merge gate

必须通过：format、lint、typecheck、unit/contract/integration、migration、dependency direction、developer-path portability、workspace package resolution、source secret scan、license first-pass、golden manifest integrity、clean build、isolated clean checkout、Windows packaged native smoke。

跨 IPC/DB/provider/sidecar/public domain contract 的破坏性变化需要 Architecture Question/ADR。依赖变化同时提交 provenance/license/NOTICE 影响说明。

## Beta gate

全部条件为真才可进入 beta：

- candidate 来自 clean `main`，metadata 含 commit、run ID、timestamp、固定 Node/pnpm/Electron、DB/IPC/sidecar/model/native versions；
- installer SHA-256 已生成并验证，Authenticode 有效；
- Windows 10/11 clean VM 的 install/launch/product/copywriting/update/relaunch/data retention/uninstall 通过；
- migration 使用当前 stable DB fixture，升级前备份，失败可恢复；
- artifact secret scan、release license gate、installer-complete SBOM、NOTICE 和适用的 model/FFmpeg/provider manifests 完整；
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

以下合规项同样硬阻塞：未知/未批准 GPL/AGPL、未知 model weight rights、未登记 native binary/font/codec、错误 FFmpeg build、缺失必需 NOTICE、无法确认来源/hash、Provider legal status 未批准。

## v0.1 gate

只有以下全部 PASS 才能设置 `ALL_V0_1_ACCEPTANCE = PASS`：

- Code A implementation；
- Linux CI；
- Windows native smoke；
- Windows clean VM；
- B 合入 main 后，F 独立执行真实 Text Provider smoke并证明 Key 不进入 Desktop、成本/延迟/状态可追溯、错误不泄密。

当前 Windows clean VM 和 real Text Provider 均未正式通过，因此 v0.1 stable/tag 被阻止。
