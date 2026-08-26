# 本地素材智能索引架构

## 目标与边界

索引单位是 **Shot**，不是整条视频。首次导入允许慢，日常剪辑只查询已经持久化的结果；未变化文件不得重新解码、VLM 或 embedding。V1 针对普通企业 CPU 运行，无独立 GPU 依赖。

```text
Folder -> File Inventory -> Shot Detection -> Keyframes
       -> SigLIP 2 Embedding -> Optional Descriptor Inference
       -> SQLite Truth + mmap Search Cache -> Shot Search
```

索引器只理解通用视觉事实；“该文案应该放什么镜头”属于 Auto Edit，不写入索引。

## 增量扫描与任务恢复

### 文件身份

`Asset` 使用内部 UUID，不以路径作永久 ID。每次扫描先比较规范路径、大小、修改时间和文件系统 ID：

- 完全一致：直接复用，零重分析。
- 新文件：流式计算 SHA-256 后进入完整流水线。
- 统计信息变化：计算 SHA-256；hash 相同只更新路径/时间，hash 变化生成新分析 revision。
- 文件移动但 hash 相同：合并为原 Asset，避免重复索引。
- 文件消失：标记 `MISSING`，不立即删除派生数据，给用户恢复机会。

hash 必须从内容计算，不能只把 `mtime + size` 当 hash。读取失败、断电、模型崩溃均写入可恢复任务状态；每个阶段提交独立 checkpoint。

### 流水线

1. **Probe**：FFprobe 读取时长、流、旋转、帧率、分辨率、像素格式和音频。
2. **Shot Detection**：PySceneDetect AdaptiveDetector 生成候选边界；合并过短碎片，超长静态段可按上限再分段。
3. **Keyframes**：每 Shot 默认取 25%、50%、75% 三帧；短 Shot 取中帧。解码成统一 RGB，不保存无必要的全分辨率副本。
4. **Quality**：计算模糊、黑帧、亮度、遮挡/重复的轻量指标。
5. **Embedding**：SigLIP 2 对关键帧批量 CPU 推理；L2 归一化后均值聚合并再次归一化，同时保留关键帧向量的可选引用。
6. **Descriptor**：规则先提取媒体事实；可选 Florence-2 为关键帧产生描述，再经固定解析器映射到受控字段。低置信或帧间冲突写 `unknown`。
7. **Commit**：单个 Asset 的 Shot、descriptor、embedding 在短事务内原子切换为新 revision。
8. **Search cache**：后台从 SQLite BLOB 重建连续 float16 mmap 矩阵和 `row -> shot_id` 映射，原子 rename 发布。

## 核心数据模型

### Asset

```text
asset_id, source_path, normalized_path, file_hash, size_bytes, mtime_ns,
media_type, duration_ms, width, height, rotation, fps,
status, active_revision, created_at, updated_at
```

### Shot

```text
shot_id, asset_id, revision, start_ms, end_ms,
keyframe_refs[], aspect_ratio, quality_score, analysis_status
```

所有搜索结果返回 `asset_id + shot_id + start_ms + end_ms`。任何 Timeline 都引用 revision，避免源文件重分析后悄悄改变已保存成片。

### VisualDescriptor

稳定外壳 + 可扩展 metadata：

```json
{
  "schema_version": 1,
  "shot_id": "shot_...",
  "species": ["pig"],
  "scene": "pig_farm",
  "action": ["feeding"],
  "health_state": "normal",
  "people_present": false,
  "product_present": false,
  "shot_type": "medium",
  "description": "多头生猪在现代化猪舍内采食",
  "quality": {
    "score": 0.82,
    "blur": 0.08,
    "dark": 0.03
  },
  "embedding_ref": "emb_...",
  "industry_metadata": {
    "veterinary": {
      "housing_type": "modern",
      "production_stage": "unknown"
    }
  },
  "confidence": {
    "species": 0.94,
    "scene": 0.81,
    "action": 0.77
  },
  "provenance": {
    "rules_version": "1",
    "vlm_model": "florence-2-base-ft",
    "vlm_model_version": "<sha>",
    "vlm_prompt_version": "v1"
  }
}
```

通用字段使用受控词表，但允许 `unknown` 和多值；行业字段以命名空间扩展，不能给通用表不断增加兽药专有列。布尔值允许 `true/false/null`，其中 null 表示未知，不能把未知当否定。

### EmbeddingRecord

```text
embedding_id, shot_id, model, model_version, dimension,
dtype, normalized, vector_blob, vector_sha256, created_at
```

SQLite 的 BLOB 是可迁移真源；`.f16` 矩阵和行号映射是可删除缓存，不参与备份。向量不塞入 JSON，不使用数据库扩展作为 V1 必需依赖。

## 搜索实现

1. 将 Visual Intent 的中英文检索文本用相同 SigLIP 2 text encoder 编码并归一化。
2. 对连续 float16 矩阵做分块精确点积，取 Top-K；计算时转换到 float32 累加。
3. 用 `species/scene/product_present/aspect/quality/duration` 做硬过滤或惩罚。
4. 交给 AnimalMatcher 轻量 rerank；索引层只返回候选与证据。

50,000 个 768 维 float16 向量约 76.8 MB，普通办公电脑可内存映射并以矩阵运算查询。性能门槛是 50k Shot、P95 小于 200 ms；达到 100k Shot 或连续版本不达标时，另立 ADR 评估 USearch。不能在没有数据前引入 FAISS/Qdrant。

## 索引签名和重建规则

每个 Asset revision 和全局缓存至少记录：

```text
index_schema_version
embedding_model
embedding_model_version
embedding_preprocess_version
vlm_model
vlm_model_version
vlm_prompt_version
shot_detector
shot_detector_version
shot_detector_params_hash
file_hash
```

变化处理：

- 文件 hash 变：只重建该 Asset。
- Shot detector 或参数变：该 Asset 的 Shot 及后续全部重建。
- embedding 模型/预处理变：保留旧索引可回滚，后台生成新 generation 后原子切换。
- VLM/prompt 变：只重建 descriptor，不强制重做 Shot/embedding。
- 数据库 schema 变：先备份再 migration；失败继续使用旧应用/旧 generation。

不同 embedding 模型的向量不得混在同一矩阵比较。

## CPU 可行性与资源治理

普通企业 CPU **可以完成首次索引**，但必须作为可暂停的后台工作：

- ONNX Runtime 默认物理核数的一半，用户可选“省电/平衡/快速”。
- 小批量推理并限制内存；前台预览/导出时自动降级或暂停。
- 关键帧而非全视频逐帧 VLM；VLM 默认可关闭或延迟到空闲时。
- 显示总文件、已完成 Shot、当前阶段、预计剩余区间和失败清单。
- 断点续跑，单文件失败不阻断整个文件夹。

Code C 必须在最低支持机（建议 4 核/8 GB）上测得 `实时秒/视频分钟`、峰值内存和热降频。文档不承诺未经实测的固定小时数；v0.3 以实机验收数据决定默认模型/量化。

## SQLite 表与所有权

建议表：`assets`、`asset_revisions`、`shots`、`keyframes`、`visual_descriptors`、`embeddings`、`index_generations`、`source_folders`、`index_jobs`、`index_job_steps`。业务主进程是唯一数据库写入者；Python sidecar 接收只读输入清单并输出带 hash 的结果 manifest，不能直接打开业务 SQLite 写入。

WAL 只用于本机磁盘；数据库不可放网络共享。备份使用 SQLite Backup API，而不是运行中直接复制 `db` 文件。[SQLite WAL 限制](https://www.sqlite.org/wal.html)、[SQLite Backup API](https://www.sqlite.org/backup.html)

## 安全、隐私与删除

- 默认所有索引、关键帧和描述留在企业本机；VLM 不上传原视频。
- 路径展示最小化，日志只记录资产 ID 和错误，不记录完整客户目录。
- 删除源文件不自动销毁客户原文件；“从素材库移除”和“删除缓存”分开。
- 用户执行永久清除时，删除 keyframe/cache/descriptor/embedding，并在数据库留下不含内容的审计事件。
- 对符号链接、超大文件、畸形媒体和路径穿越做输入限制；FFmpeg/FFprobe 以低权限子进程运行并设超时。

## v0.3 验收

- 同一 500 条素材二次扫描时，未变化文件的解码/VLM/embedding 调用数为 0。
- 修改一个文件只重建该文件；移动同 hash 文件不重复建索引。
- 任意搜索结果精确定位到 Shot 时间范围。
- 索引中断后可续跑，不产生半 revision 可见数据。
- 50k Shot 精确检索 P95 < 200 ms；最低支持机在索引时 UI 仍可交互。
- 所有结果能追溯模型、prompt、检测器、文件 hash 和 schema version。
