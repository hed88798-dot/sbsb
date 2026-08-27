# Media Worker v0.3

受控 Python 3.12 CPU worker，通过 stdio NDJSON protocol `1.0` 提供：

- `media.index.asset.v1`：probe、PySceneDetect、safe/mid/best 关键帧、质量、SigLIP 2 ONNX embedding 与带 hash manifest。
- `media.search.exact.v1`：校验 generation/signature/row mapping 后，以 NumPy mmap、float32 累加执行 exact Top-K。

worker 不打开业务 SQLite、不监听 HTTP、不持有 Provider secret。模型和 ffprobe 都由 Main 传入已校验的仓库/安装包解析路径；用户媒体路径只作为 argv 元素传递，`shell=false`。VLM 默认关闭，静态关键帧不会声称咳嗽、喘气、跛行等动态状态。

Windows release worker 从固定 Python 3.12 x64 环境安装 `requirements.lock`，再用
`PyInstaller==6.22.2` 和仓库内 `media-worker.spec` 构建。模型与 ffprobe 不塞进 worker，
分别由 Desktop 已签名 model pack / native binary 机制激活并校验。构建产物必须由 release
流程记录 SHA-256、wheel SBOM、签名和 clean Windows smoke；仓库不提交 exe、模型或客户素材。
