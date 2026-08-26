# local-db

Code A 所有。仅 Electron Main 可通过此包读写本地业务 SQLite。

数据库使用 WAL、`foreign_keys=ON`、Main Process 单写者和 forward-only migrations。Renderer 不得直接或间接导入本包。
