# Code G Render R0 Inventory and Contract Investigation

- Review date: 2026-09-10
- Developer platform: macOS
- Target product platform: Windows Desktop
- Frozen baseline: `36fce1bb446c10d1565d3614f2246257f35fa157`
- Branch: `code-g/render-r0-inventory`

This document is an inventory and proposal record only. No Render implementation, contract,
schema, migration, dependency, lockfile, CI, Electron packaging, IPC, UI, FFmpeg download, or
real FFmpeg execution is authorized or performed.

Status vocabulary used on every conclusion:

- **EXISTING**: present in production code or immutable repository authority at the frozen baseline.
- **MISSING**: required for Render but not implemented as production authority.
- **PROPOSED**: Code G recommendation for Brain1 review; not frozen.
- **REFERENCE_ONLY**: useful external design evidence, not adopted code or dependency.
- **BRAIN1_DECISION_REQUIRED**: policy or ownership must be frozen above Code G before implementation.

## 1. Project / Architecture Context

- **EXISTING** — The product is an Electron + React/TypeScript desktop application with SQLite,
  a controlled Python media sidecar, native media companions, and a lightweight provider backend.
- **EXISTING** — Desktop Main is the trusted process and SQLite single writer. The Renderer is UI
  only and runs with `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- **EXISTING** — Code C owns searchable/executable media truth, Code D owns final selection, and
  Code E owns planning and immutable Timeline versions.
- **EXISTING** — Code G's boundary is local deterministic execution of an already accepted
  Timeline. It does not own retrieval, selection, Timeline geometry, fallback choice, subtitle
  wording, narration creation, or Digital Human.
- **PROPOSED** — Render remains a Desktop Main service which consumes typed, hash-bound authority
  and invokes one approved native runtime by absolute verified path with `args: string[]` and
  `shell: false`.
- **EXISTING** — Production paths must use Node path APIs, Electron `process.resourcesPath` and
  `app.getPath(...)`; no developer-machine absolute path is an authority.

Primary architecture evidence:

- `docs/architecture/code-0/DESKTOP_ARCHITECTURE.md`
- `docs/architecture/code-0/LIGHT_AUTO_EDIT_ARCHITECTURE.md`
- `docs/architecture/code-0/TECH_STACK_DECISION.md`
- `docs/development/ARCHITECTURE_BOUNDARIES.md`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/src/preload/index.ts`

## 2. Frozen Baseline

- **EXISTING** — Before branch creation, `git status --short --branch` reported clean
  `main...origin/main`.
- **EXISTING** — `git fetch origin` completed and `git rev-parse origin/main` returned exactly
  `36fce1bb446c10d1565d3614f2246257f35fa157`.
- **EXISTING** — Local `HEAD` was the same SHA before creating
  `code-g/render-r0-inventory`.
- **EXISTING** — The review used the developer's existing clone, whose `origin` is
  `git@github.com:hed88798-dot/sbsb.git`; no second repository was created.
- **EXISTING** — No developer-machine absolute repository path is copied into a production
  contract, runtime locator, database authority, or immutable media identity.

## 3. Code G Ownership Boundary

- **EXISTING** — Render may execute `TimelinePhysicalSegmentV1` facts exactly as committed.
- **EXISTING** — Render may resolve current-machine paths from SQLite and validate file bytes.
- **PROPOSED** — Render owns execution-plan construction, deterministic operation ordering,
  approved-process lifecycle, progress, cancellation, temporary output, output validation, receipt,
  idempotency, and recovery.
- **EXISTING** — Render must fail closed instead of changing any asset, shot, revision, source range,
  timeline range, route, transition decision, or duration.
- **EXISTING** — `FALLBACK_REQUIRED` is a gap fact, not permission to generate or select media.
- **EXISTING** — Digital Human is an independent bounded context and is never an implicit fallback.
- **EXISTING** — Background music is not authorized, and Renderer must never supply raw filesystem
  paths, FFmpeg paths, filter graphs, codecs, or arbitrary command arguments.

## 4. Current Authority Chain

```text
Confirmed script/shot requirement
  -> NarrationTimingSnapshotV1 identity and timing facts
  -> Code C eligible/executable media truth
  -> Code D committed decision receipt
  -> Code E planning facts + duration policy + duration plan
  -> TimelinePlanRepository immutable version + commit receipt
  -> Desktop Main exact source resolution
  -> [MISSING] Render entry gate
  -> [MISSING] Render policy + execution plan
  -> [MISSING] approved FFmpeg runtime
  -> [MISSING] output verification + render receipt
```

- **EXISTING** — `TimelinePlanRepository` stores canonical JSON for the request, facts, duration
  policy, duration plan, and commit receipt. Reads recompute and verify all recorded hashes and
  exact stored bytes.
- **EXISTING** — Timeline versions are append-only at the database level; update and delete triggers
  reject mutation.
- **EXISTING** — `timeline_id`, `version`, `parent_version`, and optimistic parent checks provide
  linear version lineage and idempotent replay by `planning_request_id`.
- **MISSING** — No production service currently connects a committed Timeline to Render.

## 5. Timeline Renderable Facts

### 5.1 `CommittedTimelinePlanVersionV1`

| Field              | Status       | Render meaning                                                                                          |
| ------------------ | ------------ | ------------------------------------------------------------------------------------------------------- |
| `timeline_id`      | **EXISTING** | Stable Timeline identity.                                                                               |
| `version`          | **EXISTING** | Exact immutable version requested for execution.                                                        |
| `parent_version`   | **EXISTING** | Lineage only; not permission to substitute a child/latest version.                                      |
| `planning_request` | **EXISTING** | Confirmed shot plan, exact narration timing identity, committed D references, Timeline policy identity. |
| `planning_facts`   | **EXISTING** | Normalized authoritative slot, pause, selected material, shot bound, narration and duration facts.      |
| `duration_policy`  | **EXISTING** | E3 planning semantics; it is not an encoding/Render policy.                                             |
| `duration_plan`    | **EXISTING** | Physical segments and every non-real-material requirement.                                              |
| `commit_receipt`   | **EXISTING** | Binds Timeline/version/request/facts/policy/duration-plan hashes and commit time.                       |

### 5.2 `TimelinePhysicalSegmentV1`

| Field                                                                | Status       | Render meaning                                                                                  |
| -------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `segment_id`                                                         | **EXISTING** | Deterministic segment identity inside the duration plan.                                        |
| `kind`                                                               | **EXISTING** | Must be `REAL_MATERIAL`.                                                                        |
| `slot_ids`                                                           | **EXISTING** | One or more frozen slots covered by a merged physical segment.                                  |
| `visual_continuity_group_id`                                         | **EXISTING** | Upstream continuity fact; Render does not reinterpret it.                                       |
| `timeline_start_ms`, `timeline_end_ms`, `duration_ms`                | **EXISTING** | Exact output placement and duration.                                                            |
| `source_asset_id`, `source_shot_id`, `source_revision`               | **EXISTING** | Exact Code C media identity, not a fuzzy lookup.                                                |
| `source_start_ms`, `source_end_ms`                                   | **EXISTING** | Exact clip range; E3 enforces one-to-one source/timeline consumption.                           |
| `selection_request_id`, `decision_receipt_hash`, `selection_slot_id` | **EXISTING** | Per-segment Code D traceability.                                                                |
| `reason_codes`                                                       | **EXISTING** | Frozen E3 explanation (`DIRECT`, extension, stitch, pause coverage); not a new Render decision. |

### 5.3 Other duration-plan collections

- **EXISTING** — `segments` are the only currently materialized real media operations.
- **EXISTING** — `fallback_requirements` precisely identify gap intervals but carry no fallback
  artifact identity.
- **EXISTING** — `additional_selection_requirements` declare incomplete Code D work and therefore
  cannot be solved by Render.
- **EXISTING** — `unused_committed_selection_refs` are audit/accounting facts and must not be
  rendered or treated as alternatives.
- **EXISTING** — `execution_domain_intervals` define the exact expected coverage domain.
- **EXISTING** — `slot_transitions` explain E3 decisions; they do not authorize visual transitions
  such as fades, wipes, or overlap.

### R0-Q1 — Is the Timeline sufficient without new semantic reasoning?

- **EXISTING** — Yes for the semantic and temporal choice of every real-material segment. The
  combination of `duration_plan.segments`, `planning_facts`, the planning request, and the commit
  receipt gives Render enough information to avoid retrieval, selection, route inference,
  continuity inference, or duration planning.
- **MISSING** — A production Render-entry structural verifier does not yet cross-bind every segment
  to exactly one selected material fact and committed D identity. The current duration-plan
  validator strongly verifies interval geometry, exact coverage, and `duration_plan_hash`, while
  the repository binds that hash to `planning_facts_hash`; it does not independently recompute E3
  or compare every segment identity field against the selected material facts.

```text
GAP:
No dedicated segment -> planning fact -> committed D evidence cross-binding verifier at Render entry.

WHY_RENDER_NEEDS_IT:
Render must reject a self-hashed but identity-inconsistent input without trusting caller-supplied
segment fields or rerunning Timeline planning.

AUTHORITY_OWNER:
Brain1 must choose whether the binding is a Code E contract strengthening or a Code G entry-gate
structural validation. Code G must not change frozen E semantics in R0.
```

- **PROPOSED** — The check is structural, not semantic: find exactly one planning-fact material by
  `selection_request_id`; require receipt, asset, shot, revision and selection-slot equality; require
  the segment source range to lie within that material's frozen shot range; then verify the committed
  D evidence and exact Code C file.

## 6. Physical Source Resolution

### Existing primitive

- **EXISTING** — `MediaIndexRepository.assertExactShotExecutable(...)` accepts exact
  `asset_id`, `revision`, `shot_id`, and full shot `[start_ms, end_ms)`.
- **EXISTING** — It requires revision and shot states `READY`, exact shot geometry, at least one
  `PRESENT` location, a real regular file, and file bytes whose SHA-256 equals the historical
  revision's `file_hash`.
- **EXISTING** — It returns `sourcePath` (resolved current-machine fact) and `fileHash`.
- **EXISTING** — It does not require the revision to remain the active revision; an exact historical
  revision remains executable when its bytes and location are valid.
- **MISSING** — It reads the whole file synchronously and returns after verification; there is no
  Timeline-segment adapter, streaming hash, staging, file handle handoff, or protection against a
  change before FFmpeg opens the file.

### R0-Q3 — Recommended resolution flow

```text
Committed Timeline segment
  -> exact structural binding to planning-fact material and D receipt
  -> assertExactShotExecutable(full frozen shot bounds)
  -> verify segment source range is inside the exact shot
  -> ResolvedRenderSourceV1 (current-machine execution fact)
  -> pre-spawn revalidation or controlled staging
  -> FFmpeg
```

- **PROPOSED** — `ResolvedRenderSourceV1` field draft (no TypeScript contract created):

| Field                                                                | Classification                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `schema_version`                                                     | **PROPOSED** — contract version.                                                   |
| `segment_id`                                                         | **UPSTREAM_AUTHORITY** — exact segment binding.                                    |
| `asset_id`, `revision`, `shot_id`                                    | **UPSTREAM_AUTHORITY** — immutable business media identity.                        |
| `shot_start_ms`, `shot_end_ms`                                       | **UPSTREAM_AUTHORITY** — full exact shot geometry needed by the existing resolver. |
| `source_start_ms`, `source_end_ms`                                   | **UPSTREAM_AUTHORITY** — exact frozen trim.                                        |
| `timeline_start_ms`, `timeline_end_ms`                               | **UPSTREAM_AUTHORITY** — exact output placement.                                   |
| `selection_request_id`, `decision_receipt_hash`, `selection_slot_id` | **UPSTREAM_AUTHORITY** — D traceability.                                           |
| `resolved_source_path`                                               | **MAIN_RESOLVED_FACT** — current machine/install/time only.                        |
| `verified_file_hash`                                                 | **MAIN_RESOLVED_FACT** — must equal the revision hash.                             |
| `resolved_at`                                                        | **EXECUTION_DERIVED** — diagnostic time, excluded from logical identity.           |
| `staged_path`, `staged_file_hash`                                    | **CURRENTLY_MISSING** — only if Brain1 selects staging.                            |

- **EXISTING** — `resolved_source_path` must not be persisted as cross-machine business authority.
- **EXISTING** — Absolute path is never media identity and a matching path never permits skipping
  hash validation.

### File/location outcomes

| Situation                                                                             | Status       | Recommended outcome                                                                                                                      |
| ------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| File moved; a trusted `PRESENT` location for the same asset and identical hash exists | **PROPOSED** | `SAFE_RE_RESOLVE`; path may change without changing business identity.                                                                   |
| File moved but SQLite location is stale                                               | **EXISTING** | Current resolver fails closed. An authorized relink/inventory flow outside Render may update SQLite, then retry. No disk scan by Render. |
| One `PRESENT` location is stale but another exact location passes                     | **EXISTING** | Resolver may use the first ordered location that passes exact hash validation.                                                           |
| All locations stale/missing                                                           | **EXISTING** | `FAIL_CLOSED` with exact media unavailable.                                                                                              |
| Hash mismatch at same path                                                            | **EXISTING** | `FAIL_CLOSED`; never accept path equality.                                                                                               |
| Revision or shot not `READY`, or full shot range differs                              | **EXISTING** | `FAIL_CLOSED`; no active-revision substitution.                                                                                          |
| File changes after plan creation                                                      | **MISSING**  | TOCTOU policy required; do not spawn from a stale verification result.                                                                   |

### TOCTOU analysis

- **EXISTING** — Risk identified: verify -> time passes -> spawn -> FFmpeg opens the pathname.

Option 1 — hash again immediately before spawn:

- **PROPOSED** — Security properties: detects changes before the second hash completes, but does not
  close the final second-hash-to-open race.
- **PROPOSED** — Replay properties: cheap storage-wise and re-resolves moved files, but an original
  may still change during execution.
- **PROPOSED** — Performance cost: two full reads of every distinct source per attempt; large-file
  cost is material and synchronous hashing should not block Main's event loop.
- **PROPOSED** — Windows portability: feasible, but ordinary reads do not guarantee replacement is
  prevented; sharing modes differ from POSIX.
- **PROPOSED** — Recovery complexity: low; retry re-resolves and rehashes.

Option 2 — copy/fix each exact source into a controlled per-plan staging directory:

- **PROPOSED** — Security properties: FFmpeg reads controlled staged bytes; verify the staged file
  after copy. This materially narrows the authority surface and prevents later changes to the
  original path from affecting execution. The copy itself must detect source change during copy,
  for example by comparing expected hash over copied bytes and failing closed.
- **PROPOSED** — Replay properties: stable retry input can be reused only when staged bytes, plan
  identity, and manifest/hash all match.
- **PROPOSED** — Performance cost: one full read plus one full write and potentially large disk use;
  deduplicate per exact file hash within one job.
- **PROPOSED** — Windows portability: strong because FFmpeg need not hold the user's original file;
  staging must account for antivirus locks, sharing violations, long paths, and rename/delete
  retries.
- **PROPOSED** — Recovery complexity: medium; incomplete copies need a manifest/state marker and
  cleanup, while verified stage artifacts can be retained under policy.

Option 3 — hold an opened descriptor/handle and make FFmpeg consume that object:

- **REFERENCE_ONLY** — Strong on some POSIX designs, but portable descriptor inheritance and FFmpeg
  pathname semantics are awkward on Windows. It introduces platform-specific process/handle
  behavior and is not recommended for V1 without dedicated proof.

| TOCTOU event                                     | Proposed classification                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| File disappears after plan creation              | **PROPOSED** — `SAFE_RE_RESOLVE` against SQLite, else `FAIL_CLOSED`.                |
| File is replaced or content changes at same path | **PROPOSED** — `FAIL_CLOSED`; never update expected hash in Render.                 |
| File moves after plan creation                   | **PROPOSED** — `SAFE_RE_RESOLVE` only through trusted locations and exact hash.     |
| Location row becomes stale                       | **PROPOSED** — `FAIL_CLOSED` for this attempt; authorized relink then `SAFE_RETRY`. |
| Staged copy is corrupted                         | **PROPOSED** — `DELETE_TEMP`, then `RESTAGE`; repeated mismatch fails closed.       |
| App crashes during staging                       | **PROPOSED** — unverified stage is `DELETE_TEMP`; retry is safe.                    |

```text
TOCTOU_RISK_IDENTIFIED: YES
TOCTOU_OPTIONS_ANALYZED: YES
IMPLEMENTATION: NO
```

- **BRAIN1_DECISION_REQUIRED** — Select pre-spawn rehash only, verified staging, or another proven
  cross-platform strategy. Code G recommends verified staging for final export, with an explicit
  disk-space policy, because it gives the clearest Windows and recovery semantics.

## 7. Narration Audio Authority

### R0-Q4

- **EXISTING** — `NarrationTimingSnapshotV1` contains `narration_audio_id`,
  `narration_audio_hash`, `total_duration_ms`, ordered `slot_timings`, and explicit
  `pause_intervals`. Its hash is bound through planning request, planning facts, Timeline plan, and
  commit receipt.
- **EXISTING** — The gateway/provider schemas can describe a TTS request and generic returned audio
  artifacts, but those are not a Desktop narration artifact authority and are not wired into Code E.
- **MISSING** — There is no production Desktop repository/table/service mapping
  `narration_audio_id -> exact local regular file -> SHA-256 verification`.
- **MISSING** — No narration file path, media metadata, persistence lifecycle, or relink/recovery
  contract exists.
- **MISSING** — Test values such as `e6_audio` and `sha256('e6-audio')` are identifiers/fixtures,
  not playable audio artifacts.

```text
NARRATION_AUDIO_IDENTITY: EXISTS
NARRATION_AUDIO_FILE_RESOLVER: NOT_IMPLEMENTED
NARRATION_AUDIO_HASH_VERIFICATION: NOT_IMPLEMENTED
```

- **PROPOSED** — An upstream/Main-owned `NarrationAudioArtifactV1` should bind audio ID, exact hash,
  duration, codec/container facts, sample rate/channels, source provenance, and trusted local
  location(s). Render should only consume the verified artifact and must not synthesize speech.
- **BRAIN1_DECISION_REQUIRED** — Owner and persistence contract for narration audio; allowed
  duration tolerance between artifact and timing snapshot; whether timing snapshot or verified audio
  duration wins on mismatch. Code G recommends fail closed on mismatch, not retiming the Timeline.

## 8. Subtitle Authority

### R0-Q5

- **MISSING** — No production subtitle/caption contract, repository, SRT/ASS/VTT artifact, word
  timing, sentence timing, style policy, font artifact, or burn-in implementation exists.
- **MISSING** — `native/whisper/README.md` is a future boundary placeholder; no whisper runtime is
  distributed. Architecture documents discussing whisper/subtitles are design intent, not current
  production authority.

| Question                     | Current answer                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Who decides subtitle text?   | **MISSING** — no frozen contract. It must be upstream textual authority; Render may not edit or transcribe it.   |
| Who decides subtitle timing? | **MISSING** — slot timing is not a subtitle cue contract and cannot be silently treated as word/sentence timing. |
| Who decides subtitle style?  | **MISSING** — no Render policy or approved font/style authority.                                                 |
| How is it burned in?         | **MISSING** — no FFmpeg filter/operation implementation or font packaging.                                       |

- **PROPOSED** — Subtitle input should be an exact immutable cue artifact or typed cue list with
  its own ID/version/hash, source-text binding, integer-ms intervals, and an independently versioned
  style/font identity. Render validates and burns it exactly; optional subtitle mode must be frozen
  by Render Policy.
- **EXISTING** — Render must never listen to narration again to replace/correct upstream text.

```text
SUBTITLE_AUTHORITY: NOT_IMPLEMENTED
```

## 9. Fallback Authority

### R0-Q6

- **EXISTING** — `TimelineFallbackRequirementV1` records exact interval, duration, reason, route/
  continuity context where applicable, and committed Code D `NO_MATCH` identity where applicable.
- **MISSING** — No contract, table, repository, or service maps a fallback requirement to an exact
  media artifact/revision/hash/range.
- **EXISTING** — E3.1 converting an additional selection gap to `FALLBACK_REQUIRED` after committed
  Code D `NO_MATCH` still does not materialize a fallback clip.

```text
FALLBACK_SOURCE_AUTHORITY: NOT_IMPLEMENTED
DIGITAL_HUMAN_ASSUMED_AS_FALLBACK: NO
```

- **PROPOSED Option A** — An upstream Fallback Resolver binds every requirement to a deterministic,
  exact, hash-verified artifact and interval before Render. Render only validates and executes it.
- **PROPOSED Option B** — Current V1 Render accepts only fallback-free Timeline versions.
- **PROPOSED** — Until Option A exists, Option B is the only fail-closed executable rule.
- **BRAIN1_DECISION_REQUIRED** — Freeze the fallback resolver owner/contract and decide whether R1
  is deliberately fallback-free.

## 10. FFprobe Runtime Boundary

- **EXISTING** — FFprobe and FFmpeg are distinct executables and approval subjects.
- **EXISTING** — `resolveBundledFfprobe(...)` has fixed Linux/Windows locators under a supplied
  resources root, root-confinement checks, regular-file and symlink rejection, and optional exact
  entrypoint SHA-256 verification. There is no PATH lookup.
- **EXISTING** — Code C's worker receives an explicit path and invokes it as an argument array with
  `shell=False`, timeout, output-size limits, and controlled working directory.
- **EXISTING** — Exact Linux and Windows ffprobe companions built from FFmpeg 9.0.1 have Code F
  artifact approvals, exact entrypoint hashes, runtime-closure evidence, LGPL obligation records,
  current-distribution SBOM/NOTICE binding, and a PASS vulnerability review.
- **EXISTING** — Approved entrypoint SHA-256 values are:
  Linux `59f3a6208e2f5754c4d3c75525a7b50be673fff13994e5d98f8e6a47e68f6097`;
  Windows `2ed7798daa057ee557bca8d1fe72a0f2c48109369dc0e5a7672b31c08565fc7c`.
- **MISSING** — Desktop `electron-builder.yml` does not include `runtime/ffprobe`; Desktop Main does
  not call the locator or wire it to a packaged worker. Therefore approval evidence is not the same
  as Electron integration/packaging.
- **MISSING** — No macOS ffprobe locator or approved macOS companion exists.
- **PROPOSED** — Reuse the generic companion manifest, fixed-locator, root-confinement, full
  member-hash, loader-closure, no-PATH, decoy-DLL, packaged-smoke, SBOM/NOTICE, and vulnerability
  patterns for FFmpeg. Do not reuse ffprobe's actual profile or claim its approval covers FFmpeg.

## 11. FFmpeg Runtime Boundary

### R0-Q7

```text
FFMPEG_SOURCE_OR_BUILD_RECIPE:
MISSING. The FFmpeg 9.0.1 release/source hash is an EXISTING source input, but the approved ffprobe
Build Profile explicitly disables the ffmpeg program. Render needs a separate capability profile,
platform recipes, environment descriptors, artifact manifests and Code F approval.

FFMPEG_BINARY:
NOT_IMPLEMENTED. native/ffmpeg/README.md is a three-line placeholder; no render executable exists.

FFMPEG_LICENSE_REVIEW:
MISSING for an exact render binary. Existing ffprobe LGPL records do not approve a different
program/configuration/member set. Architecture intent forbids GPL/nonfree and libx264/libx265.

FFMPEG_VULNERABILITY_REVIEW:
MISSING for an exact render binary. The current review is scoped to exact ffprobe companions and
their demux/probe reachability, not encoders, muxers, filters, subtitle/font paths, or ffmpeg CLI.

FFMPEG_HASH_AUTHORITY:
MISSING. No approved ffmpeg companion identity, manifest, member-set digest, or entrypoint hash.

FFMPEG_RUNTIME_LOCATOR:
NOT_IMPLEMENTED. FFPROBE_LOCATORS does not imply an FFmpeg locator.

FFMPEG_ELECTRON_PACKAGING:
NOT_IMPLEMENTED. No ffmpeg extraResource, unpack rule, runtime wiring, or packaged verification.

FFMPEG_WINDOWS_VALIDATION:
NOT_RUN.

FFMPEG_MAC_VALIDATION:
NOT_RUN; no approved macOS runtime is defined.

FFMPEG_LINUX_VALIDATION:
NOT_RUN for the render executable. Existing Linux evidence is ffprobe-only.
```

### Required capability profile for Code F intake

- **PROPOSED** — Programs/protocols: enable only `ffmpeg` and required local `file`/safe pipe-like
  progress behavior; disable network, device capture, server/listener behavior, and undeclared
  protocols.
- **PROPOSED** — Input: demux/decode the currently authorized local media universe and narration/
  subtitle artifacts; malformed input must fail closed.
- **PROPOSED** — Video operations: accurate trim, timestamp reset, rotation application, scale,
  crop/pad, SAR normalization, fps/CFR conversion, deterministic concat/filter graph, pixel-format
  conversion, and selected H.264 encoder capability.
- **PROPOSED** — Audio operations: narration decode, resample, channel layout normalization, exact
  trim/pad policy, optional policy-controlled mix, AAC encode, and MP4 mux.
- **PROPOSED** — Subtitle operations only if a subtitle contract is frozen: cue parsing/rendering,
  approved font discovery, and deterministic style/filter availability.
- **PROPOSED** — Control/verification: machine-readable progress (`-progress` style channel),
  predictable exit codes, overwrite prohibition/explicit behavior, bounded logs, and capability/
  version probes.
- **BRAIN1_DECISION_REQUIRED** — Exact input capability breadth, encoder policy/fallback behavior,
  subtitle support in R1, and macOS development companion scope.
- **EXISTING** — Code F, not Code G, owns artifact intake, binary provenance, license/vulnerability
  approval, notices, and distribution authorization.

## 12. Electron / Windows Packaging

- **EXISTING** — Electron Builder 26.15.3 is already used; the Windows target is NSIS and ASAR is
  enabled. Native `.node` modules are unpacked and SQLite migrations are copied via
  `extraResources`.
- **MISSING** — Neither ffprobe nor FFmpeg runtime trees are present in `extraResources`.
- **MISSING** — There is no platform/architecture FFmpeg locator, packaged manifest loader, member
  hash verifier, startup capability probe, or render packaged smoke.
- **PROPOSED** — A future approved companion should live outside ASAR under a fixed
  `process.resourcesPath`-relative locator, with the executable and every DLL in an approved
  app-local bundle. Locator selection must use `process.platform` and `process.arch` without PATH,
  CWD, registry, shell, or user installation discovery.
- **PROPOSED** — Windows smoke must run the packaged application/runtime and verify exact manifest,
  hashes, DLL load locations, no decoy DLL consumption, FFmpeg version/capabilities, a real minimal
  Render, cancellation, output probe, and cleanup.
- **EXISTING** — No macOS result can be reported as Windows PASS.

```text
WINDOWS_RENDER_RUNTIME: NOT_RUN
```

## 13. FFmpeg Supply Chain / Licensing

- **EXISTING** — Code 0's design intent is an audited, source-built shared FFmpeg with GPL/nonfree
  disabled, no libx264/libx265, Windows `h264_mf` preference, AAC review, and LGPL obligations.
- **EXISTING** — FFmpeg upstream source is mixed-license depending on configuration; exact build
  configuration and runtime closure determine the distributed license obligations.
- **EXISTING** — The repository's ffprobe intake proves a reusable governance method: exact release
  and source hash, semantic capability profile, platform build recipe/environment/context, companion
  manifest, exact member hashes, loader traces, license coverage/obligation records, SBOM/NOTICE,
  vulnerability review, retained artifact, and final distribution binding.
- **MISSING** — No Render-specific Build Profile freezes muxers, decoders, encoders, filters,
  protocols, subtitle/font support, or `h264_mf` availability.
- **MISSING** — No exact FFmpeg render artifact has been built, retained, approved, licensed,
  vulnerability-reviewed, or distribution-bound.
- **PROPOSED** — Code G supplies only the required capability/execution profile; Code F approves the
  exact artifacts. R1 must consume only the approved identity and fail closed if a capability or hash
  differs.
- **EXISTING** — No GitHub reference binary or npm-downloaded binary is approved by this review.

## 14. GitHub Reference Review

- **REFERENCE_ONLY** — Snapshot date: 2026-09-10. Star counts are approximate point-in-time
  discovery signals, not adoption criteria. Maintenance considers repository activity, releases,
  tests/CI, Windows posture, and known archive state. No project was cloned or installed.

### 14.1 FFmpeg/FFmpeg

```text
Project: FFmpeg
GitHub: https://github.com/FFmpeg/FFmpeg (official upstream mirror)
Stars: ~64.1k
License: Mainly LGPL; optional components make builds GPL (configuration-specific)
Maintenance: Very active; upstream mirror updated on review date; extensive FATE tests
Relevant Design: Native demux/decode/filter/encode/mux, progress reporting, concat, trim, scaling,
                 audio resampling/mixing, subtitle filters, ffprobe verification
Useful Idea: Define a minimal capability profile and use machine-readable progress/status;
             test exact commands against the approved build
What NOT To Copy: Default/ambient builds, enabled-network surface, GPL/nonfree components,
                  unbounded free-form command construction
Compatibility With Code 0: High when source-built and governed; this is the intended low-level engine
Commercial Risk: Exact configuration, patents, LGPL replacement/source/notice obligations and every
                 linked member require Code F review
Recommendation: POSSIBLE_COMPONENT, pending separate approved FFmpeg artifact
```

### 14.2 electron-userland/electron-builder

```text
Project: electron-builder
GitHub: https://github.com/electron-userland/electron-builder
Stars: ~14.7k
License: MIT
Maintenance: Active; v26.16.1 released 2026-09-07; repository has CI/tests and Windows targets
Relevant Design: extraResources, ASAR boundaries, NSIS packaging, native dependency packaging
Useful Idea: Put approved companion bundles outside ASAR with deterministic platform layout and
             verify them in packaged smoke
What NOT To Copy: Auto-downloaded third-party media binary as runtime authority; silent defaults
Compatibility With Code 0: High; already used by the repository
Commercial Risk: Low for tool code, but it does not license or approve bundled FFmpeg artifacts
Recommendation: REFERENCE_ONLY (existing build tool; use current pinned version/process)
```

### 14.3 sindresorhus/execa

```text
Project: Execa
GitHub: https://github.com/sindresorhus/execa
Stars: ~7.6k
License: MIT
Maintenance: Active; v10.0.1 released 2026-07-31; CI and Windows-specific behavior documented
Relevant Design: argument-array process execution, streams, detailed errors, timeout/termination,
                 improved Windows subprocess behavior
Useful Idea: Test cancellation, bounded output, error normalization, and Windows process lifecycle
What NOT To Copy: PATH/local-binary lookup, template/shell scripting, or automatic executable choice
Compatibility With Code 0: Conceptually high; Node child_process may remain sufficient
Commercial Risk: Low code-license risk; dependency intake still required if adopted
Recommendation: REFERENCE_ONLY; do not add dependency in R0
```

### 14.4 fluent-ffmpeg/node-fluent-ffmpeg

```text
Project: fluent-ffmpeg
GitHub: https://github.com/fluent-ffmpeg/node-fluent-ffmpeg
Stars: ~8.2k
License: MIT
Maintenance: Archived 2025-05-22; maintainer announced phase-out; no current release
Relevant Design: Historical command construction, capability checks, progress/error events
Useful Idea: Capability preflight and explicit error/progress handling are still valuable test ideas
What NOT To Copy: Wrapper API, ambient FFmpeg path discovery, command abstraction, dependency itself
Compatibility With Code 0: Partial idea-level compatibility; maintenance is unacceptable
Commercial Risk: Low MIT code risk, high lifecycle/security/compatibility maintenance risk
Recommendation: REJECT_MAINTENANCE
```

### 14.5 eugeneware/ffmpeg-static

```text
Project: ffmpeg-static
GitHub: https://github.com/eugeneware/ffmpeg-static
Stars: ~1.4k
License: GPL-3.0 repository/package; binaries sourced from multiple third-party build providers
Maintenance: Active enough (last push 2026-03-21; b6.1.1 release 2025-11-14; CI/tests present)
Relevant Design: Cross-platform npm installation and platform binary selection
Useful Idea: Platform/architecture layout and installation failure tests only
What NOT To Copy: Static third-party binaries, install-time downloads, provider-dependent provenance,
                  GPL distribution, automatic binary selection
Compatibility With Code 0: Conflicts with source-built auditable shared LGPL companion policy
Commercial Risk: High; GPL and per-provider binary provenance/build configuration
Recommendation: REJECT_LICENSE and REJECT_ARCHITECTURE_CONFLICT
```

### 14.6 remotion-dev/remotion

```text
Project: Remotion
GitHub: https://github.com/remotion-dev/remotion
Stars: ~58.8k
License: Special/custom commercial license; company license required in some cases
Maintenance: Very active; v4.0.523 released 2026-09-09; large test/CI/codebase and documentation
Relevant Design: Declarative frame-based compositions, deterministic props, render retries,
                 captions, audio, render progress, artifact-oriented tests
Useful Idea: Separate immutable composition input from machine execution; frame-domain tests and
             explicit render metadata/receipts
What NOT To Copy: React/Chromium render engine, cloud/Lambda architecture, new Timeline authority,
                  framework dependency
Compatibility With Code 0: Architecture conflict; current project requires direct approved FFmpeg
Commercial Risk: Special license requires separate commercial review
Recommendation: REFERENCE_ONLY for test/identity ideas; REJECT_ARCHITECTURE_CONFLICT as engine
```

### 14.7 ffmpegwasm/ffmpeg.wasm

```text
Project: ffmpeg.wasm
GitHub: https://github.com/ffmpegwasm/ffmpeg.wasm
Stars: ~17.8k
License: MIT wrapper; underlying FFmpeg build still has configuration-specific obligations
Maintenance: Maintained; last push 2026-02-01; v12.15 released 2025-01-07; CI/tests present
Relevant Design: Isolated browser/WASM media execution and progress events
Useful Idea: Narrow capability boundary and structured progress/cancel behavior
What NOT To Copy: Browser/WASM execution, large in-memory virtual filesystem, Renderer authority,
                  bundled build without independent artifact review
Compatibility With Code 0: Conflicts with Desktop Main native-runtime boundary and V1 performance
Commercial Risk: Wrapper license does not resolve the embedded FFmpeg build/license
Recommendation: REJECT_ARCHITECTURE_CONFLICT
```

```text
REFERENCE_PROJECTS_REVIEWED: 7
ARCHITECTURE_CONFLICTING_REFERENCE_ADOPTED: NO
UNAPPROVED_LICENSE_DEPENDENCY_ADOPTED: NO
```

## 15. Proposed Render Input Contract

- **PROPOSED** — Code G should accept only a narrow `RenderAcceptedTimelineRequestV1` carrying
  `timeline_id`, exact `timeline_version`, expected `timeline_commit_receipt_hash`, and an approved
  `render_policy_id/version/hash`. The request must not carry Timeline or media overrides.
- **PROPOSED** — Desktop Main loads the exact committed version from SQLite and independently
  verifies its receipt/hash chain. A caller-provided object is not authority.
- **PROPOSED** — Main then resolves exact media/audio/fallback/subtitle identities and constructs the
  execution plan. Renderer receives only safe job/progress/result DTOs.
- **MISSING** — No Render input contract exists today; R0 does not create one.

Forbidden request fields remain:

```text
asset/shot/revision override
source or timeline range override
sourcePath/output arbitrary path
fallback media
Timeline duration
codec or raw FFmpeg args
filter_complex
native executable path
```

## 16. Proposed Render Entry Gate

### R0-Q2 — Which committed Timeline is renderable?

- **EXISTING** — `COMMITTED_TIMELINE != RENDERABLE_TIMELINE`. E4 commit proves valid Timeline
  planning authority; it does not prove all execution prerequisites.
- **PROPOSED** — Any explicitly accepted immutable version can be replayed if the request binds its
  exact version and receipt hash and all current prerequisites pass. Requiring only latest would
  weaken historical reproducibility; however an implicit “render latest” UI operation must resolve
  and pin a version before acceptance.
- **BRAIN1_DECISION_REQUIRED** — Whether product UX restricts normal export to latest. Code G
  recommends not making “latest” part of low-level executability.
- **PROPOSED** — `additional_selection_requirements.length > 0` is always `NOT_RENDERABLE`.
  No historical contract conflict was found: E5 deliberately commits requirement-bearing versions,
  and continuation creates a child rather than asking Render to resolve them.
- **PROPOSED** — A Timeline with fallbacks is renderable only when every exact requirement has an
  externally resolved, trusted, hash-bound fallback artifact. Because that authority is currently
  missing, current V1 implementation entry should accept only fallback-free versions.

Proposed ordered gate:

```text
1. Load exact committed timeline_id/version from SQLite.
2. Verify canonical stored bytes, request/facts/policy/plan hashes, version lineage and commit receipt.
3. Require requested receipt hash == stored receipt hash.
4. Structurally cross-bind every segment to planning facts and committed Code D evidence.
5. Require additional_selection_requirements.length == 0.
6. Require fallback_requirements.length == 0 until a frozen exact fallback-source authority exists;
   later require one exact trusted resolution for every requirement.
7. Require exact source resolution and hash verification for every distinct physical source.
8. Require exact narration audio artifact resolution/hash/duration verification.
9. If subtitle mode is enabled, require exact subtitle and font/style authority.
10. Require an approved, self-consistent RenderPolicyV1.
11. Require approved FFmpeg/ffprobe runtime manifests, hashes, capabilities and platform support.
12. Require safe output target, sufficient staging/output space, and no active conflicting job.
13. Persist the exact plan/snapshot before starting FFmpeg.
```

- **PROPOSED** — Any failure is fail closed and produces no success artifact.
- **EXISTING** — A Timeline commit never automatically starts Render.

```text
RENDER_GATE_REJECT_UNRESOLVED_ADDITIONAL_SELECTION: RECOMMENDED
FALLBACK_FREE_CURRENT_V1_RENDER: RECOMMENDED
TIMELINE_RENDER_ENTRY_GATE: BRAIN1_DECISION_REQUIRED
```

## 17. Proposed `RenderPolicyV1`

- **MISSING** — No production authority currently freezes canvas, fps, frame mapping, codec,
  encoder, pixel format, rate control, audio profile, normalization, source-audio treatment,
  subtitle style, or container settings.
- **EXISTING** — Code 0 documents a 9:16 1080x1920/30fps baseline and Windows `h264_mf` direction,
  but those documents contain proposed design intent and do not form a current Render contract.

Proposed versioned/hash-bound fields:

| Group        | Fields                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity     | `schema_version`, `policy_id`, `policy_version`, `policy_hash`                                                                                          |
| Timebase     | output fps rational, ms-to-frame mapping/rounding, end-duration tolerance, CFR policy                                                                   |
| Canvas       | width, height, SAR, display aspect, background color                                                                                                    |
| Visual fit   | rotation policy, scale algorithm, `FIT/CROP/PAD`, crop authority, odd-dimension policy                                                                  |
| Video encode | codec/profile/level, ordered approved encoder IDs, no-silent-fallback rule, pixel format, color metadata, rate-control mode/values, GOP/keyframe policy |
| Audio        | narration role, source-video audio `DROP/KEEP/MIX`, codec, sample rate, channels/layout, bitrate, trim/pad/mismatch policy                              |
| Subtitle     | `OFF/BURN_IN`, cue contract version, style ID/hash, exact font artifact IDs/hashes, safe-area/margin policy                                             |
| Container    | MP4, fast-start/metadata policy, stream ordering, timestamp policy                                                                                      |
| Execution    | log/output bounds, progress heartbeat, hang timeout, graceful/forced cancellation deadlines                                                             |
| Verification | required ffprobe assertions and duration/frame tolerances                                                                                               |

Proposed defaults, not frozen requirements:

```text
canvas: 1080x1920
fps: 30/1 CFR
container: MP4
video: H.264 via an approved platform encoder; Windows candidate h264_mf
pixel format: yuv420p when supported by the approved encoder/profile
audio: AAC, 48 kHz, 2 channels (or a separately approved mono policy)
source video audio: DROP while narration is the sole primary audio authority
subtitles: OFF until cue/style/font authority exists
visual fit: deterministic scale + pad/crop only; never alter Timeline duration
```

- **BRAIN1_DECISION_REQUIRED** — Every proposed default above, especially encoder portability,
  frame rounding, source audio, crop ownership, subtitle scope, and duration tolerances.

## 18. Proposed `RenderExecutionPlanV1`

- **MISSING** — No production execution-plan contract exists. This is a field/classification draft
  only and no hash schema is frozen.

| Candidate field                   | Classification                            | Notes                                                                                              |
| --------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `schema_version`, `plan_id`       | **EXECUTION_DERIVED**                     | Versioned plan envelope/identity.                                                                  |
| `timeline_id`, `timeline_version` | **UPSTREAM_AUTHORITY**                    | Exact committed version.                                                                           |
| `timeline_commit_receipt_hash`    | **UPSTREAM_AUTHORITY**                    | Exact E4 receipt.                                                                                  |
| `duration_plan_hash`              | **UPSTREAM_AUTHORITY**                    | Exact E3 physical plan.                                                                            |
| `render_policy_id/version/hash`   | **RENDER_POLICY**                         | No mutable defaults at execution.                                                                  |
| `resolved_sources[]`              | **MAIN_RESOLVED_FACT**                    | Exact segment/media/hash and current path or staging fact.                                         |
| `narration_audio_ref`             | **CURRENTLY_MISSING**                     | Exact ID/hash/path/metadata required.                                                              |
| `fallback_sources[]`              | **CURRENTLY_MISSING**                     | Empty until upstream authority exists.                                                             |
| `subtitle_ref`, `subtitle_mode`   | **CURRENTLY_MISSING** / **RENDER_POLICY** | Cue/style/font identity, never raw UI text.                                                        |
| `video_output_profile`            | **RENDER_POLICY**                         | Fully explicit normalized video settings.                                                          |
| `audio_output_profile`            | **RENDER_POLICY**                         | Fully explicit audio composition/encode settings.                                                  |
| `output_target`                   | **MAIN_RESOLVED_FACT**                    | Validated controlled target; not a business media identity.                                        |
| `operations[]`                    | **EXECUTION_DERIVED**                     | Deterministically ordered typed trim/normalize/concat/audio/subtitle/mux operations. No raw shell. |
| `runtime_identity`                | **MAIN_RESOLVED_FACT**                    | Exact approved FFmpeg/ffprobe companion and capability identities.                                 |
| `logical_render_hash`             | **EXECUTION_DERIVED**                     | Proposed portable plan identity excluding machine paths.                                           |
| `execution_snapshot_hash`         | **EXECUTION_DERIVED**                     | Proposed machine attempt identity including resolved/staged paths and runtime artifact identity.   |
| `execution_plan_hash`             | **BRAIN1_DECISION_REQUIRED**              | Decide whether one hash or the two-level model is frozen.                                          |

### Determinism boundary

- **PROPOSED** — Same committed Timeline bytes + same immutable source/audio/fallback/subtitle
  identities + same Render Policy must yield the same logical operation plan and logical hash.
- **PROPOSED** — Same logical plan + same machine-resolved source bytes + same approved runtime
  identity + same output/staging semantics must yield the same machine execution snapshot.
- **EXISTING** — A Mac path and Windows path for the same verified asset do not create different
  business media identities.
- **PROPOSED** — Exclude absolute source/output/staging paths, timestamps, PID, job ID, and progress
  from the portable logical hash. Include asset/revision/shot, full and trimmed ranges, verified file
  hash, Timeline/receipt/policy hashes, audio/fallback/subtitle hashes, typed operations, and required
  runtime capability-profile identity.
- **PROPOSED** — Include normalized current-machine paths, platform/architecture, exact companion
  and member identities, staging hashes, and logical hash in a separate execution snapshot hash.
- **PROPOSED** — Security effect: paths remain diagnostics/execution facts while hashes remain
  authority; snapshot tampering or path swapping is detectable.
- **PROPOSED** — Recovery effect: a logical plan can safely re-resolve after a move or cross-machine
  replay, while a machine snapshot may only be reused when all exact facts revalidate.
- **BRAIN1_DECISION_REQUIRED** — Freeze the hash boundary and canonical serialization.

```text
RECOMMENDED_HASH_BOUNDARY:
Two identities: portable logical_render_hash plus machine execution_snapshot_hash.

WHY:
It preserves cross-machine business/replay identity without hiding the exact local paths/runtime
actually used by one attempt.

CROSS_MACHINE_EFFECT:
Logical identity can remain equal when verified bytes and policy are equal; machine snapshot differs.

SECURITY_EFFECT:
Neither path equality nor logical identity bypasses per-attempt path containment and file hash checks.

RECOVERY_EFFECT:
Re-resolution/restaging can create a new machine snapshot under the same logical render identity.
```

- **EXISTING** — Execution-plan determinism does not guarantee byte-identical MP4 across operating
  systems, FFmpeg builds, hardware encoders, drivers, thread schedules, or metadata defaults.
- **PROPOSED** — Byte identity may be tested within one exact approved runtime/profile when useful,
  but cross-environment byte identity is not a V1 requirement. Semantic/profile verification and
  output hash receipts are required instead.

## 19. Media Normalization

| Input condition           | Current guarantee                                                                                                  | Proposed Render behavior                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Resolution                | **EXISTING** — positive width/height recorded by Code C                                                            | **PROPOSED** — re-probe exact bytes; deterministic scale/crop/pad to policy canvas.                                    |
| FPS                       | **EXISTING** — positive numeric value recorded, but worker substitutes 25 when avg rate is unavailable             | **PROPOSED** — ffprobe exact stream; normalize VFR/CFR to policy fps without changing Timeline duration.               |
| Codec/container           | **MISSING** — not persisted in media authority                                                                     | **PROPOSED** — inspect with approved ffprobe; decode if approved build supports it, else fail closed.                  |
| Pixel format/color        | **MISSING** — not persisted                                                                                        | **PROPOSED** — normalize explicitly; freeze color metadata/range policy.                                               |
| SAR/DAR                   | **MISSING** — not persisted                                                                                        | **BRAIN1_DECISION_REQUIRED** — freeze square-pixel/display-aspect behavior, then normalize.                            |
| Rotation                  | **EXISTING** — integer metadata recorded                                                                           | **PROPOSED** — validate/re-probe and apply deterministic orientation before fit; clear/normalize output metadata.      |
| Odd dimensions            | **MISSING** — accepted by index                                                                                    | **PROPOSED** — deterministic pad/crop to encoder-valid dimensions; never alter time.                                   |
| Missing source audio      | **EXISTING** — permitted by media index                                                                            | **PROPOSED** — acceptable if policy drops source audio and exact narration exists.                                     |
| Source audio present      | **EXISTING** — probe profile can observe it, but DB does not persist it                                            | **BRAIN1_DECISION_REQUIRED** — `DROP/KEEP/MIX`; default proposal is `DROP`.                                            |
| Corrupt stream/range      | **EXISTING** — Code C probed and decoded selected keyframes, but this does not guarantee every future Render frame | **PROPOSED** — fail closed on probe/decode/filter/encode error; do not substitute.                                     |
| Very short positive range | **EXISTING** — Timeline permits integer-ms positive intervals                                                      | **BRAIN1_DECISION_REQUIRED** — frame mapping/minimum representable duration; never extend or shrink Timeline silently. |

- **PROPOSED** — No normalization may change `timeline_start_ms`, `timeline_end_ms`, segment order,
  source range, or total intended duration. If the frozen millisecond geometry cannot be represented
  under the frozen frame policy/tolerance, Render fails closed.
- **PROPOSED** — All implicit FFmpeg defaults that affect output must become policy fields or exact
  approved-runtime invariants.

## 20. Audio Composition

- **EXISTING** — Code E uses narration timing as the master clock and binds narration ID/hash and
  `total_duration_ms`.
- **MISSING** — The actual narration file authority and audio composition policy are absent, so no
  current production Render can truthfully mux narration.
- **PROPOSED** — Narration is the sole primary V1 audio authority after exact file/hash/duration
  resolution.
- **BRAIN1_DECISION_REQUIRED** — Original video audio is `DROP`, `KEEP`, or `POLICY_CONTROLLED`.
  Code G recommends explicit `DROP` for V1 to avoid accidental speech/music/privacy leakage and
  nondeterministic mix, but this is not frozen.
- **EXISTING** — Background music must not be added by Code G.
- **PROPOSED** — Audio normalization must explicitly freeze sample rate, channel layout, codec,
  bitrate, timestamps, trim/pad policy, loudness/gain policy, and behavior on duration mismatch.
- **PROPOSED** — Render never time-stretches narration or modifies Timeline to make muxing easier
  unless a future upstream/frozen contract explicitly authorizes that semantic.

## 21. Temp / Output Storage

### R0-Q8

- **EXISTING** — Desktop DB lives under `app.getPath('userData')`; macOS/Linux/Windows temporary
  locations are available through Node `os.tmpdir()`. Existing media worker artifacts use controlled
  roots and atomic JSON replacement, but there is no Render output layout.
- **MISSING** — No output naming, output-root, collision, quota, partial-file, atomic-finalization,
  verification, retention, or cleanup contract exists.

Proposed lifecycle:

```text
validate exact output request
  -> create controlled job directory with non-user-derived ID
  -> persist logical plan + machine execution snapshot
  -> stage/verify inputs if selected
  -> FFmpeg writes a unique non-success temporary file
  -> close process successfully
  -> ffprobe verifies container/streams/profile/duration
  -> hash final temporary bytes + record size
  -> atomically rename within the same filesystem to a new immutable final name
  -> fsync/flush policy as supported
  -> commit render receipt/artifact row transactionally
  -> expose success
```

- **PROPOSED** — A partial MP4 is never placed at or reported as the final success path.
- **PROPOSED** — Finalization uses a unique target and never overwrites an older successful output.
  If user export outside the managed library is supported, stage in the validated target directory
  so final rename remains same-filesystem; reject symlink/reparse/path-escape ambiguity.
- **PROPOSED** — Resolve and confine managed roots, validate parents and filenames, reject NUL/
  traversal/absolute child paths, recheck at finalization, and never use caller text as raw path.
- **PROPOSED** — Output names are derived from server/Main-owned job/artifact IDs, with a separately
  stored user-visible label.
- **PROPOSED** — Verification receipt binds output SHA-256, size, ffprobe document hash or normalized
  facts, duration, stream set, resolution/fps/codec/pixel format, audio profile, runtime identity,
  logical plan hash, and execution snapshot hash.
- **PROPOSED** — Temp/stage cleanup is state- and age-based; never delete a verified/success artifact
  merely because it resembles a temp name.
- **BRAIN1_DECISION_REQUIRED** — Managed library versus user-selected output UX, overwrite/collision
  behavior, retention/quota, fsync durability level, duration tolerance, and cross-volume export.

## 22. Job / Persistence / Receipt

### R0-Q9

- **EXISTING** — Generic `jobs` stores ID, type, state, scalar progress, timestamps, error, and one
  request snapshot hash. Startup changes `RUNNING` to `INTERRUPTED`.
- **EXISTING** — The generic state enum and list/cancel UI can serve as a job envelope.
- **MISSING** — `jobs` has no compare-and-set attempt generation, progress checkpoint detail,
  cancellation-request state, process/runtime identity, plan bytes, resolved/staged sources,
  temp/final artifact, verification facts, idempotency key, receipt, or artifact retention.
- **MISSING** — There are no `render_jobs`, `render_receipts`, or `render_artifacts` tables.

- **PROPOSED** — Reuse `jobs` as the common user-facing envelope, but add Render-specific append/
  state tables rather than overloading `request_snapshot_hash`:
  - `render_jobs`: exact Timeline/receipt/policy identities, logical render hash, current attempt,
    cancellation request, and state-machine checkpoint.
  - `render_execution_snapshots` or plan storage: canonical plan/snapshot bytes and hashes, exact
    runtime identity, resolved/staged sources, output target, and attempt number.
  - `render_artifacts`: temp/final managed path facts, state, hash, size, verified media facts,
    created/finalized timestamps, and retention state.
  - `render_receipts`: immutable success/failure/cancel receipt binding job, attempt, logical plan,
    execution snapshot, output artifact, runtime, verification, and error identity.

- **PROPOSED** — Main remains SQLite single writer; FFmpeg and Python never write business tables.
- **PROPOSED** — One logical-render idempotency key should be unique according to a Brain1-frozen
  output/retry policy. Attempts are append-only or monotonic so stale processes cannot commit.
- **BRAIN1_DECISION_REQUIRED** — Exact schema/state machine, whether a new explicit
  `CANCEL_REQUESTED` state is needed, success artifact reuse policy, and retry identity.

```text
RENDER_JOB_PERSISTENCE: PARTIAL (generic envelope only)
RENDER_RECEIPT: NOT_IMPLEMENTED
RENDER_RECOVERY_CONTRACT: NOT_IMPLEMENTED
```

## 23. Crash Recovery / Idempotency

| Boundary/event                                     | Proposed classification and behavior                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crash before source resolution                     | **PROPOSED — SAFE_RETRY**; no FFmpeg/output exists. Reload exact Timeline and rerun gate.                                                                     |
| Crash after source resolution, before plan persist | **PROPOSED — SAFE_RETRY**; discard RAM paths and re-resolve/re-hash.                                                                                          |
| Crash after execution plan/snapshot persisted      | **PROPOSED — SAFE_RETRY** after full source/runtime/output revalidation; restage when needed.                                                                 |
| Crash while FFmpeg runs                            | **PROPOSED — DELETE_TEMP + SAFE_RETRY** after startup marks attempt interrupted and confirms/kills owned process tree. Never attach to arbitrary reused PID.  |
| Crash after temp MP4 produced                      | **PROPOSED — REUSE_TRUSTED_OUTPUT only after re-running exact verification**; otherwise delete temp.                                                          |
| Crash after MP4 verification                       | **PROPOSED — REUSE_TRUSTED_OUTPUT** only if artifact bytes/hash and plan-bound verification checkpoint remain valid; otherwise verify again.                  |
| Crash before DB receipt commit                     | **PROPOSED — REUSE_TRUSTED_OUTPUT** via recovery reconciliation and transactional receipt commit; final success is not exposed beforehand.                    |
| Crash after receipt commit                         | **PROPOSED — REUSE_TRUSTED_OUTPUT**; idempotent request returns existing immutable receipt/artifact.                                                          |
| Retry same Timeline version                        | **PROPOSED — SAFE_RETRY** only when receipt, policy and all artifact identities match; changed policy creates a different logical render.                     |
| Source disappears before execution                 | **PROPOSED — SAFE_RE_RESOLVE**, otherwise `FAIL_CLOSED`; staged verified input may continue only if staging policy declares it authoritative for the attempt. |
| Source hash changes after plan                     | **PROPOSED — FAIL_CLOSED**; no plan mutation.                                                                                                                 |
| FFmpeg hangs/no progress                           | **PROPOSED — FAIL_CLOSED attempt** after policy timeout; graceful signal then bounded process-tree kill; delete/quarantine temp.                              |
| User cancels                                       | **PROPOSED — DELETE_TEMP**, terminate owned process tree, immutable cancelled receipt; never delete earlier successes.                                        |
| App exits                                          | **PROPOSED — BRAIN1_DECISION_REQUIRED** for graceful drain vs cancellation deadline; startup reconciliation is mandatory.                                     |

- **PROPOSED** — Process ownership records must bind attempt nonce and spawn time, not PID alone.
- **PROPOSED** — Progress is advisory and monotonic per attempt; it is never completion authority.
- **PROPOSED** — A verified final file without a receipt is recoverable but not yet user-visible
  success. A receipt whose artifact no longer verifies is integrity failure, not automatic rerender.
- **PROPOSED** — Cancellation races use compare-and-set/transaction rules so a late FFmpeg exit
  cannot change a cancelled/interrupted attempt to success.

## 24. Security Boundary

- **EXISTING** — Only Desktop Main may access SQLite, filesystem, `child_process`, native runtime,
  runtime manifests/hashes, and output directories.
- **EXISTING** — Renderer sender/origin checks and narrow preload DTO validation already establish
  the pattern; no Render IPC exists.
- **PROPOSED** — Spawn one exact absolute approved executable path directly with `args: string[]`,
  `shell: false`, closed/controlled stdin, bounded captured output, controlled environment/CWD, and
  no PATH lookup.
- **PROPOSED** — All numbers are safe integers/rationals within explicit bounds. All operation types
  are enums. Paths are Main-resolved facts. No raw filter graph, preset text, response-file content,
  shell token, or encoder argument crosses IPC.
- **PROPOSED** — FFmpeg input protocols are minimized and network disabled at build and invocation;
  local paths beginning with option-like characters are passed only in fixed argument positions with
  appropriate option termination/protocol-safe handling.
- **PROPOSED** — Runtime startup verifies manifest, entrypoint and all companion members; Windows
  DLL loads are bundle-local plus approved OS prerequisites only.
- **PROPOSED** — Logs redact user paths where exported outside local diagnostics and are size/
  retention bounded. FFmpeg stderr is untrusted text and never parsed as command or HTML.
- **PROPOSED** — Output roots, staging roots, source paths, subtitle/font artifacts and runtime roots
  each have separate containment and symlink/reparse-point policies.

## 25. Test Strategy

No R0 tests were added or changed. Future coverage proposal:

- **PROPOSED Unit** — canonical policy/plan hashing, operation ordering, ms/frame mapping, argument
  construction, progress parser, timeout/cancel state transitions, path validation, output naming.
- **PROPOSED Contract** — committed Timeline/receipt binding, segment-to-fact/D evidence binding,
  exact source/audio/fallback/subtitle identities, runtime manifest/profile, receipt schema.
- **PROPOSED Integration** — single clip; multi-clip `SWITCH`; `ACTIVE_EXTENSION`;
  `ACTIVE_STITCH`; pause coverage; narration mux; optional subtitle only after authority exists;
  output ffprobe/hash verification.
- **PROPOSED Negative** — tampered Timeline hash/receipt; identity-inconsistent self-hashed segment;
  missing/stale/moved media; hash mismatch; wrong revision/range; unresolved additional selection;
  unresolved fallback; audio mismatch; runtime/member hash mismatch; unsupported codec/pixel format;
  corrupt stream; path escape/symlink; hostile filenames; log/output flood.
- **PROPOSED Recovery** — crash at every boundary in section 23, same-Timeline retry, duplicate
  request concurrency, cancellation race, hung process, app restart, corrupted stage/temp/final.
- **PROPOSED Windows packaged smoke** — exact packaged runtime locator/member hashes and DLL trace,
  no PATH/CWD/decoy DLL consumption, real Render, cancel, restart recovery, ffprobe verification.
- **PROPOSED Historical fixture** — reuse C/D/E GQ006 evidence without reindex/select/plan; add a
  separately authorized exact narration audio artifact before claiming end-to-end Render.
- **PROPOSED Determinism** — 100-run logical-plan equality and exact-runtime repeat characterization;
  do not assert cross-OS encoded byte identity.

Minimum named cases retained from the taskbook:

```text
Render plan determinism; Timeline -> Render binding; tampered Timeline/receipt; missing/stale/hash-
mismatched media; wrong revision; unresolved selection/fallback; audio hash mismatch; runtime hash
mismatch; single/multi/extension/stitch/pause; audio mux; optional subtitle; cancel/crash/restart;
output verification; Windows packaged runtime.
```

## 26. Real Historical Fixture Strategy

- **EXISTING** — Code E E6 binds Code C V3 GQ006 and Code D eligible-candidate evidence to
  `v2_asset_084`, revision 1, shot
  `shot_c66c5bd2-25c8-562e-ac29-3c88c847f8c6`, `[0,5167)`, and expected file SHA-256
  `3a9c8026c5b83cd27ed9fa3ca0a72c21ac9f32312766a32267a57f392552162e`.
- **EXISTING** — The authorized media file is present on this investigation machine and its SHA-256
  was rechecked during R0. Its machine path is not recorded here as durable fixture authority.
- **EXISTING** — E6's real-file smoke uses temporary SQLite and commits a one-second physical
  segment without rerunning indexing, retrieval, or the Code C benchmark.
- **MISSING** — The fixture has no authorized real narration audio file/resolver, no Render Policy,
  and no approved FFmpeg render runtime. Therefore it is not currently an end-to-end Render fixture.
- **PROPOSED** — Future real Render smoke should reconstruct the already authorized C/D/E chain,
  resolve the real file by trusted environment mapping/hash, attach a separately approved narration
  artifact, choose a frozen policy/runtime, and render only after the full entry gate passes.
- **EXISTING** — R0 did not execute FFmpeg or create MP4.

```text
REAL_RENDER_SMOKE: NOT_RUN_CONTRACT_AND_RUNTIME_PREREQUISITES_UNAVAILABLE
```

## 27. Missing Contracts

- **MISSING** — Render request/acceptance contract and trusted Main entry service.
- **MISSING** — Segment-to-planning-fact/D-evidence structural binding gate.
- **MISSING** — Timeline-segment to exact-source resolver adapter.
- **MISSING** — TOCTOU/pre-spawn/staging contract.
- **MISSING** — Narration audio artifact authority/resolver/hash/duration contract.
- **MISSING** — Fallback source resolution authority.
- **MISSING** — Subtitle cue/text/timing/style/font authority.
- **MISSING** — Render Policy V1 and explicit media normalization/audio rules.
- **MISSING** — Logical Render/Execution Plan contract and frozen hash boundary.
- **MISSING** — FFmpeg capability/build profile and approved Linux/Windows/macOS artifacts as scoped.
- **MISSING** — FFmpeg fixed runtime locator, member verifier, Desktop packaging, and startup probe.
- **MISSING** — Render-specific persistence, state machine, receipt, artifact and recovery contract.
- **MISSING** — Output root/naming/finalization/verification/retention policy.
- **MISSING** — Windows packaged Render smoke and current-machine macOS Render runtime.

## 28. Brain1 Decisions Required

1. **BRAIN1_DECISION_REQUIRED** — Place the segment-to-planning-facts/D evidence binding in Code E
   contract strengthening or the Code G entry gate.
2. **BRAIN1_DECISION_REQUIRED** — Render any explicitly accepted committed version versus latest-only
   product rule; freeze exact accepted-version request semantics.
3. **BRAIN1_DECISION_REQUIRED** — Freeze rejection of all unresolved additional-selection requirements.
4. **BRAIN1_DECISION_REQUIRED** — Make R1 fallback-free or define an upstream exact Fallback Resolver.
5. **BRAIN1_DECISION_REQUIRED** — Define narration audio artifact owner, persistence, exact resolver,
   media metadata and duration-mismatch behavior.
6. **BRAIN1_DECISION_REQUIRED** — Subtitle scope and text/timing/style/font authority; Code G
   recommends OFF until the authority exists.
7. **BRAIN1_DECISION_REQUIRED** — Freeze RenderPolicyV1 fields/defaults: canvas, fps/frame mapping,
   fit/crop/pad, encoders, pixel/color, audio, container, timeouts and verification tolerances.
8. **BRAIN1_DECISION_REQUIRED** — Original video audio `DROP/KEEP/MIX`; background music remains out.
9. **BRAIN1_DECISION_REQUIRED** — TOCTOU policy; Code G recommends verified per-plan staging.
10. **BRAIN1_DECISION_REQUIRED** — Logical-render identity versus machine execution snapshot and exact
    canonical hash schemas.
11. **BRAIN1_DECISION_REQUIRED** — Required FFmpeg capability profile and Code F intake, including
    Windows H.264/AAC policy and no-silent-encoder-fallback behavior.
12. **BRAIN1_DECISION_REQUIRED** — Whether macOS needs an approved development Render companion or
    only Windows/Linux artifacts; Mac success never substitutes for Windows.
13. **BRAIN1_DECISION_REQUIRED** — Render-specific tables/state machine/idempotency/retry/receipt and
    cancellation semantics.
14. **BRAIN1_DECISION_REQUIRED** — Managed output versus user export, collision/overwrite,
    durability, disk quota, retention and cleanup.
15. **BRAIN1_DECISION_REQUIRED** — Minimum representable clip/frame rules and exact output duration
    verification tolerance without changing Timeline geometry.

## 29. First Actual Blocker

- **EXISTING** — No contradiction in the frozen C/D/E business authority or Code 0 architecture was
  found that requires abandoning R0 or changing Timeline semantics.
- **MISSING** — R1 execution cannot start from the current repository. In entry-gate order, the first
  absent non-source authority is the exact narration audio file resolver/hash verification. Render
  Policy, approved FFmpeg render runtime, fallback policy, persistence/receipt, and Windows packaged
  evidence are also missing.
- **PROPOSED** — R0 can pass because its purpose is to expose these prerequisites. Stop after this
  inventory and completion report; wait for Brain1 contract freeze and explicit R1 authorization.

```text
FIRST_ACTUAL_BLOCKER:
NONE_IN_R0_SCOPE

R1_IMPLEMENTATION_ENTRY_BLOCKER:
NARRATION_AUDIO_FILE_AUTHORITY_NOT_IMPLEMENTED (then RenderPolicy/approved FFmpeg/persistence gates)

RECOMMENDATION:
READY_FOR_BRAIN1_RENDER_CONTRACT_FREEZE
```
