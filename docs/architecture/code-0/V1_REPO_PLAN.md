# V1 Desktop Repo Plan

## 当前状态与原则

尽调时当前工作目录为空、不是 Git working tree，GitHub Connector 也没有返回可访问的已安装私有仓库。本轮不猜测远端、不初始化、不提交；架构审核后由用户给出私有仓库地址或确认在此初始化。

新项目采用单仓库，不继承旧 SaaS 目录。它是本地优先桌面产品 + 一个极小云网关，不用多仓库/微服务制造契约漂移。

## 目录方案

```text
/
├─ apps/
│  ├─ desktop/                 # Electron main/preload/renderer
│  │  ├─ src/main/
│  │  ├─ src/preload/
│  │  ├─ src/renderer/
│  │  └─ resources/
│  └─ gateway/                 # Fastify lightweight backend
├─ packages/
│  ├─ contracts/               # versioned IPC/provider/task schemas
│  ├─ domain-product/
│  ├─ domain-copywriting/
│  ├─ domain-media-index/
│  ├─ domain-auto-edit/
│  ├─ domain-digital-human/    # independent bounded context
│  ├─ timeline/
│  ├─ local-db/                # migrations/repositories; main process only
│  ├─ provider-client/         # desktop gateway client, no vendor SDKs
│  ├─ provider-adapters/       # server-side vendor adapters
│  ├─ ui/
│  └─ test-fixtures/
├─ sidecars/
│  └─ media-worker/            # Python: scene/keyframe/ONNX tasks
│     ├─ src/
│     ├─ tests/
│     ├─ requirements.lock
│     └─ model-manifests/
├─ native/
│  ├─ whisper/                 # pinned build recipe/patch manifest
│  └─ ffmpeg/                  # LGPL-only reproducible build recipe
├─ schemas/
│  ├─ ipc/
│  ├─ provider/
│  ├─ timeline/
│  └─ visual-descriptor/
├─ migrations/
│  └─ desktop-sqlite/
├─ tests/
│  ├─ contract/
│  ├─ integration/
│  ├─ e2e/
│  ├─ golden/
│  ├─ performance/
│  └─ security/
├─ tools/
│  ├─ license-audit/
│  ├─ model-pack/
│  ├─ release/
│  └─ golden-eval/
├─ docs/
│  ├─ adr/
│  ├─ architecture/
│  ├─ licenses/
│  └─ operations/
├─ .github/
│  ├─ workflows/
│  ├─ CODEOWNERS
│  └─ pull_request_template.md
├─ pnpm-workspace.yaml
├─ package.json
├─ pnpm-lock.yaml
├─ pyproject.toml
└─ README.md
```

`packages/domain-auto-edit` 对 `packages/domain-digital-human` 的 import 由依赖测试禁止。`provider-adapters` 只能被 gateway 使用；desktop 只能依赖 `provider-client`。

## Code A–F 所有权

| Code | 主责任 | 独占/主要目录 | 必须先冻结的契约 |
|---|---|---|---|
| A | Desktop Foundation | `apps/desktop`、`local-db`、产品/文案/UI | IPC v1、SQLite migration v1、文件任务协议 |
| B | Provider & Gateway | `apps/gateway`、`provider-client/adapters` | Provider Protocol v1、成本账本、授权协议 |
| C | Local Media Intelligence | `sidecars/media-worker`、`domain-media-index`、native build | Asset/Shot/Descriptor/Embedding manifest v1 |
| D | Auto Edit & Render | `domain-auto-edit`、`timeline`、FFmpeg render | ScriptSegment/VisualIntent/Timeline v1 |
| E | Digital Human | `domain-digital-human` 与独立 UI | DigitalHumanJob/Standalone VideoAsset v1 |
| F | Quality & Release | `tests`、`tools`、CI、签名、安装/升级 | golden set、SBOM、release/rollback gates |

A 是本地 DB 唯一写入边界；C 不直接写 DB。B 不拥有桌面业务对象。D 不依赖 E。F 可修改测试与发布工具，但业务修复仍由对应 owner 审查。

## 契约与变更规则

- 所有跨进程对象使用 JSON Schema/Zod 双向验证并含 `schema_version`。
- sidecar 协议为 stdio NDJSON；每个消息有 `request_id/type/version`，文件输出有 hash。禁止本机开放无认证 HTTP 端口。
- IPC channel 由 preload 显式 allowlist；renderer 不拿 Node、文件系统或数据库句柄。
- schema 的破坏性变化新开 major；至少保留一个桌面版本的读兼容。
- 数据库 migration 只前进、每步有备份和回滚策略；禁止应用启动时临时 ALTER 且无版本。
- 重要决定在 `docs/adr`；本 Code 0 的 `DECISIONS_V2.md` 审核后拆为单 ADR 文件。

## Git 与版本流

- `main` 永远可构建；短分支 + PR，禁止长期 A–F 大分支。
- Conventional Commits 只作为自动 changelog 输入，不替代清晰 PR 描述。
- 版本为 `v0.x.x`；每个安装包记录 Git commit、schema、sidecar、模型包和 FFmpeg build ID。
- release channel：`dev -> beta -> stable`。beta 实机通过后才能 promote，同一 artifact 不重编译。
- 正式标签签名；安装包、update manifest、SBOM 和 checksums 一起归档。
- rollback 保留前一 stable 安装包与 DB 兼容说明；migration 前在线备份。

## 大文件与测试数据

不把真实客户原视频、生成结果、模型权重、FFmpeg DLL 或安装包直接提交 Git。仓库只保存：

- 小型、明确授权的合成 fixture。
- golden set manifest、匿名标签、相对 ID、SHA-256 和获取说明。
- 模型 manifest/下载来源/hash，不默认提交权重。
- 可复现原生构建脚本和补丁，不提交来源不清的整合包。

大黄金素材放访问受控对象存储；若未来确需 Git LFS，先做成本/权限 ADR。`.gitignore` 覆盖用户 DB、缓存、mmap、关键帧、模型、日志、临时上传、输出视频、签名证书和 `.env`。

## CI 门禁

PR：TypeScript/Python lint、单元/契约测试、migration 测试、依赖方向、secret scan、许可证初筛。  
Nightly：Windows E2E、真实 FFmpeg/whisper、golden eval、CPU 性能、依赖漏洞。  
Release：干净 Windows VM 安装/更新/卸载、代码签名、SBOM、NOTICE、模型清单、FFmpeg `-buildconf`、恶意媒体和 Key 扫描。

CI 不下载未固定 revision 的模型，不执行模型仓库远端代码，不从浮动 `latest` 构建。

## 首次落仓顺序（架构批准后）

1. 确认私有 repo 和默认分支；把 12 份 Code 0 文档放入 `docs/architecture/code-0/`。
2. 加根 README、CODEOWNERS、ADR 模板、许可证政策和 lockfile 策略。
3. 只搭建空 workspace、contracts 和 CI，不提前创建业务实现。
4. Code A 以一条“主进程—preload—renderer—mock sidecar—migration”的垂直 smoke test 验证骨架。
5. Code B/C 可在已冻结契约后并行；D 依赖 C 的索引契约；E 保持独立；F 从第一版开始持续参与。

## 仓库验收

- 任何模块 owner 和依赖方向可由 CODEOWNERS/依赖测试验证。
- 新成员不接触真实 Key 或客户素材即可运行 mock 全链路。
- Windows clean build 可从锁文件和固定工具链复现。
- Auto Edit 无法在编译期引用 Digital Human；客户端无法引用 provider adapter。
- 任意发布可定位全部源码、模型、迁移、FFmpeg 配置和许可证清单。
