# timeline

Code E 的纯 Timeline domain 边界。E1 提供 confirmed upstream input、committed Code D
reference 和 planning request self-hash 的验证工具。E2 只增加 authoritative resolved
decision evidence 的校验、绑定和 normalized planning facts 派生。

E2 测试使用 fixture evidence；未来 E5 production evidence 只能来自 SQLite，经 Desktop
Main typed read 和 exact cross-check 后传给本包。Renderer/UI 不得提供 authoritative
evidence，本包不访问 SQLite、不调用 Code D selector。

当前不包含 duration policy、source trim、physical segments、SQLite、Main orchestration、
FFmpeg、Render 或 Digital Human。canonical serialization 与 SHA-256 复用
`@app/domain-media-index` 已有实现，不维护第二套 hash 算法。
