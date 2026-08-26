# Desktop Architecture：唯一推荐方案

## 结论

唯一推荐：**Electron + React/TypeScript + 单一桌面主进程 + 受控 Python 媒体智能侧车 + SQLite + 受审计 FFmpeg/whisper.cpp 二进制 + Lightweight Backend**。

Electron 截至尽调日的最新稳定版为 44.0.0，但刚发布一天；Code A 应先固定在仍受官方支持、已稳定运行的 43.4.x 最新补丁，完成两周兼容性与安全回归后再升级。Electron 官方只支持最近三个稳定主版本，且约每 8 周发布一个主版本，因此必须把框架升级纳入月度维护，而不是长期钉死一个主版本。[Electron 支持策略](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)；[当前发布表](https://releases.electronjs.org/)

## 为什么选择 Electron，而不是 Tauri

| 维度 | Electron | Tauri 2 | 本项目判断 |
|---|---|---|---|
| Windows | 自带一致 Chromium；NSIS/更新生态成熟 | 依赖 WebView2；安装包更小 | Electron 的一致渲染更利于视频预览与企业机排障 |
| macOS 后续 | 同一 Node/Chromium 模型 | 支持良好 | 均可，非决定项 |
| 安装包 | 大，叠加模型包后更大 | 明显更小 | 模型与 FFmpeg 才是主要体积；模型包按需下载 |
| 自动更新 | Electron/electron-updater 成熟；Windows/macOS | 官方 updater 支持签名 | 均可；Electron 运维样本更多 |
| 文件/SQLite | Node 原生能力强；native addon 需重编译 | Rust 插件能力强 | Electron 开发更快 |
| FFmpeg/sidecar | `child_process` 与流式 stdout/stderr 简单 | 支持 external binary，但需 Rust capability/target triple | Electron 边界更少 |
| 本地 AI | Python/ONNX/CLI 子进程容易编排 | 也能做，但 Rust 桥接增加语言面 | 不为壳层引入 Rust |
| 多媒体调试 | Chromium DevTools + Node 工具链 | WebView 差异需额外排查 | Electron 胜 |
| 开发效率/智能体维护 | TS 单语言覆盖 UI、主进程、轻后端 | TS + Rust + Python | Electron 胜 |
| 安全 | 权限大，必须主动加固 | 默认能力模型更细 | Electron 可通过严格隔离达到 V1 需求 |
| 许可 | MIT + Chromium notices | MIT/Apache-2.0 | 均可商用，均需第三方 notices |

Tauri 官方确实支持把 PyInstaller 产物作为 sidecar，也支持签名更新，因此它不是“做不到”。本选择基于本项目三种运行时（UI、媒体/文件、Python AI）同时存在时的总复杂度，而非框架宣传指标。[Tauri sidecar](https://v2.tauri.app/develop/sidecar/)；[Tauri updater](https://v2.tauri.app/plugin/updater/)

## 运行时拓扑

```text
┌──────────────── Electron ────────────────┐
│ Renderer (sandboxed React)               │
│   只调用窄化、类型化 preload API          │
│              │ IPC                       │
│ Preload (contextBridge allowlist)        │
│              │                           │
│ Main Process                             │
│   application services / DB owner        │
│   filesystem / jobs / updates / auth     │
│       │ stdio NDJSON       │ argv        │
│ Python Media Worker    FFmpeg/ffprobe    │
│ ONNX / scene/index     whisper.cpp       │
└──────────────┬───────────────────────────┘
               │ HTTPS
      Lightweight Backend / Provider Proxy
               │
      Text/Image/Video/TTS/LipSync APIs
```

## 进程职责

### Renderer

- React 页面、表单、进度、Shot/Timeline 预览；
- 不启用 `nodeIntegration`；
- `contextIsolation: true`、`sandbox: true`；
- 不加载任意远程页面，不执行远程脚本；
- 不获得通用文件路径读写、shell、数据库或任意 HTTP 权限；
- 对所有 IPC 入参和返回使用共享 JSON Schema/Zod 校验。

Electron 官方安全清单要求保持当前版本、启用隔离/沙箱、限制导航与窗口、验证 IPC sender、设置 CSP。[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)

### Preload

只暴露面向用例的方法，例如：

```ts
desktop.products.list()
desktop.media.chooseFolders()
desktop.index.start(folderIds)
desktop.autoEdit.build(request)
desktop.jobs.cancel(jobId)
```

禁止暴露 `ipcRenderer.send`、`fs`、`exec`、任意 URL fetch 或通用 SQL。每个 channel 在主进程验证 sender frame、窗口身份与 schema。

### Main Process

- 唯一业务编排者和 SQLite 写者；
- 管理产品、文案、素材、任务、Timeline 与配置 repository；
- 通过参数数组启动受信任二进制，不经过 shell；
- 生成工作目录、限额、取消、超时、进程树清理；
- 管理模型包、签名清单、自动更新和 Windows Credential Manager；
- 调用轻后端，不直接持有 Provider Key。

### Python Media Worker

只承担 Python/ONNX 生态确实更成熟的任务：

- PySceneDetect Shot Detection；
- 关键帧/质量分析；
- SigLIP 2 embedding；
- 可选 Florence-2 caption/descriptor enrichment；
- 矩阵 Top-K 与轻量重排的计算原语。

它不监听公网端口，不提供 localhost HTTP，不直接打开业务 SQLite。主进程通过 stdin/stdout NDJSON 发送版本化任务，worker 只写任务专属临时目录并返回 manifest。这样避免端口抢占、防火墙提示和双写数据库。

### FFmpeg / ffprobe / whisper.cpp

- 作为签名/校验过的独立二进制，由 Main 或 Worker 以 argv 调用；
- FFmpeg 做探测、缩略图、裁切、比例处理、字幕、音频混合和最终 MP4；
- whisper.cpp 仅接收主 FFmpeg 预处理的 16 kHz mono WAV，不编译仓库中的 GPL `ffmpeg-transcode` 示例；
- 所有输出先落到 job temp，`ffprobe` 校验后原子移动。

## Sidecar Contract

每条消息是一行 JSON；协议首条握手：

```json
{"type":"hello","protocol_version":"1.0","worker_version":"0.1.0","capabilities":["shot.detect.v1","embed.siglip2.v1"]}
```

任务：

```json
{
  "type": "request",
  "request_id": "uuid",
  "method": "shot.detect.v1",
  "deadline_ms": 3600000,
  "payload": {"input_path":"...","output_dir":"...","profile":"cpu-default"}
}
```

事件只允许 `accepted/progress/result/error/cancelled`。错误包含稳定 `code`、可展示 `message`、可重试标志和脱敏 diagnostic。大数组、帧和向量不穿过 stdout，返回带 SHA-256 的工件路径。

兼容规则：

- 主版本不一致拒绝启动；
- 新增可选字段向后兼容；
- 删除/改义必须升 major 并写 ADR；
- 结果必须携带 `index_schema_version/model_id/model_version/prompt_version`。

## 本地数据与文件布局

```text
%LOCALAPPDATA%/Company/Product/
  app.db
  logs/
  models/<model-id>/<version>/
  cache/
    thumbnails/
    vector-matrix/<index-signature>/
  jobs/<job-id>/
  licenses/

<用户选择的 Workspace>/
  generated/
  digital-human/
  exports/
  backups/
```

- `app.db` 必须在本地固定磁盘；SQLite WAL 不支持网络文件系统的跨主机共享语义。[SQLite WAL](https://www.sqlite.org/wal.html)
- 原始企业素材留在原文件夹；数据库只保存 canonical path、file identity、hash 和 metadata；
- 生成资产采用内容哈希和 lineage，不覆盖输入；
- cache 与 jobs 可安全重建/清理，SQLite 和用户 Workspace 才是备份对象；
- 备份使用 SQLite Online Backup API，不能在 WAL 写入时只复制 `.db` 文件。

## SQLite 写入模型

- 主进程单写者；worker 回传批次结果后，由主进程短事务写入；
- `journal_mode=WAL`、`foreign_keys=ON`、合理 `busy_timeout`；
- `synchronous=NORMAL` 用于可重建索引缓存，关键产品/文案数据可在提交点执行显式 checkpoint/备份；
- 每个迁移在 `schema_migrations` 留版本、checksum、执行时间；
- 启动先备份再迁移；迁移失败不启动新版本，保留旧安装包回滚入口。

## 模型包与安装包

基础安装包不塞入所有模型：

1. 安装包包含 Electron、Python worker runtime、受审计 FFmpeg/ffprobe、必要 DLL 和模型下载器；
2. embedding、ASR、VLM 分为独立 model pack；
3. backend 返回签名 manifest，桌面内置公钥验证 manifest、文件大小、SHA-256、license id 和兼容 worker version；
4. 下载到版本目录，完整校验后切换 `active` 指针；
5. 模型回滚不改变业务 DB，只触发版本化索引重建。

## 任务与恢复

任务状态：`QUEUED → RUNNING → SUCCEEDED | FAILED | CANCELLED | INTERRUPTED`。

- 每个阶段保存 checkpoint，索引按 Asset/Shot 提交；
- 软件崩溃后 RUNNING 改为 INTERRUPTED，由用户继续或重来；
- Provider 任务保存 remote job id，可恢复轮询，禁止盲目重复收费；
- worker 心跳超时先请求取消，再终止进程树；
- 不允许两个索引任务同时分析同一 file hash。

## 安装、签名与更新

- electron-builder 26.15.x + NSIS per-machine/per-user 策略在 Code A 实机决定；
- Windows 安装包和更新包必须 Authenticode 签名；
- 更新 manifest 另做 Ed25519 应用层签名，包含版本、channel、SHA-256、最低 DB/worker 版本和回滚限制；
- 稳定通道采用分批发布，失败率达阈值停止；
- 数据迁移不可自动降级时，更新前创建可验证备份；
- Electron、FFmpeg、Python runtime 和模型包各自独立显示版本。

## 安全不变量

1. Provider Key 绝不进入 desktop artifact；
2. Renderer 绝不拥有通用系统能力；
3. 不从网络下载并执行未签名代码/模型；
4. 所有外部媒体都视为不可信输入，解析进程最小权限、有限资源；
5. 所有命令用 argv，路径不拼 shell 字符串；
6. Auto Edit 包不得依赖 Digital Human 包；
7. 日志脱敏，上传崩溃报告必须用户同意；
8. 许可证/NOTICE/SBOM 是发布门禁，不是发布后补文档。

## 放弃 Tauri 的代价与控制

代价是更大的安装包、Chromium 安全升级压力和更强的默认权限。控制方式是模型包拆分、每月 Electron 升级、严格 sandbox/preload allowlist、fuses、安全 CSP、无远程内容与自动化依赖扫描。若未来验证 Electron 安装包成为成交阻碍，可在 V2 单独立 ADR 评估 Tauri；不能在 V1 同时维护双壳。
