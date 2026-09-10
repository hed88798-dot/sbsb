# Render Domain

Pure Code G domain contracts and deterministic preparation logic. This package does not access
Electron, SQLite, the filesystem, child processes, Python, or vendor SDKs. Desktop Main and local-db
adapters provide trusted persistence and machine execution facts.

R1A stops at `READY_FOR_EXECUTION`; this package does not construct or invoke FFmpeg commands.
