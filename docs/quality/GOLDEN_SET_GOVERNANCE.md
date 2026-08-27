# Golden Set Governance

F 持有 dataset version、manifest、完整性、授权、匿名化、访问控制和评测结果归档；业务 owner 持有算法实现，不单独持有 test label 修改权。

每个 manifest 必须通过 `schemas/golden/v1/golden-set-manifest.schema.json` 和 `pnpm golden:verify`，记录 dataset ID/version、authorization、provenance、label/annotation guideline version、train/calibration/test split、anonymous IDs、文件 SHA-256。`test` split 必须 `locked: true`。

## Canonical bytes 与命令边界

Golden hash 的对象是 manifest `path` 指向的仓库文件在 checkout 后的精确字节，不是 Git blob ID、平台默认文本转换结果或运行时静默规范化后的文本。每个条目必须显式声明：

- `UTF8_LF`：有效 UTF-8、无 BOM、只允许 LF、文件末尾恰好一个 LF；SHA-256 对满足该约束的精确字节计算。仓库必须用 `.gitattributes` 固定 `eol=lf`。
- `EXACT_BYTES`：不进行编码或行尾转换，直接对精确字节计算，供未来模型、媒体、FFmpeg 或其他二进制制品使用。

同一套 `manifest-integrity.mjs` 同时向生成和验证提供字节读取及 SHA-256 实现，避免两条路径对不同对象计算 hash。

`pnpm golden:update` 是唯一的 manifest hash 更新入口，只能由开发者在获得授权的数据变更时显式运行。运行后必须检查 Git diff、说明 dataset version/语义/授权/更新原因并通过 review 后 commit。CI、PR Gate、clean checkout 和 Windows smoke 只能运行只读的 `pnpm golden:verify`；mismatch 必须直接失败，禁止自动 refresh 后继续 PASS。

当前 `product-fact-synthetic@1.0.0` 保留 `packages/test-fixtures/src/index.ts` 作为 canonical dataset source：100 条场景由该文件确定性定义，仓库没有更底层的独立数据文件；`tests/golden/product-fact-regression.test.ts` 是锁定的评测入口。两者均被 manifest 和 LF 属性锁定。若未来把场景迁移为具体 JSON/data 文件，应以新 dataset version、明确迁移理由和对应 manifest 变更完成，不能只替换 hash。

真实大媒体不进入普通 Git。Git 只保存 manifest、匿名 ID、hash、labels、authorization status、受控获取说明及小型授权/合成 fixture。客户名称、目录结构、私人绝对路径和敏感内部产品信息禁止进入 fixture。

标签变更流程：授权/匿名化检查 → 两名标注者独立标注（适用时）→ 分歧裁决 → 新 dataset version → 更新 guideline/manifest/hash → F 审核。不得回写当前 test 结果；线上失败样本只能进入下一版数据集。算法作者不能为了改善某次指标单人修改 test label。

当前仓库只登记 `product-fact-synthetic@1.0.0` 合成回归集。Media Index/Auto Edit 的真实 golden media 尚不存在，不能宣称相关 golden Gate PASS。
