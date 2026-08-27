# Golden Set Governance

F 持有 dataset version、manifest、完整性、授权、匿名化、访问控制和评测结果归档；业务 owner 持有算法实现，不单独持有 test label 修改权。

每个 manifest 必须通过 `schemas/golden/v1/golden-set-manifest.schema.json` 和 `pnpm golden:validate`，记录 dataset ID/version、authorization、provenance、label/annotation guideline version、train/calibration/test split、anonymous IDs、文件 SHA-256。`test` split 必须 `locked: true`。

真实大媒体不进入普通 Git。Git 只保存 manifest、匿名 ID、hash、labels、authorization status、受控获取说明及小型授权/合成 fixture。客户名称、目录结构、私人绝对路径和敏感内部产品信息禁止进入 fixture。

标签变更流程：授权/匿名化检查 → 两名标注者独立标注（适用时）→ 分歧裁决 → 新 dataset version → 更新 guideline/manifest/hash → F 审核。不得回写当前 test 结果；线上失败样本只能进入下一版数据集。算法作者不能为了改善某次指标单人修改 test label。

当前仓库只登记 `product-fact-synthetic@1.0.0` 合成回归集。Media Index/Auto Edit 的真实 golden media 尚不存在，不能宣称相关 golden Gate PASS。
