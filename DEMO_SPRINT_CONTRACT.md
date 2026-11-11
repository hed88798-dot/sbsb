# Demo sprint contract — 2026-11-12

Integration baseline: 69f4680abcd9a22be0f22f33329aac0f8a23edcc (PR 88 remains draft/open/unmerged).

## Thin IPC contract (frozen for this sprint)

Add `desktop.demo` with `propose({text, route})`, `confirm({candidate_id, candidate_revision, source_document_id, source_document_version, source_document_hash})`, `get({candidate_id})`. Propose uses deterministic sentence splitting, explicitly labeled OFFLINE_DETERMINISTIC; route is user-selected ANIMAL or PRODUCT, never inferred as real AI. Confirmation invokes existing ShotPlanAuthorityService. No automatic confirmation. Exact revision/source binding is mandatory.

DTO: `{mode:'OFFLINE_DETERMINISTIC', stage:'PROPOSED'|'CONFIRMED', candidate:CandidateShotPlanV1, confirmed:ConfirmedShotPlanV1|null}`. Main owns paths, repositories and authority; renderer cannot supply records or receipts. Schemas are strict and bounded. Existing render API remains the execution boundary.

## Ownership and worktree boundaries

| Lane                        | Files / responsibility                                                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Demo-Core                   | new main/demo-core-service.ts, new integration demo-core tests; source/script persistence, offline candidate, explicit confirmation |
| Demo-Media/TTS              | new main/demo-local-media.ts, tools/demo-media/\*, its tests/docs; real local index/search and audio probing; report gaps honestly  |
| Demo-UI (integration owner) | contracts/demo.ts + export/API, preload, ipc.ts, main/index.ts, renderer Demo page, this contract                                   |
| Demo-Render                 | new tools/demo-render/\*, relevant tests/docs; reuse committed timeline and formal renderer; inspect runtime and Windows blockers   |
| Demo-Caption                | same Render owner after core work; optional sidecar SRT first, isolated DEMO_UNRELEASED only if runtime/license permit              |
| Demo-E2E                    | integration owner; fresh DB authority tests, integration/build checks and evidence report                                           |

Each lane uses its own branch/worktree from baseline. Only integration owner cherry-picks lane commits. No merge of old stacked PRs. No modifications to frozen Render V1 policy, receipt, authority, runtime approvals, C3C evaluators or historical evidence. No real paid provider requests and no real 30-case run. Local materials must be actual user materials; test-generated media must be labeled synthetic and cannot count as real Demo acceptance.

First acceptance: 15–30 seconds, 2–3 shots, source persisted in fresh DB, explicit human confirmation, real indexed materials and audio, committed timeline, formal core MP4 with verification evidence. Windows acceptance requires actual Windows execution, not cross-build alone. Missing materials/runtime must be reported as blockers, never replaced with fake acceptance.
