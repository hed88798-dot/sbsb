# domain-auto-edit

Code D 的纯领域边界。当前 v0.1 仅实现 Material Selection Policy，不包含 Timeline、渲染、TTS、字幕或 Digital Human。

该包只依赖 `@app/contracts`。它不访问 Electron、SQLite、文件系统、Python 或 Provider SDK；生产历史由 Desktop Main 从 SQLite 构造后注入。
