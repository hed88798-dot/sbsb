# domain-media-index

Shot 级媒体索引领域实现。这里拥有增量文件身份、索引签名、关键帧策略、保守的
VisualDescriptor 证据规则，以及可删除的 exact-search cache 格式。

业务 SQLite 仍由 Electron Main Process 通过 `@app/local-db` 的窄 repository 写入；
Python worker 不导入数据库模块、不打开 `app.db`。符号链接和 Windows junction 默认不
跟随，扫描不会越过用户选择的根目录。
