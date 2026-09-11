# Code G R1A Completion Report

```text
CODE_G_R1A_IMPLEMENTATION:
PASS

BASE:
ce47c39dbbe1eba75fa3340ff1ca5d22789395b1

FINAL_COMMIT:
SELF (exact SHA reported after this report is committed)

BRANCH:
code-g/render-r1a-foundation

CAPABILITY_PROFILE_COMMIT:
3a212342b573d0f785c0bb9be91cb8a8bad0a113

FFMPEG_REQUIRED_CAPABILITY_PROFILE_HASH:
e05686e544bd31de1782b4b13cb23e993e6c26ef90408b1d19b8e59dd5ac5910


TIMELINE_EXACT_PIN:
PASS

SEGMENT_STRUCTURAL_BINDING:
PASS

ADDITIONAL_SELECTION_REJECTION:
PASS

FALLBACK_FREE_GATE:
PASS


NARRATION_ARTIFACT_AUTHORITY:
PASS

TTS_BUSINESS_LOGIC_ADDED:
NO

NARRATION_HASH_VERIFICATION:
PASS

NARRATION_DURATION_POLICY:
VERSIONED_EXACT_EQUALITY_0_MS_TOLERANCE;
SAMPLE_COUNT_DERIVED_PREFERRED;
CONTAINER_REPORTED_METADATA_ALLOWED_ONLY_WHEN THE EXACT HASH-BOUND ARTIFACT DECLARES IT;
NO_TRIM_PAD_TIME_STRETCH_OR_RETIMING;
0_MS_RECOMMENDED_FOR_BRAIN1_FREEZE_UNTIL EMPIRICAL CODE_F/R1B EVIDENCE JUSTIFIES A VERSIONED CHANGE


LOGICAL_RENDER_HASH:
PASS

ABSOLUTE_PATH_IN_LOGICAL_RENDER_HASH:
NO

EXECUTION_SNAPSHOT_HASH:
PASS


VERIFIED_STAGING:
PASS

STAGING_IS_MEDIA_AUTHORITY:
NO


RENDER_POLICY_V1:
PASS

SOURCE_AUDIO:
DROP

SUBTITLE:
OFF


RENDER_PERSISTENCE:
PASS

RENDER_RECEIPT_FOUNDATION:
PASS

RECOVERY_FOUNDATION:
PASS


REAL_FFMPEG_EXECUTION:
NOT_RUN

REAL_MP4:
NOT_PRODUCED

WINDOWS_REAL_RENDER:
NOT_RUN


TESTS:
PASS

TEST_EVIDENCE:
- 281 deterministic unit/integration/contract/security tests passed across 19 files.
- 75 focused Render, migration, Timeline persistence, and Electron isolation tests passed across 5 files.
- TypeScript checks passed for Render, Local DB, Desktop Main, Desktop Preload, Desktop Renderer,
  Gateway, and all supporting workspace packages.
- Scoped ESLint passed for every R1A production and test file.
- Dependency-direction check passed.
- Developer-specific-path portability check passed, including explicit Windows path fixtures.
- Workflow security, secret scan (1001 files), and dependency license scan (663 packages) passed.
- Prettier check and git diff whitespace check passed.
- The historical Code E E6 stage-local HEAD diff guard is not counted as an R1A regression gate:
  by design it rejects every post-E5 non-validation path, including all later authorized phase work.
- No real FFmpeg, ffprobe execution, production MP4, subtitle processing, fallback generation,
  Digital Human generation, or source-audio mixing was run by these tests.


FIRST_ACTUAL_BLOCKER:
NONE


RECOMMENDATION:
READY_TO_JOIN_CODE_F_RUNTIME
```

## Implemented authority boundary

R1A accepts only an exact Timeline version and commit receipt plus an exact, self-hashed
RenderPolicy version. Main reloads the committed Timeline from SQLite, verifies its immutable
chain through the existing repository, verifies committed Code D evidence, and cross-binds every
segment to exactly one planning material and one selected Code D candidate. Asset, revision, shot,
full shot bounds, source range, selection request, receipt, and slot mismatches fail closed.

The pure Render domain contains no filesystem, SQLite, Electron, process, vendor SDK, or Python
dependency. Main-owned services alone resolve exact media and narration bytes, stage verified files,
and persist preparation facts. Renderer and Preload contracts are unchanged.

## Deterministic identity and staging

`logical_render_hash` binds only portable business authority and typed logical operations. It excludes source,
staging, output, runtime, process, timestamp, and platform paths. `execution_snapshot_hash` binds the
logical hash to the current platform, architecture, exact resolved and staged paths and hashes,
controlled roots, and approved runtime identity.

Staging roots are Main-configured and real-path checked. Attempt identifiers are constrained,
children are confined, symlinks are rejected, source bytes are verified before copy, partial copies
are exclusive, and staged bytes are hashed before atomic rename. A staging failure deletes the
untrusted attempt. Equal source hashes deduplicate the physical staged file while preserving every
segment identity in the snapshot.

## Persistence and recovery

Migration 005 adds immutable policy, narration artifact, execution snapshot, staged artifact, and
receipt storage plus Render-specific preparation state. SQLite remains Main's single writer; the
generic `jobs` row remains the user-facing envelope.

The preparation repository enforces exact-request and logical-render idempotency. Recovery marks
in-flight preparation as interrupted, deletes unverified attempt staging, reloads immutable facts,
and restages. Persisted `READY_FOR_EXECUTION` snapshots are reloaded and their controlled staged
bytes are rehashed; a missing or changed staged artifact is deleted, invalidated, and rebuilt as a
new machine attempt. R1A emits no success receipt and stops at `READY_FOR_EXECUTION`.

## Capability profile checkpoint

The capability profile was frozen and pushed before the remaining R1A implementation. It defines
the precise decode, video operation, H.264, narration, AAC, MP4, progress, cancellation, bounded log,
and ffprobe verification surface required from Code F. It also forbids network protocols, device or
listener behavior, undeclared protocols, GPL/nonfree components, libx264/libx265, arbitrary shell,
source-audio retention/mixing, subtitles, fallback generation, and narration time stretching.

Any capability change after Code F intake requires a profile version bump, new hash, new exact
commit, and explicit stale-candidate notification.
