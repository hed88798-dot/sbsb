# Code D V0.1 Boundaries

## In scope

- exact Shot repeat prevention inside one video;
- batch Shot/Asset diversity;
- recent-use cooldown and frequency balancing;
- same Asset / different Shot behavior;
- deterministic scarcity degradation;
- `SELECTED` / `NO_MATCH` decisions and audit receipts;
- Main-owned SQLite history, transaction serialization and idempotency;
- unit, contract, migration, restart, concurrency, batch and read-only real-candidate tests.

## Frozen upstream

- Code C `ShotSearchCandidateV1` and semantic score meaning;
- Media Index schema and Sidecar protocol;
- SigLIP2 baseline and Golden Benchmark V3 files/ground truth;
- Worker/runtime artifact identity.

## Explicitly out of scope

- shot detection, keyframes, embeddings, query normalization or retrieval changes;
- Timeline, FFmpeg final render, TTS, subtitles or final video;
- Digital Human or LatentSync;
- UI/IPC product surface;
- GPU cluster, second worker, HTTP backend, Redis, MQ or another database;
- OPA, Kubernetes, Timefold, recommender or generic rules-engine runtime.

## Dependency rules

`domain-auto-edit` depends only on `contracts`. SQLite integration stays in `local-db`; orchestration and hashing stay in Desktop Main. Renderer cannot provide history and no Code D IPC channel is introduced in V0.1.
