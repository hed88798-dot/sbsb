# timeline

Code E 的纯 Timeline contract-validation 边界。E1 只提供 confirmed upstream input、
committed Code D reference 和 planning request self-hash 的验证工具。

当前不包含 Timeline planner、时长算法、SQLite、Main orchestration、FFmpeg、Render 或
Digital Human。canonical serialization 与 SHA-256 复用 `@app/domain-media-index` 已有实现，
不维护第二套 hash 算法。
