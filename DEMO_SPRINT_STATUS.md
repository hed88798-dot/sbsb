# Demo sprint implementation — 2026-11-12

Baseline: PR #88 HEAD `69f4680abcd9a22be0f22f33329aac0f8a23edcc`.
GitHub verification: Draft / Open / Unmerged; BASE `4b99bd8cdd0153382657f62a6fdd90da79924500`, one commit, eight files.
The supplied Code F PASS is offline-only. No Code F review was present in the GitHub discussion when checked. PR body still says review pending. This implementation accepts the user's handoff boundary without claiming a new independent semantic audit.

## Implemented and remaining

| Lane           | Implemented                                                                                                                                                                                 | Still required                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Demo-Core      | Exact user text persisted, deterministic 1–3 candidate slots, user-selected ANIMAL/PRODUCT, existing source/shot authorities, explicit revision-bound confirmation, separate CLI operations | Full later-stage orchestration and recovery                                                                          |
| Demo-Media/TTS | Verified worker-manifest ingestion; real worker exact-search and material-selection adapter; PCM16 per-slot local narration registration with measured samples, SHA and exact timings       | Controlled index-worker invocation, cache publishing, UI import; real input files; offline speech synthesis optional |
| Demo-UI        | Chinese Demo page, candidate review, explicit confirmation, committed-timeline listing, formal render preparation/execution/status                                                          | Material/audio import, editing routes per slot, playback and complete state progression                              |
| Demo-Render    | Confirmed evidence → existing timeline orchestration → formal render CLI; final MP4 hash and receipt check                                                                                  | Approved Windows runtime staging and actual execution                                                                |
| Demo-Caption   | Independently exported, hash-bound SRT from committed source/timings                                                                                                                        | Burn-in postprocess remains deferred; core V1 subtitle policy is unchanged                                           |
| Demo-E2E       | Fresh DB core/IPC checks and positive persisted timeline integration with explicitly synthetic test inputs                                                                                  | Actual Windows fresh DB UI → real media/audio → verified MP4 acceptance                                              |

## Run

Use repository-pinned Node 24.19.0 and pnpm 11.19.0 on Windows x64. Build with `pnpm ci:prepare`.
For an isolated desktop run, set `$env:DESKTOP_DEMO_FRESH_WORKSPACE='1'` and start `pnpm dev`. Every launch gets a new temporary user-data directory, printed as `DEMO_FRESH_WORKSPACE`; existing databases are preserved. Retain that directory for the CLI stages. The normal Windows user-data location remains unchanged when the flag is absent.

Open “视频 Demo”, enter 2–3 sentences, choose the route, generate the offline candidate, review, then explicitly confirm. Candidate text is not real AI output. Use `tools/demo-core/cli.mjs` for headless propose/inspect/separate explicit confirmation. See `tools/demo-media/README.md` and `tools/demo-render/README.md` for subsequent developer operations. These require actual authorities and files; they do not create a completed Demo from empty inputs. Use the existing runtime staging procedure and `DESKTOP_RENDER_DEV_RUNTIME_ROOT` for desktop development rendering.

## Verification

- Local full Vitest: 1562 passed / 7 skipped, 136 passing test files / 6 skipped. Initial environment failures were resolved by selecting installed Python 3.13.15 and reusing the existing locked Python quality-tool cache.
- Additional Node timeline/SRT tests: 7 passed. Their media and PCM bytes are explicitly synthetic unit/integration inputs, never acceptance evidence.
- Workspace packages/gateway build, desktop main/preload/renderer build and type checks passed. Full ESLint, source-cycle check and repository format check passed.
- CLI propose was executed against a new SQLite database and returned PROPOSED with no confirmed record. A trailing newline-only shot found by this smoke run was corrected and regression-tested.
- Runtime preflight actually returned `RENDER_RUNTIME_V2_AUTHORITY_INVALID`: current host is macOS; the approved runtime is Windows x64 and the examined staging path is absent.
- Local build host used Node 24.22.1 and pnpm 11.19.0; exact pinned Node/Windows verification remains outstanding.

## Critical path and actual blockers

1. Finish controlled Worker indexing/cache publishing and desktop media/audio import wiring.
2. Provide real local 2–3 shot materials and matching per-slot PCM16 WAV narration; none was provided in this chat or found in tracked repository content.
3. Stage the existing exact approved Windows x64 runtime on a Windows host. macOS cannot substitute for this approval identity.
4. Run fresh DB through actual human confirmation, real selection/narration, committed timeline and formal MP4 verification. Then optionally export SRT. No burned-in subtitle claim is made.

No MP4 was produced. Windows end-to-end acceptance is NOT RUN. Real paid Provider requests: 0. Real 30-case: NOT RUN. Old stacked PRs: no merge or mutation. Frozen V1 Render Policy/Receipt, approval records, C3C evaluator and historical evidence: unchanged.
