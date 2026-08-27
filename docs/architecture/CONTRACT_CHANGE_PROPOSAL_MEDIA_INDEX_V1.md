# Contract Change Proposal: Media Index Commit v1

状态：Approved
类型：向后兼容、non-breaking  
Sidecar protocol major：保持 `1.0`

批准范围仅限本文列出的 Media Index v1 DTO、窄化持久化接口和 migration 002；不授予 Code C
重构 `@app/local-db` 整体 repository architecture、migration 001、既有产品/文案表、Desktop Job
semantics 或其他 A-owned DB contract 的权限。

## 为什么需要

Code A 的 `local-db` 只有产品、文案与通用 Job repository。Code C 必须提交 AssetRevision、
Shot、Descriptor、Embedding 与 IndexGeneration，但冻结架构禁止 Python worker 直接写
`app.db`。因此需要 Main Process 可调用的窄写入接口。

## DTO / Schema

- `AssetRevisionManifestV1`：worker job temp 中的完整 revision manifest。
- `MediaArtifactResultV1`：stdout 只返回 manifest path、manifest SHA-256、index signature。
- `commitAssetRevision(...)`：Main 校验 schema、signature、artifact containment、hash、dimension 后短事务提交。
- `listActiveEmbeddingTruth(signature)`：只读取 active revision 的 SQLite float16 BLOB。
- `publishIndexGeneration(...)`：cache 完整校验后短事务原子切换 active generation。

单 Asset `index_signature` 包含该文件的 `file_hash`；另以不含 `file_hash` 的
`generation_key_hash` 约束共同模型/预处理/检测器/关键帧策略。全局 generation signature
再绑定有序的 `(asset_id, revision, file_hash, asset_signature)`，避免把某一个 Asset signature
误作全库筛选键而漏搜其他素材。

## 所有权

Electron Main Process / `@app/local-db` 是唯一业务 SQLite 写者。Python worker 不依赖
`better-sqlite3`、不打开数据库、不监听端口。

## 兼容与 migration

Sidecar protocol 仍为 `1.0`，只在 method enum 增加
`media.index.asset.v1` / `media.search.exact.v1`。现有 request/event envelope 和 Job 状态不变。
SQLite 新增 forward-only migration `002_media_index_v1.sql`；不改写 migration 001 或既有表。
旧 Desktop 忽略新表，新 Desktop 仍可读取旧数据库并在升级前使用既有 Backup API 备份。

## 原子性

新 revision 的 Shot、Keyframe、Descriptor、Embedding 全部插入成功后才更新
`media_assets.active_revision`。新 cache generation 完整发布后才切换 `index_generations.active`。
任何校验、磁盘或事务失败都保留旧 active revision / generation。
