# Code D Repository Boundary Inventory

Inventory date: 2026-09-09  
Start main baseline: `b10fe3e695c6e9ad43cbd278040e73d8e6858ac6`  
Code C closeout: `4df253f9b181043ab10a1d97a888f7980f1b9dde`

## Repository state reviewed

Code D starts from `main` baseline `b10fe3e…` with the frozen Code C closeout merged into the Code D branch. The merge is necessary because the Code C closeout is published on `origin/code-c/ffprobe-companion-build`, not yet reachable from `origin/main`.

| Boundary                    | Existing state                                                                              | Code D decision                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `packages/domain-auto-edit` | README placeholder; dependency rule forbids Digital Human                                   | Material Selection pure policy package lives here                                                              |
| Code C candidate contract   | `ShotSearchCandidateV1`: asset/shot identity, range, revision, semantic score, descriptor   | Read-only input; no contract change                                                                            |
| `packages/contracts`        | Zod/TypeScript v1 contracts, JSON Schema companions                                         | Add versioned Code D contracts without changing Code C types                                                   |
| `packages/local-db`         | Main-only `better-sqlite3`, WAL, foreign keys, numbered migrations                          | Add committed-decision repository and migration 003                                                            |
| Desktop Main                | service/repository orchestration; validated IPC; sole DB writer                             | Build authoritative history and execute selection transaction here                                             |
| Migration baseline          | Code C adds migration 002                                                                   | Code D adds forward-only 003; historical SQL remains immutable                                                 |
| Jobs/events/receipts        | jobs have persistent lifecycle; copywriting commits related rows in `IMMEDIATE` transaction | Selection is a synchronous committed decision, not a new Job type; receipt and result are persisted atomically |
| Tests                       | Vitest unit/contract/integration; AJV JSON Schema; migration backup/recovery                | Follow the same conventions and add batch/real-candidate regressions                                           |
| Dependency direction        | static rules protect Renderer/Main/domain/sidecar boundaries                                | Domain depends only on contracts; local-db never imports domain; Main composes both                            |

## Required answers

1. **Best existing package:** `packages/domain-auto-edit`. Material selection is Code D policy, not media understanding or rendering.
2. **Code C candidate entry:** Desktop Main receives an already semantically eligible `ShotSearchCandidateV1[]` and passes it through a thin compatibility adapter. The adapter validates the frozen contract, deduplicates identical asset/shot identities, derives deterministic semantic rank from `semantic_score + asset_id + shot_id`, and preserves range/revision/descriptor metadata.
3. **Compatibility adapter:** **YES.** Code C has semantic score but no explicit rank or material family. The adapter adds those Code D facts without requesting an upstream change.
4. **DB migration:** **YES.** A new append-only committed-decision table is required for SELECTED/NO_MATCH persistence, idempotency, history derivation and audit receipts.
5. **Can Code C stay frozen:** **YES.** `CODE_C_CONTRACT_CHANGE_REQUIRED: NO`.
6. **Is the architecture sufficient:** **YES.** Main + SQLite `IMMEDIATE` transactions provide the single-machine serialization required by V0.1; no service, worker, queue, cache or second database is required.

## Stop-gate result

```text
MEDIA_INDEX_CONTRACT_CHANGE_REQUIRED: NO
SIDECAR_PROTOCOL_CHANGE_REQUIRED: NO
CODE_C_CANDIDATE_SEMANTICS_CHANGE_REQUIRED: NO
MANDATORY_STOP: NOT_TRIGGERED
```
