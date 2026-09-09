# timeline

Code E 的纯 Timeline domain 边界。E1 提供 confirmed upstream input、committed Code D
reference 和 planning request self-hash 的验证工具。E2 只增加 authoritative resolved
decision evidence 的校验、绑定和 normalized planning facts 派生。E3 消费这些冻结事实与
exact hash-bound duration policy，生成 deterministic physical timeline plan。

E2 测试使用 fixture evidence；未来 E5 production evidence 只能来自 SQLite，经 Desktop
Main typed read 和 exact cross-check 后传给本包。Renderer/UI 不得提供 authoritative
evidence，本包不访问 SQLite、不调用 Code D selector。

E3 只执行 FORWARD_FROM_SHOT_START，按 selection_request_id 独立维护 source cursor，
并显式输出真实物理 segments、fallback requirements、additional-selection requirements
与未消费 selections。它不实现 SQLite、Main orchestration、第二次 D selection、FFmpeg、
Render 或 Digital Human。canonical serialization 与 SHA-256 复用
`@app/domain-media-index` 已有实现，不维护第二套 hash 算法。
